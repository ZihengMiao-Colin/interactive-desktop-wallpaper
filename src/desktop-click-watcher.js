/**
 * desktop-click-watcher.js — 检测桌面上的鼠标单击
 *
 * 壁纸窗口在桌面图标后面，收不到鼠标事件，所以由常驻 PowerShell 助手（见 ps-helper.js）
 * 里的 C# 循环每隔一小段时间读一次左键状态：按下到松开足够快、位置几乎没动才算一次单击
 * （拖选框、拖图标不算）；松开时鼠标下面是桌面（根窗口类名 Progman / WorkerW）才输出 CLICK。
 * 只在有"点击播放"的元素时开启，没有时停掉，不白占 CPU。
 */

const { PowerShellHelper } = require('./ps-helper');

/** 读取左键状态的间隔（毫秒） */
const POLL_MS = 15;
/** 按下到松开超过这么久不算单击（毫秒） */
const CLICK_MAX_MS = 500;
/** 按下到松开移动超过这么多像素不算单击 */
const CLICK_MAX_MOVE_PX = 6;

/**
 * 生成助手脚本。注意：脚本内不要出现 "${"（会被外层 JS 模板字符串当成插值）。
 */
function buildClickScript() {
    return `
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class DesktopClick {
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }

    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hWnd, StringBuilder cls, int count);

    // 鼠标下面的顶层窗口是不是桌面（图标层和壁纸层都挂在 Progman / WorkerW 下面）
    static bool IsDesktop(POINT p) {
        IntPtr root = GetAncestor(WindowFromPoint(p), 2);
        if (root == IntPtr.Zero) return false;
        StringBuilder cls = new StringBuilder(64);
        GetClassName(root, cls, 64);
        string name = cls.ToString();
        return name == "Progman" || name == "WorkerW";
    }

    public static void Run(int pollMs, int maxMs, int maxMove) {
        bool wasDown = false;
        POINT start = new POINT();
        int downAt = 0;
        while (true) {
            bool down = (GetAsyncKeyState(0x01) & 0x8000) != 0;
            if (down && !wasDown) {
                GetCursorPos(out start);
                downAt = Environment.TickCount;
            } else if (!down && wasDown) {
                POINT p;
                GetCursorPos(out p);
                if (Environment.TickCount - downAt <= maxMs
                    && Math.Abs(p.X - start.X) <= maxMove && Math.Abs(p.Y - start.Y) <= maxMove
                    && IsDesktop(p)) {
                    Console.Out.WriteLine("CLICK");
                    Console.Out.Flush();
                }
            }
            wasDown = down;
            Thread.Sleep(pollMs);
        }
    }
}
"@

[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()
[DesktopClick]::Run(${POLL_MS}, ${CLICK_MAX_MS}, ${CLICK_MAX_MOVE_PX})
`;
}

class DesktopClickWatcher {
    /** @param {{ onClick: () => void }} options - 桌面被单击时调用（坐标由调用方读当前鼠标位置） */
    constructor({ onClick }) {
        this._helper = new PowerShellHelper({
            name: 'DesktopClick',
            script: buildClickScript(),
            onLine: (line) => {
                if (line === 'CLICK') onClick();
            },
        });
    }

    /** 需要时开启，不需要时停掉 */
    setEnabled(enabled) {
        if (enabled) this._helper.start();
        else this._helper.stop();
    }

    stop() {
        this._helper.stop();
    }
}

module.exports = { DesktopClickWatcher };
