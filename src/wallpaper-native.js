/**
 * ============================================================================
 * wallpaper-native.js — Windows 原生壁纸层注入模块
 * ============================================================================
 *
 * 功能：将 Electron BrowserWindow 注入到 Windows Desktop WorkerW 层，
 *       使其成为桌面图标下方的"活壁纸"。
 *
 * 你机器上的真实结构（日志实测）：
 *   Progman hwnd=0x10174 visible=True
 *     SHELLDLL_DefView hwnd=0x1017E        ← 图标层
 *       SysListView32 hwnd=0x10184
 *     WorkerW hwnd=0x1402BE visible=True   ← 壁纸层（要挂到这里）
 *   ……另外还有十几个 visible=False 的顶层 WorkerW，
 *     它们是别的 Chromium 程序的隐藏消息窗口，不能拿来当壁纸层。
 *
 * 注入流程（Win32 调用见 win32.js）：
 *   1. 找到 Progman，发 0x052C 消息，让系统刷新 WorkerW 壁纸层
 *   2. 按优先级挑 WorkerW（见 findWallpaperWorker）：
 *        a. Progman 的直接子 WorkerW，且内部不含 DefView（本例的 0x1402BE）
 *        b. 同属桌面进程(explorer.exe)的顶层 WorkerW
 *        c. 任意父链可见的顶层 WorkerW
 *      每个候选都要满足"父链全部 WS_VISIBLE"，否则跳过
 *   3. SetParent 挂进去，再用 GetAncestor(GA_PARENT) 回读验证
 *   4. 强制父层重绘，否则子窗口要等桌面下次重绘才显示
 *
 * ---------------------------------------------------------------------------
 * 踩过的坑（全部体现在代码里）：
 *   - 【依赖 PowerShell 子进程】以前这些调用都放在 PowerShell 里跑，有的电脑上安全软件
 *     不让本程序启动 PowerShell（spawn 报 EPERM / UNKNOWN），注入一行都没执行就走了兜底，
 *     壁纸变成盖住图标的普通窗口，点"显示桌面"就不见了。→ 改成进程内调用 user32。
 *   - 【选错窗口】顶层 WorkerW 有十几个，大部分是其它 Chromium 进程的隐藏
 *     消息窗口。只看"Z 序在 Progman 后面"会随机选中它们，窗口被藏进不可见
 *     父链里（self visible=False），壁纸就消失了。→ PID + 可见性双重过滤。
 *   - 【校验用错 API】GetParent 对非 WS_CHILD 窗口返回的是 owner，不是父窗口，
 *     Electron 窗口是 WS_POPUP，于是永远返回 0x0，把成功误判成失败。
 *     → 用 GetAncestor(hwnd, GA_PARENT)。
 *   - 【不重绘】子窗口是事后挂上去的，父窗口不会自动重画，
 *     表现是"刚启动看不到壁纸，来回点几次显示桌面才出现"。
 *     → SetWindowPos 之后主动 RedrawWindow 父层。
 *   - 【跨进程 SetParent 卡死】→ 放工作线程 + 限时等待，再回读父窗口判定。
 *   - 【同步调用卡住主进程】→ 发消息的调用全部走工作线程。
 *   - 【重试留下 WS_CHILD】SetParent 被安全软件拦下时，补上的 WS_CHILD 留在了顶层窗口上。
 *     → 重试失败就改回原来的样式。
 *   - 【安全软件拦 SetParent】挂不上时不能盖住用户的程序。→ 见下面的"兜底模式"。
 * ============================================================================
 */

const { getWin32 } = require('./win32');

// ==================== 参数 ====================

/** 让系统刷新壁纸层的消息 */
const WM_SPAWN_WORKER = 0x052C;

const WS_CHILD = 0x40000000;
const WS_POPUP = 0x80000000;
const WS_VISIBLE = 0x10000000;

/** SetParent 最多等这么久（毫秒），超时后回读父窗口判定 */
const SET_PARENT_TIMEOUT_MS = 4000;

/** 重绘最多等这么久（毫秒）：窗口已经挂上去了，桌面太忙时不等它 */
const REPAINT_TIMEOUT_MS = 4000;

/** 发完 0x052C 后，等系统把壁纸层建好（毫秒） */
const WORKER_SETTLE_MS = 300;

/** 找 Progman 的次数和间隔（开机时桌面可能还没起来） */
const PROGMAN_RETRIES = 20;
const PROGMAN_RETRY_MS = 100;

// ==================== 工具函数 ====================

/**
 * 把 Electron 的 getNativeWindowHandle() 结果转成整数。
 *
 * Electron 返回的是 Buffer：64 位系统上是 8 字节指针，
 * 旧代码用 readInt32LE(0) 只取低 32 位，属于潜在隐患。
 *
 * @param {Buffer|number} handle
 * @returns {number}
 */
function toHwndNumber(handle) {
    if (typeof handle === 'number') return handle;
    if (!handle) return 0;

    try {
        if (typeof handle.readBigUInt64LE === 'function' && handle.length >= 8) {
            // HWND 实际取值远小于 2^53，转 Number 不会丢精度
            return Number(handle.readBigUInt64LE(0));
        }
    } catch (_) { /* 退回到 32 位读取 */ }

    try {
        return handle.readUInt32LE(0);
    } catch (_) {
        return 0;
    }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const hex = (hwnd) => '0x' + hwnd.toString(16).toUpperCase();

/**
 * 等 promise 完成，超时返回 false（调用还挂在工作线程上，不影响主进程）。
 * @returns {Promise<boolean>}
 */
async function finishedInTime(promise, ms) {
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(false), ms); });
    try {
        return await Promise.race([promise.then(() => true), timeout]);
    } finally {
        clearTimeout(timer);
    }
}

// ==================== 挑选壁纸层 ====================

/** 某窗口的子树里有没有 SHELLDLL_DefView（桌面图标层） */
function hasDefView(api, hwnd, depth = 0) {
    if (depth > 3) return false;

    for (let child = api.findWindow(hwnd, 0); child; child = api.findWindow(hwnd, child)) {
        if (api.getClassName(child) === 'SHELLDLL_DefView') return true;
        if (hasDefView(api, child, depth + 1)) return true;
    }
    return false;
}

/**
 * 从指定窗口往上逐级检查 WS_VISIBLE。
 * 链路里任何一级不可见，挂进去的窗口就会"消失"
 * （上次就是挂到了别的 Chromium 进程的隐藏 WorkerW 上）。
 */
function chainVisible(api, hwnd) {
    for (let h = hwnd; h; h = api.getParentWindow(h)) {
        if ((api.getStyle(h) & WS_VISIBLE) === 0) return false;
    }
    return true;
}

/** parent 下所有 WorkerW，按 Z 序从上到下；parent 传 0 取顶层的 */
function listWorkers(api, parent) {
    const workers = [];
    for (let w = api.findWindow(parent, 0, 'WorkerW'); w; w = api.findWindow(parent, w, 'WorkerW')) {
        workers.push(w);
    }
    return workers;
}

/**
 * 挑选真正的"壁纸层" WorkerW。
 *
 * 关键：桌面上的顶层 WorkerW 有一大堆，其中大部分是别的 Chromium 程序
 * （Chrome / VS Code / 微信…）建的隐藏消息窗口，绝不能拿来当壁纸层，
 * 所以这里既用 PID 过滤，又要求父链可见。
 *
 * @returns {{hwnd: number, how: string}|null}
 */
function findWallpaperWorker(api, progman) {
    const usable = (w) => !hasDefView(api, w) && chainVisible(api, w);
    const shellPid = api.getProcessId(progman);   // Progman 属于 explorer.exe
    const topLevel = listWorkers(api, 0);

    // a) Progman 的直接子 WorkerW，且内部不含 DefView
    const child = listWorkers(api, progman).find(usable);
    if (child) return { hwnd: child, how: 'Progman child WorkerW' };

    // b) 同属桌面进程的顶层 WorkerW
    const shellWorker = topLevel.find((w) => api.getProcessId(w) === shellPid && usable(w));
    if (shellWorker) return { hwnd: shellWorker, how: 'top-level WorkerW of shell process' };

    // c) 兜底：任意父链可见的顶层 WorkerW
    const anyWorker = topLevel.find(usable);
    if (anyWorker) return { hwnd: anyWorker, how: 'fallback visible WorkerW' };

    return null;
}

// ==================== 诊断日志 ====================

function describeWindow(api, hwnd) {
    return `${api.getClassName(hwnd)} hwnd=${hex(hwnd)} visible=${api.isWindowVisible(hwnd)} pid=${api.getProcessId(hwnd)}`;
}

function dumpTree(api, hwnd, depth, maxDepth) {
    if (depth > maxDepth) return;

    console.log(`[WorkerW] DUMP|${' '.repeat(depth * 2)}${describeWindow(api, hwnd)}`);
    for (let child = api.findWindow(hwnd, 0); child; child = api.findWindow(hwnd, child)) {
        dumpTree(api, child, depth + 1, maxDepth);
    }
}

/** 把桌面层级打到日志里，方便按真实结构对症下药（隐藏的顶层 WorkerW 很多，只列可见的） */
function dumpDesktop(api, target, progman, phase) {
    console.log(`[WorkerW] DUMP|--- desktop hierarchy (${phase}) ---`);
    dumpTree(api, progman, 0, 2);
    listWorkers(api, 0).filter((w) => api.isWindowVisible(w)).forEach((w) => dumpTree(api, w, 0, 1));
    console.log(`[WorkerW] DUMP|self ${describeWindow(api, target)}`
        + ` style=0x${(api.getStyle(target) >>> 0).toString(16)} parent=${hex(api.getParentWindow(target))}`);
}

// ==================== 注入 ====================

async function findProgman(api, delay) {
    for (let i = 0; i < PROGMAN_RETRIES; i++) {
        const progman = api.findWindow(0, 0, 'Progman');
        if (progman) return progman;
        await delay(PROGMAN_RETRY_MS);
    }
    return 0;
}

/** 让系统刷新壁纸层后再挑一次，没挑到就换 Wallpaper Engine / Lively 用的参数再试 */
async function spawnAndFindWorker(api, progman, delay) {
    await api.sendMessage(progman, WM_SPAWN_WORKER, 0, 0);
    await delay(WORKER_SETTLE_MS);

    const worker = findWallpaperWorker(api, progman);
    if (worker) return worker;

    await api.sendMessage(progman, WM_SPAWN_WORKER, 0xD, 1);
    await delay(WORKER_SETTLE_MS);
    return findWallpaperWorker(api, progman);
}

/** @returns {Promise<boolean>} 窗口是否挂到了 worker 下面 */
async function attachWindow(api, target, worker) {
    const returned = await finishedInTime(api.setParent(target, worker), SET_PARENT_TIMEOUT_MS);
    const actual = api.getParentWindow(target);
    console.log(`[WorkerW] SetParent returned=${returned}, parent=${hex(actual)}`);
    return actual === worker;
}

async function attachToDesktop(api, target, delay) {
    const progman = await findProgman(api, delay);
    if (!progman) {
        console.error('[WorkerW] Progman not found');
        return false;
    }
    console.log(`[WorkerW] Progman: ${hex(progman)}`);
    dumpDesktop(api, target, progman, 'before');

    const worker = await spawnAndFindWorker(api, progman, delay);
    if (!worker) {
        console.error('[WorkerW] WorkerW not found');
        dumpDesktop(api, target, progman, 'after');
        return false;
    }
    console.log(`[WorkerW] WorkerW: ${hex(worker.hwnd)} (${worker.how})`);

    let attached = await attachWindow(api, target, worker.hwnd);
    if (!attached) {
        // 兜底：SetParent 不会自动改窗口样式，补上 WS_CHILD 再来一次
        const style = api.getStyle(target);
        console.log(`[WorkerW] Retry with WS_CHILD (style 0x${(style >>> 0).toString(16)})`);
        await api.setStyle(target, (style & ~WS_POPUP) | WS_CHILD);
        attached = await attachWindow(api, target, worker.hwnd);
        // 还是挂不上就改回去：接下来它要当顶层窗口用，不能留着 WS_CHILD
        if (!attached) await api.setStyle(target, style);
    }

    if (!attached) {
        console.error('[WorkerW] Window is not attached to the wallpaper layer');
        dumpDesktop(api, target, progman, 'after');
        return false;
    }

    const repainted = await finishedInTime(api.pushToBottomAndRepaint(target, worker.hwnd), REPAINT_TIMEOUT_MS);
    console.log(`[WorkerW] Requested repaint of the wallpaper layer (finished=${repainted})`);
    dumpDesktop(api, target, progman, 'after');
    return true;
}

/**
 * 把目标窗口注入到桌面壁纸层（异步，不阻塞主进程）。
 *
 * @param {Buffer|number} targetHwnd - Electron 窗口句柄
 * @param {object} [options] - 测试时传假接口
 * @param {object} [options.api] - win32 接口，默认 getWin32()
 * @param {(ms: number) => Promise<void>} [options.delay]
 * @returns {Promise<boolean>} 是否注入成功
 */
async function injectToWallpaperLayer(targetHwnd, { api, delay = sleep } = {}) {
    const target = toHwndNumber(targetHwnd);

    if (!target) {
        console.error('[WorkerW] Invalid window handle, skipping injection');
        return false;
    }
    console.log(`[WorkerW] Target HWND: ${hex(target)}`);

    try {
        return await attachToDesktop(api || getWin32(), target, delay);
    } catch (err) {
        console.error('[WorkerW] Injection failed:', err.message);
        return false;
    }
}

// ==================== 兜底模式 ====================

/** 窗口紧贴在它们上面就算到底了 */
const DESKTOP_CLASSES = new Set(['Progman', 'WorkerW']);

/** 多久看一次壁纸还在不在最底下（毫秒） */
const BOTTOM_CHECK_MS = 1000;

/**
 * 窗口比屏幕矮这么多（DIP）。
 * 盖满显示器的无边框窗口会被系统当成全屏程序：设置窗口（和壁纸同一个线程）在前台、
 * 后面又没有别的窗口时，任务栏沉到壁纸下面，系统通知也按"全屏中"处理（实测）。
 * 只要矮一点就不算全屏，这一条通常被任务栏挡着，看不出来。
 */
const FULLSCREEN_GAP = 1;

/** 下面没有窗口（"显示桌面"开着时）或者紧贴着桌面，就是到底了 */
function isAtBottom(api, target) {
    const below = api.getWindowBelow(target);
    return !below || DESKTOP_CLASSES.has(api.getClassName(below));
}

/**
 * 窗口不在最底下就压回去，窗口关掉后自己停。
 *
 * 只压一次不够：壁纸自己不会往上跑，但最小化的窗口会沉到桌面正上方，也就是壁纸下面。
 * "显示桌面"恢复窗口时不激活它们，它们就一直待在那里，被壁纸盖住。
 */
function keepAtBottom(win, api, target) {
    const check = async () => {
        if (!isAtBottom(api, target)) await api.sendToBottom(target);
    };
    const timer = setInterval(() => {
        if (win.isDestroyed()) {
            clearInterval(timer);
            return;
        }
        check().catch((err) => console.error('[WorkerW] Cannot keep window at the bottom:', err.message));
    }, BOTTOM_CHECK_MS);
}

/**
 * 挂不到桌面层时的显示方式：壁纸当普通窗口放在所有程序后面，最多盖住桌面图标。
 * 放不到最底下就不显示：宁可没有壁纸，也不能挡住用户的程序。
 *
 * "显示桌面"开着时系统把桌面提到壁纸上面，这时看到的是系统原来的桌面，关掉就恢复。
 *
 * @param {import('electron').BrowserWindow} win
 * @param {{x: number, y: number, width: number, height: number}} bounds - 显示器的 bounds
 * @param {object} [options] - 测试时传假接口
 * @param {object} [options.api] - win32 接口，默认 getWin32()
 * @returns {Promise<boolean>} 窗口显示出来了没有
 */
async function showBehindOtherWindows(win, bounds, { api } = {}) {
    const target = toHwndNumber(win.getNativeWindowHandle());
    if (!target) {
        console.error('[WorkerW] Invalid window handle, wallpaper stays hidden');
        return false;
    }

    try {
        const win32 = api || getWin32();

        // 构造参数里的大小被裁到了工作区，要再 setBounds 才铺满屏幕（见 elements/placement-window.js）
        win.setBounds({ ...bounds, height: bounds.height - FULLSCREEN_GAP });
        // 打开鼠标穿透，否则这个铺满屏幕的窗口会把桌面图标的点击 / 右键全部吃掉
        win.setIgnoreMouseEvents(true);

        // 先放到底再显示，不然会闪一下盖住所有程序
        await win32.sendToBottom(target);
        win.showInactive();
        keepAtBottom(win, win32, target);

        const below = win32.getWindowBelow(target);
        console.log(`[WorkerW] Fallback: behind other windows, next below: ${below ? describeWindow(win32, below) : 'none'}`);
        return true;
    } catch (err) {
        console.error('[WorkerW] Cannot place window at the bottom, wallpaper stays hidden:', err.message);
        return false;
    }
}

// ==================== 导出 ====================

module.exports = {
    injectToWallpaperLayer,
    showBehindOtherWindows,
    findWallpaperWorker,
    toHwndNumber,
};
