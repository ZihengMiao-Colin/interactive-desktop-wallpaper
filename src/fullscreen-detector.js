/**
 * fullscreen-detector.js — 全屏检测：用户在用全屏应用（游戏、视频播放器等）时暂停壁纸渲染，释放 GPU
 *
 * 常驻一个 PowerShell 助手（见 ps-helper.js），每秒写一行 "FULLSCREEN <前台窗口进程号>" 或 NORMAL；
 * 连续几次同状态才真正切换（防抖）。
 *
 * 屏幕尺寸用 GetSystemMetrics 取：PowerShell 5.1 默认没有加载 System.Windows.Forms，
 * 旧脚本用 [System.Windows.Forms.Screen] 时每次都抛异常、判断永远是 NORMAL，功能完全没生效。
 */

const { PowerShellHelper } = require('./ps-helper');

/**
 * 生成常驻检测助手脚本。
 *
 * 注意：脚本内不要出现 "${"（会被外层 JS 模板字符串当成插值）。
 *
 * @param {number} intervalMs - 助手的内部检测间隔
 * @returns {string} PowerShell 脚本
 */
function buildHelperScript(intervalMs) {
    return `
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class WCheck {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder cls, int count);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@

$screenW = [WCheck]::GetSystemMetrics(0)
$screenH = [WCheck]::GetSystemMetrics(1)
if ($screenW -le 0) { $screenW = 1920 }
if ($screenH -le 0) { $screenH = 1080 }
$screenArea = [double]$screenW * [double]$screenH

[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()

while ($true) {
    $state = 'NORMAL'
    $hwnd = [WCheck]::GetForegroundWindow()
    if ($hwnd -ne [IntPtr]::Zero) {
        $rect = New-Object WCheck+RECT
        [void][WCheck]::GetWindowRect($hwnd, [ref]$rect)
        $w = $rect.Right - $rect.Left
        $h = $rect.Bottom - $rect.Top
        $cls = New-Object System.Text.StringBuilder 256
        [void][WCheck]::GetClassName($hwnd, $cls, 256)
        $name = $cls.ToString()
        $isShell = ($name -eq 'Progman' -or $name -eq 'WorkerW' -or $name -eq 'Shell_TrayWnd' -or $name -eq 'MSTaskSwWClass')
        $coverage = ([double]$w * [double]$h) / $screenArea
        if ($coverage -ge 0.90 -and -not $isShell) {
            # 带上前台窗口的进程号，主进程据此忽略本程序自己的窗口（例如摆放窗口）
            $fgPid = [uint32]0
            [void][WCheck]::GetWindowThreadProcessId($hwnd, [ref]$fgPid)
            $state = 'FULLSCREEN ' + $fgPid
        }
    }
    [Console]::Out.WriteLine($state)
    [Console]::Out.Flush()
    Start-Sleep -Milliseconds ${intervalMs}
}
`;
}

class FullscreenDetector {
    /**
     * @param {Object} options
     * @param {number} options.pollInterval - 检测间隔（毫秒）
     * @param {number} options.debounceCount - 防抖次数（默认 2）
     * @param {Function} options.onFullscreenStart - 全屏开始回调
     * @param {Function} options.onFullscreenEnd - 全屏结束回调
     * @param {number} [options.ignorePid] - 属于这个进程的全屏窗口不算全屏应用（传主进程 pid）
     */
    constructor(options = {}) {
        this.pollInterval = options.pollInterval || 1000;
        this.debounceCount = options.debounceCount || 2;
        this.onFullscreenStart = options.onFullscreenStart || (() => {});
        this.onFullscreenEnd = options.onFullscreenEnd || (() => {});
        this.ignorePid = options.ignorePid || null;

        this._helper = new PowerShellHelper({
            name: 'FullscreenDetector',
            script: buildHelperScript(this.pollInterval),
            onLine: (line) => this._onLine(line),
        });

        this._isFullscreen = false;
        this._fullscreenCounter = 0;
        this._normalCounter = 0;
        this._rendererReady = false;
    }

    /**
     * 设置渲染器是否就绪。
     * 如果渲染器还没准备好，即使检测到全屏结束也不发送 resume。
     */
    setRendererReady(ready) {
        this._rendererReady = ready;
    }

    /** 启动检测（异步，立即返回，不阻塞主进程） */
    start() {
        this._helper.start();
    }

    /** 停止检测并杀掉助手进程 */
    stop() {
        this._helper.stop();
    }

    // ==================== 内部方法 ====================

    /** 助手每秒一行："FULLSCREEN <前台窗口进程号>" 或 NORMAL */
    _onLine(line) {
        if (line.startsWith('FULLSCREEN')) {
            const pid = parseInt(line.slice('FULLSCREEN'.length), 10);
            this._report(!(this.ignorePid && pid === this.ignorePid));
        } else if (line.startsWith('NORMAL')) {
            this._report(false);
        }
    }

    /**
     * 带防抖的状态上报：连续 N 次同状态才真正切换。
     * @param {boolean} isFullscreenNow
     */
    _report(isFullscreenNow) {
        if (isFullscreenNow) {
            this._fullscreenCounter++;
            this._normalCounter = 0;

            if (this._fullscreenCounter >= this.debounceCount && !this._isFullscreen) {
                console.log('[FullscreenDetector] Pausing render');
                this._isFullscreen = true;
                this.onFullscreenStart();
            }
        } else {
            this._normalCounter++;
            this._fullscreenCounter = 0;

            if (this._normalCounter >= this.debounceCount && this._isFullscreen) {
                if (this._rendererReady) {
                    console.log('[FullscreenDetector] Resuming render');
                    this._isFullscreen = false;
                    this.onFullscreenEnd();
                }
            }
        }
    }
}

module.exports = { FullscreenDetector };
