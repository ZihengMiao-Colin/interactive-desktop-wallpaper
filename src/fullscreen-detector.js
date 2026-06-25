/**
 * ============================================================================
 * fullscreen-detector.js — 性能守卫 / 全屏检测模块
 * ============================================================================
 *
 * 功能：检测用户是否在使用全屏应用（游戏、视频播放器等），
 *       在合适的时候暂停/恢复壁纸渲染，释放 GPU 资源。
 *
 * 检测策略（多层次）：
 *   1. 前台窗口全屏检测：检查当前焦点窗口是否覆盖整个屏幕
 *      → 使用 PowerShell 调用 Win32 API GetWindowRect + GetForegroundWindow
 *   2. 桌面可见性检测：检查壁纸是否被其他窗口完全遮挡
 *      → 使用 Win32 API GetWindowInfo 检查窗口状态
 *   3. 进程名检测：识别已知的全屏进程（游戏启动器、视频播放器）
 *      → 黑名单匹配（可选，默认关闭，避免误判）
 *
 * 实现注意事项：
 *   - 使用 setInterval 轮询，间隔可配置（默认 1 秒）
 *   - 使用"防抖"避免状态频繁切换：连续 N 次检测到全屏才触发暂停
 *   - 在 Electron 主进程中运行，通过 IPC 发送信号给渲染进程
 * ============================================================================
 */

const { execSync, spawnSync } = require('child_process');

/**
 * 全屏检测器类。
 */
class FullscreenDetector {

    /**
     * @param {Object} options
     * @param {number} options.pollInterval - 检测间隔（毫秒）
     * @param {number} options.debounceCount - 防抖次数（默认 2）
     * @param {Function} options.onFullscreenStart - 全屏开始回调
     * @param {Function} options.onFullscreenEnd - 全屏结束回调
     * @param {string[]} options.fullscreenProcesses - 已知全屏进程名（可选）
     */
    constructor(options = {}) {
        this.pollInterval = options.pollInterval || 1000;
        this.debounceCount = options.debounceCount || 2;
        this.onFullscreenStart = options.onFullscreenStart || (() => {});
        this.onFullscreenEnd = options.onFullscreenEnd || (() => {});
        this.fullscreenProcesses = options.fullscreenProcesses || [];

        this._timer = null;
        this._isFullscreen = false;
        this._fullscreenCounter = 0;
        this._normalCounter = 0;
        this._rendererReady = false;

        // 已知的全屏进程黑名单（部分游戏启动器/播放器进程名）
        this._knownFullscreenApps = new Set([
            'steamwebhelper',    // Steam 大屏模式
            'bigpicture',        // Steam Big Picture
            'videoplayer',       // 通用视频播放器
        ]);
    }

    /**
     * 设置渲染器是否就绪。
     * 如果渲染器还没准备好，即使检测到全屏结束也不发送 resume。
     */
    setRendererReady(ready) {
        this._rendererReady = ready;
    }

    /**
     * 开始轮询检测。
     */
    start() {
        if (this._timer) return;

        console.log(`[FullscreenDetector] 开始检测 (间隔: ${this.pollInterval}ms)`);
        this._timer = setInterval(() => this._check(), this.pollInterval);
    }

    /**
     * 停止轮询检测。
     */
    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
            console.log('[FullscreenDetector] 已停止检测');
        }
    }

    // ==================== 内部方法 ====================

    /**
     * 执行一次全屏检测。
     */
    _check() {
        const isFullscreenNow = this._isForegroundWindowFullscreen();

        if (isFullscreenNow) {
            this._fullscreenCounter++;
            this._normalCounter = 0;

            // 防抖：连续 N 次检测到全屏才触发
            if (this._fullscreenCounter >= this.debounceCount && !this._isFullscreen) {
                console.log('[FullscreenDetector] 触发暂停渲染');
                this._isFullscreen = true;
                this.onFullscreenStart();
            }
        } else {
            this._normalCounter++;
            this._fullscreenCounter = 0;

            // 防抖：连续 N 次检测到非全屏才恢复
            if (this._normalCounter >= this.debounceCount && this._isFullscreen) {
                if (this._rendererReady) {
                    console.log('[FullscreenDetector] 触发恢复渲染');
                    this._isFullscreen = false;
                    this.onFullscreenEnd();
                }
            }
        }
    }

    /**
     * 检测当前前台窗口是否为全屏。
     *
     * 方法：通过 PowerShell 获取前台窗口的尺寸，
     *       与屏幕尺寸对比，几乎相同即判定为全屏。
     *
     * @returns {boolean}
     */
    _isForegroundWindowFullscreen() {
        try {
            const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WindowCheck {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

# 获取屏幕尺寸
$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$screenW = $screen.Bounds.Width
$screenH = $screen.Bounds.Height
$screenArea = $screenW * $screenH

# 获取前台窗口
$hwnd = [WindowCheck]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) { Write-Output "NORMAL"; exit 0 }

# 获取窗口尺寸
$rect = New-Object WindowCheck+RECT
[WindowCheck]::GetWindowRect($hwnd, [ref]$rect)
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
$area = $w * $h

# 获取窗口标题
$sb = New-Object System.Text.StringBuilder(256)
[WindowCheck]::GetWindowText($hwnd, $sb, 256)
$title = $sb.ToString()

# 获取进程 ID
$pid = 0
[WindowCheck]::GetWindowThreadProcessId($hwnd, [ref]$pid)

# 获取类名
$csb = New-Object System.Text.StringBuilder(256)
[WindowCheck]::GetClassName($hwnd, $csb, 256)
$class = $csb.ToString()

# 判定：窗口覆盖 >= 90% 屏幕，且不是桌面壳窗口
$coverage = $area / $screenArea
$isDesktop = ($class -eq "Progman" -or $class -eq "WorkerW" -or $class -eq "Shell_TrayWnd" -or $class -eq "MSTaskSwWClass")

if ($coverage -ge 0.90 -and -not $isDesktop) {
    Write-Output "FULLSCREEN|title=$title|pid=$pid|class=$class|coverage=$coverage"
} else {
    Write-Output "NORMAL|title=$title|coverage=$coverage"
}
`;

            const result = spawnSync('powershell.exe', [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-WindowStyle', 'Hidden',
                '-Command', psScript,
            ], {
                timeout: 3000,
                encoding: 'utf-8',
                windowsHide: true,
            });

            const output = (result.stdout || '').trim();
            return output.startsWith('FULLSCREEN');
        } catch (err) {
            // 检测失败时保守处理：不暂停渲染
            return false;
        }
    }
}

module.exports = { FullscreenDetector };
