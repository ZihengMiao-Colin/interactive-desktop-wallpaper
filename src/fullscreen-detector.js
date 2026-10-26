/**
 * ============================================================================
 * fullscreen-detector.js — 性能守卫 / 全屏检测模块
 * ============================================================================
 *
 * 功能：检测用户是否在使用全屏应用（游戏、视频播放器等），
 *       在合适的时候暂停/恢复壁纸渲染，释放 GPU 资源。
 *
 * ---------------------------------------------------------------------------
 * 为什么改成「常驻一个 PowerShell」而不是「每秒起一个」（v2 改动）
 * ---------------------------------------------------------------------------
 * 旧实现每秒 spawnSync 一个 powershell.exe，并在里面用 Add-Type 现场编译 C#：
 *   - 实测单次耗时 1.5 秒（首次 3.4 秒），光是 PowerShell 冷启动就要 1.1 秒
 *   - spawnSync 是同步调用，Electron 主进程会被完全阻塞
 *   → 表现：托盘右键无响应、设置窗口打不开、鼠标视差卡顿
 *
 * 新实现：
 *   1. 只 spawn 一次常驻 powershell.exe（异步，不阻塞主进程）
 *   2. C# 助手在里面 Add-Type 编译一次，然后进程内循环检测
 *   3. 每秒只往 stdout 写一行 FULLSCREEN / NORMAL，主进程按行读取
 *   4. 助手异常退出会自动重启（连续失败 5 次后放弃），stop() 时杀掉，不留孤儿进程
 *
 * 另外修掉旧脚本里的硬 bug：
 *   旧脚本用 [System.Windows.Forms.Screen]，但 PowerShell 5.1 默认没有加载
 *   System.Windows.Forms 程序集，于是每次都抛 "Unable to find type"，
 *   屏幕面积算成 0，判断永远返回 NORMAL —— 纯烧 CPU，功能完全没生效。
 *   新脚本改用 GetSystemMetrics，无程序集依赖。
 * ============================================================================
 */

const { spawn } = require('child_process');

/** 助手进程连续异常退出多少次后放弃 */
const MAX_RESTARTS = 5;

/** 助手异常退出后的重启延迟（毫秒） */
const RESTART_DELAY = 3000;

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

/**
 * 全屏检测器。
 */
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

        /** 常驻助手进程 */
        this._proc = null;

        /** stdout 行缓冲 */
        this._buffer = '';

        /** 是否处于运行状态（stop 后不再重启） */
        this._stopped = true;

        /** 连续异常退出次数 */
        this._restarts = 0;

        /** 重启定时器 */
        this._restartTimer = null;

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

    /**
     * 启动检测（异步，立即返回，不阻塞主进程）。
     */
    start() {
        if (!this._stopped) return;

        this._stopped = false;
        this._restarts = 0;
        console.log(`[FullscreenDetector] Starting helper (interval: ${this.pollInterval}ms)`);
        this._spawnHelper();
    }

    /**
     * 停止检测并杀掉助手进程。
     */
    stop() {
        this._stopped = true;

        if (this._restartTimer) {
            clearTimeout(this._restartTimer);
            this._restartTimer = null;
        }

        if (this._proc) {
            const proc = this._proc;
            this._proc = null;
            try { proc.kill(); } catch (_) { /* 退出阶段忽略 */ }
            console.log('[FullscreenDetector] Helper stopped');
        }
    }

    // ==================== 内部方法 ====================

    /**
     * 拉起常驻助手进程。
     */
    _spawnHelper() {
        if (this._stopped) return;

        let proc;
        try {
            proc = spawn('powershell.exe', [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-WindowStyle', 'Hidden',
                '-EncodedCommand', toEncodedCommand(buildHelperScript(this.pollInterval)),
            ], {
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch (err) {
            console.error('[FullscreenDetector] Failed to spawn helper:', err.message);
            return;
        }

        this._proc = proc;
        this._buffer = '';

        proc.stdout.setEncoding('utf8');
        proc.stdout.on('data', (chunk) => this._onStdout(chunk));

        proc.stderr.setEncoding('utf8');
        proc.stderr.on('data', (chunk) => {
            const text = String(chunk).trim();
            if (text) console.error('[FullscreenDetector:helper]', text);
        });

        proc.on('error', (err) => {
            console.error('[FullscreenDetector] Helper error:', err.message);
        });

        proc.on('exit', (code) => {
            if (this._proc === proc) this._proc = null;
            if (this._stopped) return;

            this._restarts += 1;
            if (this._restarts > MAX_RESTARTS) {
                console.error('[FullscreenDetector] Helper keeps dying, giving up (render pause disabled)');
                return;
            }

            console.warn(`[FullscreenDetector] Helper exited (code ${code}), restarting in ${RESTART_DELAY}ms`);
            this._restartTimer = setTimeout(() => {
                this._restartTimer = null;
                this._spawnHelper();
            }, RESTART_DELAY);
        });
    }

    /**
     * 解析助手输出。助手每秒写一行 "FULLSCREEN <前台窗口进程号>" 或 NORMAL。
     * @param {string} chunk
     */
    _onStdout(chunk) {
        this._buffer += chunk;

        let index;
        while ((index = this._buffer.indexOf('\n')) >= 0) {
            const line = this._buffer.slice(0, index).trim();
            this._buffer = this._buffer.slice(index + 1);

            if (!line) continue;

            if (line === 'READY') {
                this._restarts = 0;   // 正常跑起来了，重置重启计数
                console.log('[FullscreenDetector] Helper ready');
            } else if (line.startsWith('FULLSCREEN')) {
                const pid = parseInt(line.slice('FULLSCREEN'.length), 10);
                this._report(!(this.ignorePid && pid === this.ignorePid));
            } else if (line.startsWith('NORMAL')) {
                this._report(false);
            }
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
