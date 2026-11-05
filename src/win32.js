/**
 * win32.js — 在本进程里直接调用 user32.dll（koffi），壁纸注入、全屏检测、桌面点击检测共用
 *
 * 为什么不用 PowerShell 子进程（以前的做法）：
 *   有的电脑上安全软件不让程序启动隐藏的 PowerShell，spawn 直接报 EPERM / UNKNOWN，
 *   这三个功能会同时失效，壁纸退化成盖住桌面图标的普通窗口。进程内调用没有子进程可拦，
 *   也省掉了 PowerShell 冷启动和现场编译 C# 的几秒钟。
 *
 * 会给窗口发消息的调用（SetParent、SendMessage、RedrawWindow 等）都走 koffi 的 .async，
 * 在工作线程上执行：对方窗口卡住时主进程不跟着卡，主线程也能照常处理发给壁纸窗口的消息。
 * 只读调用不发消息，直接同步调。
 *
 * 窗口句柄用 uintptr_t，到 JS 里就是普通数字。
 */

'use strict';

const GA_PARENT = 1;
const GA_ROOT = 2;

const GWL_STYLE = -16;
const SM_CXSCREEN = 0;
const SM_CYSCREEN = 1;
const SM_REMOTESESSION = 0x1000;
const VK_LBUTTON = 0x01;

const SMTO_NORMAL = 0;
/** 发给 Progman 的消息最多等这么久（毫秒） */
const SEND_MESSAGE_TIMEOUT_MS = 2000;

const HWND_BOTTOM = 1;
const SW_SHOW = 5;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;
const SWP_FRAMECHANGED = 0x0020;
const SWP_SHOWWINDOW = 0x0040;
const SWP_ASYNCWINDOWPOS = 0x4000;

const RDW_INVALIDATE = 0x0001;
const RDW_ERASE = 0x0004;
const RDW_ALLCHILDREN = 0x0080;
const RDW_UPDATENOW = 0x0100;
const RDW_FRAME = 0x0400;

/** 在工作线程上调用，返回 Promise */
function runAsync(func, ...args) {
    return new Promise((resolve, reject) => {
        func.async(...args, (err, result) => (err ? reject(err) : resolve(result)));
    });
}

function load() {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');

    koffi.struct('RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
    koffi.struct('POINT', { x: 'int32_t', y: 'int32_t' });

    const FindWindowExW = user32.func('uintptr_t __stdcall FindWindowExW(uintptr_t parent, uintptr_t after, const char16_t *cls, const char16_t *title)');
    const GetClassNameW = user32.func('int __stdcall GetClassNameW(uintptr_t hwnd, _Out_ void *name, int size)');
    const GetWindowThreadProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(uintptr_t hwnd, _Out_ uint32_t *pid)');
    const IsWindowVisible = user32.func('int __stdcall IsWindowVisible(uintptr_t hwnd)');
    const GetWindowLongW = user32.func('int32_t __stdcall GetWindowLongW(uintptr_t hwnd, int index)');
    const GetAncestor = user32.func('uintptr_t __stdcall GetAncestor(uintptr_t hwnd, uint32_t flags)');
    const GetForegroundWindow = user32.func('uintptr_t __stdcall GetForegroundWindow()');
    const GetWindowRect = user32.func('int __stdcall GetWindowRect(uintptr_t hwnd, _Out_ RECT *rect)');
    const GetSystemMetrics = user32.func('int __stdcall GetSystemMetrics(int index)');
    const GetDpiForSystem = user32.func('uint32_t __stdcall GetDpiForSystem()');
    const GetAsyncKeyState = user32.func('int16_t __stdcall GetAsyncKeyState(int key)');
    const GetCursorPos = user32.func('int __stdcall GetCursorPos(_Out_ POINT *point)');
    const WindowFromPoint = user32.func('uintptr_t __stdcall WindowFromPoint(POINT point)');

    const SendMessageTimeoutW = user32.func('intptr_t __stdcall SendMessageTimeoutW(uintptr_t hwnd, uint32_t msg, uintptr_t wParam, intptr_t lParam, uint32_t flags, uint32_t timeout, void *result)');
    const SetParent = user32.func('uintptr_t __stdcall SetParent(uintptr_t child, uintptr_t parent)');
    const SetWindowLongW = user32.func('int32_t __stdcall SetWindowLongW(uintptr_t hwnd, int index, int32_t value)');
    const SetWindowPos = user32.func('int __stdcall SetWindowPos(uintptr_t hwnd, uintptr_t after, int x, int y, int cx, int cy, uint32_t flags)');
    const ShowWindow = user32.func('int __stdcall ShowWindow(uintptr_t hwnd, int cmd)');
    const InvalidateRect = user32.func('int __stdcall InvalidateRect(uintptr_t hwnd, void *rect, int erase)');
    const UpdateWindow = user32.func('int __stdcall UpdateWindow(uintptr_t hwnd)');
    const RedrawWindow = user32.func('int __stdcall RedrawWindow(uintptr_t hwnd, void *rect, void *region, uint32_t flags)');

    return {
        // ---- 只读，同步 ----

        /** @returns {number} 下一个匹配的窗口，没有就是 0（after 传 0 从第一个开始，按 Z 序从上到下） */
        findWindow: (parent, after, className = null) => FindWindowExW(parent, after, className, null),

        getClassName(hwnd) {
            const name = Buffer.alloc(512);
            const length = GetClassNameW(hwnd, name, 256);
            return name.toString('utf16le', 0, length * 2);
        },

        getProcessId(hwnd) {
            const pid = [0];
            GetWindowThreadProcessId(hwnd, pid);
            return pid[0];
        },

        isWindowVisible: (hwnd) => IsWindowVisible(hwnd) !== 0,
        getStyle: (hwnd) => GetWindowLongW(hwnd, GWL_STYLE),

        /** 注意不能用 GetParent：对非 WS_CHILD 窗口它返回的是 owner，不是父窗口 */
        getParentWindow: (hwnd) => GetAncestor(hwnd, GA_PARENT),
        getRootWindow: (hwnd) => GetAncestor(hwnd, GA_ROOT),

        getForegroundWindow: () => GetForegroundWindow(),

        getWindowRect(hwnd) {
            const rect = { left: 0, top: 0, right: 0, bottom: 0 };
            GetWindowRect(hwnd, rect);
            return rect;
        },

        /** 主显示器大小（物理像素，和 getWindowRect 同一单位） */
        getScreenSize: () => ({ width: GetSystemMetrics(SM_CXSCREEN), height: GetSystemMetrics(SM_CYSCREEN) }),
        getSystemDpi: () => GetDpiForSystem(),

        /** 是不是远程桌面会话 */
        isRemoteSession: () => GetSystemMetrics(SM_REMOTESESSION) !== 0,

        isLeftButtonDown: () => (GetAsyncKeyState(VK_LBUTTON) & 0x8000) !== 0,

        /** 鼠标位置（物理像素） */
        getCursorPos() {
            const point = { x: 0, y: 0 };
            GetCursorPos(point);
            return point;
        },

        windowFromPoint: (point) => WindowFromPoint(point),

        // ---- 会发消息，工作线程 ----

        sendMessage: (hwnd, msg, wParam, lParam) =>
            runAsync(SendMessageTimeoutW, hwnd, msg, wParam, lParam, SMTO_NORMAL, SEND_MESSAGE_TIMEOUT_MS, null),

        setParent: (child, parent) => runAsync(SetParent, child, parent),
        setStyle: (hwnd, style) => runAsync(SetWindowLongW, hwnd, GWL_STYLE, style),

        /**
         * 把窗口压到父窗口里的最底层并显示，再让父窗口重绘。
         * 子窗口是事后挂上去的，父窗口不会自动重画，不重绘要等桌面下次刷新才看得到。
         */
        async pushToBottomAndRepaint(hwnd, parent) {
            await runAsync(SetWindowPos, hwnd, HWND_BOTTOM, 0, 0, 0, 0,
                SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_ASYNCWINDOWPOS | SWP_FRAMECHANGED);
            await runAsync(ShowWindow, hwnd, SW_SHOW);
            await runAsync(InvalidateRect, hwnd, null, 1);
            await runAsync(UpdateWindow, hwnd);
            await runAsync(RedrawWindow, parent, null, null,
                RDW_INVALIDATE | RDW_ERASE | RDW_FRAME | RDW_ALLCHILDREN | RDW_UPDATENOW);
        },
    };
}

let instance = null;

/**
 * 取 win32 接口，第一次调用时才加载 koffi 和 user32.dll（测试用假接口时不用加载）。
 * @throws 原生模块加载失败时抛异常，调用方自己决定怎么退化
 */
function getWin32() {
    if (!instance) instance = load();
    return instance;
}

module.exports = { getWin32 };
