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
 * 注入流程：
 *   1. 找到 Progman，发 0x052C 消息，让系统刷新 WorkerW 壁纸层
 *   2. 按优先级挑 WorkerW（见 FindWallpaperWorker）：
 *        a. Progman 的直接子 WorkerW，且内部不含 DefView（本例的 0x1402BE）
 *        b. 同属桌面进程(explorer.exe)的顶层 WorkerW
 *        c. 任意父链可见的顶层 WorkerW
 *      每个候选都要满足"父链全部 WS_VISIBLE"，否则跳过
 *   3. SetParent 挂进去，再用 GetAncestor(GA_PARENT) 回读验证
 *   4. 强制父层重绘，否则子窗口要等桌面下次重绘才显示
 *
 * ---------------------------------------------------------------------------
 * 踩过的坑（全部体现在代码里）：
 *   - 【选错窗口】顶层 WorkerW 有十几个，大部分是其它 Chromium 进程的隐藏
 *     消息窗口。只看"Z 序在 Progman 后面"会随机选中它们，窗口被藏进不可见
 *     父链里（self visible=False），壁纸就消失了。→ PID + 可见性双重过滤。
 *   - 【校验用错 API】GetParent 对非 WS_CHILD 窗口返回的是 owner，不是父窗口，
 *     Electron 窗口是 WS_POPUP，于是永远返回 0x0，把成功误判成失败。
 *     → 用 GetAncestor(hwnd, GA_PARENT)。
 *   - 【不重绘】子窗口是事后挂上去的，父窗口不会自动重画，
 *     表现是"刚启动看不到壁纸，来回点几次显示桌面才出现"。
 *     → SetWindowPos 之后主动 RedrawWindow 父层。
 *   - 【跨进程 SetParent 卡死】→ 放后台线程 + 限时等待，再回读父窗口判定。
 *   - 【同步调用卡住主进程】→ 全流程异步 spawn + Promise。
 *   - 【命令行引号被二次解析】→ 用 -EncodedCommand(Base64) 传脚本。
 *   - 【Add-Type 每次现场编译要几秒】→ 按源码 hash 把编译结果缓存成 dll，
 *     第二次启动直接加载，失败自动退回现场编译。
 * ============================================================================
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ==================== 参数 ====================

/**
 * 等待注入脚本返回的超时时间（毫秒）。
 * 首次运行的 Add-Type 现场编译要几秒，主进程不阻塞，所以给得宽松些。
 */
const INJECT_TIMEOUT_MS = 25000;

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

/**
 * 把脚本编码成 -EncodedCommand 需要的 Base64(UTF-16LE)。
 *
 * 为什么不用 -Command 直接传脚本：
 *   Windows 命令行会对参数做二次解析，脚本里的引号和 here-string（@"..."@）
 *   很容易被吃掉一半，导致 "源文本中包含无法识别的标记" 这类报错。
 *   Base64 只含 [A-Za-z0-9+/=]，不受任何引号规则影响。
 *
 * @param {string} script
 * @returns {string}
 */
function toEncodedCommand(script) {
    return Buffer.from(script, 'utf16le').toString('base64');
}

/**
 * 把注入脚本写进临时文件，返回文件路径（配合 powershell -File 使用）。
 *
 * 为什么不继续用 -EncodedCommand：
 *   Base64(UTF-16LE) 会把体积放大到 8/3 倍，12KB 的脚本编码后约 32KB，
 *   正好顶到 Windows 命令行 32767 字符的上限，实测会报
 *   "Program 'powershell.exe' failed to run: The filename or extension is too long"。
 *   用 -File 执行临时脚本：没有长度限制，也不存在引号二次解析问题。
 *
 * 写文件时带 UTF-8 BOM：PowerShell 5.1 只有看到 BOM 才会按 UTF-8 解析，
 * 否则会按系统 ANSI 代码页读，脚本里的中文注释就乱了。
 *
 * @param {string} script
 * @returns {string} 脚本文件路径
 */
function writeScriptFile(script) {
    const dir = path.join(os.tmpdir(), 'wallpaper-injector');
    fs.mkdirSync(dir, { recursive: true });

    const file = path.join(dir, 'inject.ps1');
    fs.writeFileSync(file, '\uFEFF' + script, 'utf8');
    return file;
}

// ==================== 注入 ====================

/**
 * 把目标窗口注入到桌面壁纸层（异步，不阻塞主进程）。
 *
 * @param {Buffer|number} targetHwnd - Electron 窗口句柄
 * @param {number} screenWidth - 屏幕宽度
 * @param {number} screenHeight - 屏幕高度
 * @returns {Promise<boolean>} 是否注入成功
 */
function injectToWallpaperLayer(targetHwnd, screenWidth, screenHeight) {
    return new Promise((resolve) => {
        const hwndInt = toHwndNumber(targetHwnd);

        if (!hwndInt) {
            console.error('[WorkerW] Invalid window handle, skipping injection');
            resolve(false);
            return;
        }

        console.log(`[WorkerW] Target HWND: 0x${hwndInt.toString(16)}`);
        console.log(`[WorkerW] Screen size: ${screenWidth}x${screenHeight}`);

        let proc;
        let scriptFile;
        try {
            scriptFile = writeScriptFile(
                buildPowerShellScript(hwndInt, screenWidth, screenHeight)
            );

            proc = spawn('powershell.exe', [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-WindowStyle', 'Hidden',
                '-File', scriptFile,
            ], {
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch (err) {
            console.error('[WorkerW] Failed to start PowerShell:', err.message);
            resolve(false);
            return;
        }

        let stdout = '';
        let settled = false;

        const finish = (ok) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { proc.kill(); } catch (_) { /* 已退出 */ }
            resolve(ok);
        };

        // 超时保护：主进程不会被卡住，最坏情况只是这次注入判定为失败
        const timer = setTimeout(() => {
            console.warn(`[WorkerW] Injection timed out after ${INJECT_TIMEOUT_MS}ms`);
            finish(false);
        }, INJECT_TIMEOUT_MS);

        proc.stdout.setEncoding('utf8');
        proc.stdout.on('data', (chunk) => {
            stdout += chunk;

            for (const line of String(chunk).split('\n')) {
                const text = line.trim();
                if (text) console.log('[WorkerW PS]:', text);
            }

            if (stdout.includes('SUCCESS')) finish(true);
            else if (stdout.includes('FAILED')) finish(false);
            else if (stdout.includes('ERROR:')) finish(false);
        });

        proc.stderr.setEncoding('utf8');
        proc.stderr.on('data', (chunk) => {
            const text = String(chunk).trim();
            if (text) console.error('[WorkerW PS Error]:', text);
        });

        proc.on('error', (err) => {
            console.error('[WorkerW] PowerShell error:', err.message);
            finish(false);
        });

        proc.on('close', () => {
            finish(stdout.includes('SUCCESS'));
        });
    });
}

/**
 * 从壁纸层恢复窗口（退出时调用）。
 *
 * 用 spawn + unref 发一条即走命令：退出流程不必等 PowerShell 冷启动，
 * 而且父进程退出不会带走这个子进程。
 *
 * @param {Buffer|number} targetHwnd
 */
function restoreFromWallpaperLayer(targetHwnd) {
    const hwndInt = toHwndNumber(targetHwnd);
    if (!hwndInt) return;

    const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinAPI {
    [DllImport("user32.dll")]
    public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);
}
"@
[WinAPI]::SetParent([IntPtr]${hwndInt}, [IntPtr]::Zero)
`;

    try {
        const proc = spawn('powershell.exe', [
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
            '-EncodedCommand', toEncodedCommand(psScript),
        ], { windowsHide: true, stdio: 'ignore' });
        proc.unref();
    } catch (_) { /* 清理阶段，忽略错误 */ }
}

// ==================== PowerShell 脚本构建 ====================

/**
 * 构建注入脚本（内嵌 C# Win32 API 定义）。
 *
 * 脚本输出的判定标记（供 Node 侧识别）：
 *   SUCCESS / FAILED / ERROR: xxx
 * 其余以 DUMP| 开头的行是桌面层级诊断信息。
 *
 * @param {number} hwndInt
 * @param {number} screenWidth
 * @param {number} screenHeight
 * @returns {string}
 */
function buildPowerShellScript(hwndInt, screenWidth, screenHeight) {
    return `
$ErrorActionPreference = 'SilentlyContinue'

$csharpSource = @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public class WinAPI {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr FindWindowEx(IntPtr hwndParent, IntPtr hwndChildAfter,
        string lpszClass, string lpszWindow);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);

    [DllImport("user32.dll")]
    public static extern IntPtr GetParent(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter,
        int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg,
        IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool InvalidateRect(IntPtr hWnd, IntPtr lpRect, bool bErase);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool UpdateWindow(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool RedrawWindow(IntPtr hWnd, IntPtr lprcUpdate,
        IntPtr hrgnUpdate, uint flags);
}

public class WallpaperInjector {
    private const uint WM_SPAWN_WORKER = 0x052C;
    private const uint GA_PARENT = 1;

    private const int SWP_NOSIZE = 0x0001;
    private const int SWP_NOMOVE = 0x0002;
    private const int SWP_NOACTIVATE = 0x0010;
    private const int SWP_SHOWWINDOW = 0x0040;
    private const int SWP_ASYNCWINDOWPOS = 0x4000;
    private const int SWP_FRAMECHANGED = 0x0020;
    private const int HWND_BOTTOM = 1;

    private const int GWL_STYLE = -16;
    private const int WS_CHILD = 0x40000000;
    private const int WS_POPUP = unchecked((int)0x80000000);
    private const int WS_VISIBLE = 0x10000000;

    private const int SW_SHOW = 5;

    private const uint RDW_INVALIDATE = 0x0001;
    private const uint RDW_ERASE = 0x0004;
    private const uint RDW_FRAME = 0x0400;
    private const uint RDW_ALLCHILDREN = 0x0080;
    private const uint RDW_UPDATENOW = 0x0100;

    private static string Hex(IntPtr h) { return "0x" + h.ToInt64().ToString("X"); }

    private static string Cls(IntPtr h) {
        StringBuilder sb = new StringBuilder(256);
        WinAPI.GetClassName(h, sb, 256);
        return sb.ToString();
    }

    private static uint PidOf(IntPtr h) {
        uint pid = 0;
        WinAPI.GetWindowThreadProcessId(h, out pid);
        return pid;
    }

    // 递归判断某窗口的子树里有没有 SHELLDLL_DefView（桌面图标层）
    private static bool HasDefView(IntPtr h, int depth) {
        if (h == IntPtr.Zero || depth > 3) return false;

        IntPtr child = WinAPI.FindWindowEx(h, IntPtr.Zero, null, null);
        while (child != IntPtr.Zero) {
            if (Cls(child) == "SHELLDLL_DefView") return true;
            if (HasDefView(child, depth + 1)) return true;
            child = WinAPI.FindWindowEx(h, child, null, null);
        }
        return false;
    }

    // 从指定窗口往上逐级检查 WS_VISIBLE。
    // 链路里任何一级不可见，挂进去的窗口就会"消失"
    // （上次就是挂到了别的 Chromium 进程的隐藏 WorkerW 上）。
    private static bool ChainVisible(IntPtr h) {
        while (h != IntPtr.Zero) {
            if ((WinAPI.GetWindowLong(h, GWL_STYLE) & WS_VISIBLE) == 0) return false;
            h = WinAPI.GetAncestor(h, GA_PARENT);
        }
        return true;
    }

    // 挑选真正的"壁纸层" WorkerW。
    //
    // 关键：桌面上的顶层 WorkerW 有一大堆，其中大部分是别的 Chromium 程序
    // （Chrome / VS Code / 微信…）建的隐藏消息窗口，绝不能拿来当壁纸层，
    // 所以这里既用 PID 过滤，又要求父链可见。
    private static IntPtr FindWallpaperWorker(IntPtr progman, out string how) {
        uint shellPid = PidOf(progman);   // Progman 属于 explorer.exe

        // a) Progman 的直接子 WorkerW，且内部不含 DefView
        IntPtr c = WinAPI.FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);
        while (c != IntPtr.Zero) {
            Console.WriteLine("DUMP|  candidate(Progman child) " + Hex(c)
                + " pid=" + PidOf(c) + " visible=" + WinAPI.IsWindowVisible(c)
                + " hasDefView=" + HasDefView(c, 0));
            if (!HasDefView(c, 0) && ChainVisible(c)) {
                how = "Progman child WorkerW";
                return c;
            }
            c = WinAPI.FindWindowEx(progman, c, "WorkerW", null);
        }

        // b) 同属桌面进程的顶层 WorkerW
        IntPtr w = WinAPI.FindWindowEx(IntPtr.Zero, IntPtr.Zero, "WorkerW", null);
        while (w != IntPtr.Zero) {
            if (PidOf(w) == shellPid) {
                Console.WriteLine("DUMP|  candidate(top-level, shell pid) " + Hex(w)
                    + " visible=" + WinAPI.IsWindowVisible(w)
                    + " hasDefView=" + HasDefView(w, 0));
                if (!HasDefView(w, 0) && ChainVisible(w)) {
                    how = "top-level WorkerW of shell process";
                    return w;
                }
            }
            w = WinAPI.FindWindowEx(IntPtr.Zero, w, "WorkerW", null);
        }

        // c) 兜底：任意父链可见的顶层 WorkerW
        w = WinAPI.FindWindowEx(IntPtr.Zero, IntPtr.Zero, "WorkerW", null);
        while (w != IntPtr.Zero) {
            if (!HasDefView(w, 0) && ChainVisible(w)) {
                how = "fallback visible WorkerW";
                return w;
            }
            w = WinAPI.FindWindowEx(IntPtr.Zero, w, "WorkerW", null);
        }

        how = "none";
        return IntPtr.Zero;
    }

    // 跨进程 SetParent：后台线程 + 限时等待，避免调用线程被输入队列挂死。
    private static bool TrySetParent(IntPtr target, IntPtr parent) {
        Thread t = new Thread(delegate() { WinAPI.SetParent(target, parent); });
        t.IsBackground = true;
        t.Start();
        return t.Join(4000);
    }

    private static void DumpTree(IntPtr h, int depth, int maxDepth) {
        if (h == IntPtr.Zero || depth > maxDepth) return;

        Console.WriteLine("DUMP|" + new string(' ', depth * 2) + Cls(h)
            + " hwnd=" + Hex(h) + " visible=" + WinAPI.IsWindowVisible(h)
            + " pid=" + PidOf(h));

        IntPtr c = WinAPI.FindWindowEx(h, IntPtr.Zero, null, null);
        while (c != IntPtr.Zero) {
            DumpTree(c, depth + 1, maxDepth);
            c = WinAPI.FindWindowEx(h, c, null, null);
        }
    }

    // 把桌面层级打到日志里，方便按真实结构对症下药
    private static void DumpDesktop(IntPtr target, IntPtr progman, string phase) {
        Console.WriteLine("DUMP|--- desktop hierarchy (" + phase + ") ---");
        DumpTree(progman, 0, 2);

        IntPtr w = WinAPI.FindWindowEx(IntPtr.Zero, IntPtr.Zero, "WorkerW", null);
        while (w != IntPtr.Zero) {
            DumpTree(w, 0, 1);
            w = WinAPI.FindWindowEx(IntPtr.Zero, w, "WorkerW", null);
        }

        Console.WriteLine("DUMP|self hwnd=" + Hex(target)
            + " class=" + Cls(target)
            + " visible=" + WinAPI.IsWindowVisible(target)
            + " style=0x" + WinAPI.GetWindowLong(target, GWL_STYLE).ToString("X")
            + " GA_PARENT=" + Hex(WinAPI.GetAncestor(target, GA_PARENT))
            + " GetParent=" + Hex(WinAPI.GetParent(target)));
    }

    public static bool Inject(IntPtr target, int screenW, int screenH) {
        IntPtr progman = IntPtr.Zero;
        for (int i = 0; i < 20 && progman == IntPtr.Zero; i++) {
            progman = WinAPI.FindWindowEx(IntPtr.Zero, IntPtr.Zero, "Progman", null);
            if (progman == IntPtr.Zero) Thread.Sleep(100);
        }
        if (progman == IntPtr.Zero) {
            Console.WriteLine("ERROR: Progman not found");
            return false;
        }
        Console.WriteLine("Progman: " + Hex(progman));
        DumpDesktop(target, progman, "before");

        WinAPI.SendMessage(progman, WM_SPAWN_WORKER, IntPtr.Zero, IntPtr.Zero);
        Thread.Sleep(300);

        string how;
        IntPtr worker = FindWallpaperWorker(progman, out how);

        if (worker == IntPtr.Zero) {
            // 第二种触发方式（Wallpaper Engine / Lively 等使用的参数）
            WinAPI.SendMessage(progman, WM_SPAWN_WORKER, (IntPtr)0xD, (IntPtr)0x1);
            Thread.Sleep(300);
            worker = FindWallpaperWorker(progman, out how);
        }

        if (worker == IntPtr.Zero) {
            Console.WriteLine("ERROR: WorkerW not found");
            DumpDesktop(target, progman, "after");
            return false;
        }
        Console.WriteLine("WorkerW: " + Hex(worker) + " (" + how + ")");

        bool returned = TrySetParent(target, worker);
        IntPtr actual = WinAPI.GetAncestor(target, GA_PARENT);
        Console.WriteLine("SetParent returned=" + returned + ", GA_PARENT=" + Hex(actual));

        if (actual != worker) {
            // 兜底：SetParent 不会自动改窗口样式，补上 WS_CHILD 再来一次
            int style = WinAPI.GetWindowLong(target, GWL_STYLE);
            WinAPI.SetWindowLong(target, GWL_STYLE, (style & ~WS_POPUP) | WS_CHILD);
            Console.WriteLine("Retry with WS_CHILD (style 0x" + style.ToString("X") + ")");

            returned = TrySetParent(target, worker);
            actual = WinAPI.GetAncestor(target, GA_PARENT);
            Console.WriteLine("Retry SetParent returned=" + returned + ", GA_PARENT=" + Hex(actual));
        }

        if (actual != worker) {
            Console.WriteLine("FAILED: window is not attached to the wallpaper layer");
            DumpDesktop(target, progman, "after");
            return false;
        }

        // 铺满屏幕并压到该层最底部
        uint flags = SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE
            | SWP_SHOWWINDOW | SWP_ASYNCWINDOWPOS | SWP_FRAMECHANGED;
        WinAPI.SetWindowPos(target, (IntPtr)HWND_BOTTOM, 0, 0, screenW, screenH, flags);

        // 关键：子窗口是"事后"挂上去的，父窗口不会自动重画。
        // 不强制重绘，壁纸要等桌面下一次重绘才会显示出来。
        WinAPI.ShowWindow(target, SW_SHOW);
        WinAPI.InvalidateRect(target, IntPtr.Zero, true);
        WinAPI.UpdateWindow(target);
        WinAPI.RedrawWindow(worker, IntPtr.Zero, IntPtr.Zero,
            RDW_INVALIDATE | RDW_ERASE | RDW_FRAME | RDW_ALLCHILDREN | RDW_UPDATENOW);
        Console.WriteLine("Requested repaint of the wallpaper layer");

        DumpDesktop(target, progman, "after");
        Console.WriteLine("SUCCESS");
        return true;
    }
}
"@

# ---- 编译缓存：按 C# 源码 hash 存一份 dll，第二次启动直接加载 ----
# Add-Type 现场编译要好几秒，缓存后基本瞬间完成；任何一步失败都退回现场编译。
#
# 注意：判断类型是否可用必须用 '-as [type]'，不能用
# [System.Management.Automation.PSTypeName] 加速器 —— 实测它对
# Add-Type -Path 加载进来的程序集返回 False，会导致缓存永远不命中。
$typeReady = $false
$cacheDir = Join-Path $env:TEMP 'wallpaper-injector'
$sha = [System.Security.Cryptography.SHA256]::Create()
$hashBytes = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($csharpSource))
$hash = [BitConverter]::ToString($hashBytes).Replace('-', '').Substring(0, 16)
$dllPath = Join-Path $cacheDir ("injector-" + $hash + ".dll")

if (Test-Path -LiteralPath $dllPath) {
    Add-Type -Path $dllPath
    if ('WallpaperInjector' -as [type]) { $typeReady = $true }
}

if (-not $typeReady) {
    if (-not (Test-Path -LiteralPath $cacheDir)) {
        New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
    }
    Add-Type -TypeDefinition $csharpSource -OutputAssembly $dllPath
    Add-Type -Path $dllPath
    if ('WallpaperInjector' -as [type]) { $typeReady = $true }
}

if (-not $typeReady) {
    Add-Type -TypeDefinition $csharpSource
}

[WallpaperInjector]::Inject([IntPtr]${hwndInt}, ${screenWidth}, ${screenHeight})
`;
}

// ==================== 导出 ====================

module.exports = {
    injectToWallpaperLayer,
    restoreFromWallpaperLayer,
};
