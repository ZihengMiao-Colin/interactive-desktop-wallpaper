/**
 * ============================================================================
 * wallpaper-native.js — Windows 原生壁纸层注入模块
 * ============================================================================
 *
 * 功能：将 Electron BrowserWindow 注入到 Windows Desktop WorkerW 层，
 *       使其成为桌面图标下方的"活壁纸"。
 *
 * 技术原理：
 *   Windows 桌面由多层窗口构成：
 *     ┌─────────────────────────┐
 *     │  桌面图标 (SHELLDLL)     │ ← 最上层，用户看到图标
 *     │  WorkerW #2 (图标背景)   │ ← 图标后面的容器
 *     │  WorkerW #1 (壁纸层)     │ ← 🎯 我们要注入到这里
 *     │  Progman (Program Manager)│ ← 桌面管理器根窗口
 *     └─────────────────────────┘
 *
 * 注入流程：
 *   1. 找到 Progman 窗口
 *   2. 发送 0x052C 消息（SPI_SETDESKWALLPAPER 的一部分），触发 WorkerW 创建
 *   3. 遍历 Progman 的子窗口，找到正确的 WorkerW
 *   4. 使用 SetParent 将我们的窗口挂载为 WorkerW 的子窗口
 *   5. 使用 SetWindowPos 将窗口设为 Z 序最底层
 *
 * 兼容方式：
 *   本模块通过 PowerShell + C# Add-Type 实现 Win32 API 调用，
 *   避免编译原生 C++ 模块（ffi-napi 需要完整的 Visual Studio 工具链）。
 * ============================================================================
 */

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ==================== Win32 API 常量 ====================

const HWND_BOTTOM = 1;
const HWND_NOTOPMOST = -2;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;
const SWP_SHOWWINDOW = 0x0040;
const SWP_ASYNCWINDOWPOS = 0x4000;

// ==================== PowerShell + C# Win32 API 封装 ====================

/**
 * 生成并执行 PowerShell 脚本，将目标窗口注入 WorkerW 层。
 *
 * @param {number} targetHwnd - Electron 窗口的原始句柄 (Buffer → int)
 * @param {number} screenWidth - 屏幕宽度
 * @param {number} screenHeight - 屏幕高度
 * @returns {boolean} 是否注入成功
 */
function injectToWallpaperLayer(targetHwnd, screenWidth, screenHeight) {
    // 将 Buffer 类型的窗口句柄转换为整数
    const hwndInt = typeof targetHwnd === 'number'
        ? targetHwnd
        : targetHwnd.readInt32LE(0);

    console.log(`[WorkerW] 目标窗口句柄: 0x${hwndInt.toString(16)}`);
    console.log(`[WorkerW] 屏幕尺寸: ${screenWidth}x${screenHeight}`);

    // 构建 PowerShell 脚本（内嵌 C# Win32 API 定义）
    const psScript = buildPowerShellScript(hwndInt, screenWidth, screenHeight);

    try {
        const result = spawnSync('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-WindowStyle', 'Hidden',
            '-Command', psScript,
        ], {
            timeout: 10000,
            encoding: 'utf-8',
            windowsHide: true,
        });

        const stdout = (result.stdout || '').trim();
        const stderr = (result.stderr || '').trim();

        if (stdout) console.log('[WorkerW PS]:', stdout);
        if (stderr) console.error('[WorkerW PS Error]:', stderr);

        // 检查输出中是否包含成功标记
        const success = stdout.includes('SUCCESS');

        if (!success) {
            console.warn('[WorkerW] PowerShell 注入未返回成功标记，尝试备用方案...');
            return fallbackInjection(hwndInt, screenWidth, screenHeight);
        }

        return true;
    } catch (err) {
        console.error('[WorkerW] PowerShell 执行异常:', err.message);
        return fallbackInjection(hwndInt, screenWidth, screenHeight);
    }
}

/**
 * 备用方案：直接通过 Node.js child_process 调用简单的 C# 编译器。
 * 如果系统有 csc.exe (C# compiler)，直接编译并运行一个微型 helper。
 */
function fallbackInjection(hwndInt, screenWidth, screenHeight) {
    console.log('[WorkerW] 尝试备用注入方案...');

    // 检查是否有 csc.exe（通常随 .NET Framework 安装）
    const cscPath = `${process.env.SystemRoot}\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe`;

    if (!fs.existsSync(cscPath)) {
        console.warn('[WorkerW] 未找到 csc.exe，无法编译注入 helper');
        console.warn('[WorkerW] 壁纸将以普通窗口模式运行（非嵌入式）');
        return false;
    }

    try {
        // 生成 C# helper 源代码
        const csCode = buildCSharpHelper(hwndInt, screenWidth, screenHeight);
        const tmpDir = path.join(require('electron').app.getPath('temp'), 'wallpaper-injector');
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

        const csFile = path.join(tmpDir, 'injector.cs');
        const exeFile = path.join(tmpDir, 'injector.exe');

        fs.writeFileSync(csFile, csCode, 'utf-8');

        // 编译
        execSync(`"${cscPath}" /out:"${exeFile}" "${csFile}"`, {
            timeout: 15000,
            windowsHide: true,
        });

        // 执行
        const result = execSync(`"${exeFile}"`, {
            timeout: 5000,
            windowsHide: true,
            encoding: 'utf-8',
        });

        console.log('[WorkerW C#]:', result.trim());
        return result.includes('SUCCESS');
    } catch (err) {
        console.error('[WorkerW] 备用方案也失败了:', err.message);
        console.warn('[WorkerW] 壁纸将以普通窗口模式运行');
        return false;
    }
}

/**
 * 从 WorkerW 层恢复窗口（退出时调用）。
 */
function restoreFromWallpaperLayer(targetHwnd) {
    const hwndInt = typeof targetHwnd === 'number'
        ? targetHwnd
        : targetHwnd?.readInt32LE(0) || 0;

    if (!hwndInt) return;

    const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinAPI {
    [DllImport("user32.dll")]
    public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);
}
"@
[WinAPI]::SetParent([IntPtr]${hwndInt}, [IntPtr]::Zero)
Write-Output "RESTORED"
`;

    try {
        spawnSync('powershell.exe', [
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
            '-Command', psScript,
        ], { timeout: 5000, windowsHide: true });
    } catch { /* 清理阶段，忽略错误 */ }
}

// ==================== PowerShell 脚本构建 ====================

function buildPowerShellScript(hwndInt, screenWidth, screenHeight) {
    return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class WinAPI {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr FindWindowEx(IntPtr hwndParent, IntPtr hwndChildAfter,
        string lpszClass, string lpszWindow);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter,
        int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg,
        IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
}

public class WallpaperInjector {
    private const uint WM_SPAWN_WORKER = 0x052C;
    private const uint GW_HWNDNEXT = 2;
    private const int SWP_NOSIZE = 0x0001;
    private const int SWP_NOMOVE = 0x0002;
    private const int SWP_NOACTIVATE = 0x0010;
    private const int SWP_SHOWWINDOW = 0x0040;
    private const int SWP_ASYNCWINDOWPOS = 0x4000;
    private const int HWND_BOTTOM = 1;

    public static bool Inject(IntPtr targetHwnd, int screenW, int screenH) {
        try {
            // 第 1 步：找到 Progman 窗口
            IntPtr progman = WinAPI.FindWindowEx(IntPtr.Zero, IntPtr.Zero, "Progman", null);
            if (progman == IntPtr.Zero) {
                Console.WriteLine("ERROR: Cannot find Progman");
                return false;
            }
            Console.WriteLine("Found Progman: 0x{0:X}", progman.ToInt64());

            // 第 2 步：发送 0x052C 消息，触发 WorkerW 创建
            // 这个消息告诉系统：壁纸已更换，需要刷新壁纸层
            IntPtr result = WinAPI.SendMessage(progman, WM_SPAWN_WORKER, IntPtr.Zero, IntPtr.Zero);
            Console.WriteLine("Sent 0x052C to Progman");

            // 等待一下让 WorkerW 创建完成
            System.Threading.Thread.Sleep(200);

            // 第 3 步：遍历 Progman 的子窗口找 WorkerW
            // WorkerW 是 Progman 的直属子窗口
            // 通常有 2 个 WorkerW：第一个是壁纸层，第二个是图标层
            IntPtr workerW = IntPtr.Zero;
            IntPtr child = WinAPI.FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);

            while (child != IntPtr.Zero) {
                StringBuilder sb = new StringBuilder(256);
                WinAPI.GetClassName(child, sb, 256);

                // 检查这个 WorkerW 是否可见（不可见的那个是我们需要的壁纸层）
                bool visible = WinAPI.IsWindowVisible(child);
                Console.WriteLine("Found WorkerW: 0x{0:X}, Visible={1}", child.ToInt64(), visible);

                if (visible) {
                    // 第一个可见的 WorkerW 通常是壁纸层
                    // 把我们的窗口设为它的子窗口
                    workerW = child;
                }

                child = WinAPI.FindWindowEx(progman, child, "WorkerW", null);
            }

            if (workerW == IntPtr.Zero) {
                // 如果找不到可见的 WorkerW，尝试使用备用方案
                Console.WriteLine("WARNING: No suitable WorkerW found, trying alternative...");

                // 尝试找一个已存在的 WorkerW（即使是不可见的）
                workerW = WinAPI.FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);
                if (workerW == IntPtr.Zero) {
                    Console.WriteLine("ERROR: No WorkerW found at all");
                    return false;
                }
            }

            Console.WriteLine("Target WorkerW: 0x{0:X}", workerW.ToInt64());

            // 第 4 步：将我们的窗口设为 WorkerW 的子窗口
            IntPtr oldParent = WinAPI.SetParent(targetHwnd, workerW);
            Console.WriteLine("SetParent: OldParent=0x{0:X}", oldParent.ToInt64());

            // 第 5 步：设置窗口层级为最底层
            uint flags = SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_ASYNCWINDOWPOS;
            WinAPI.SetWindowPos(targetHwnd, (IntPtr)HWND_BOTTOM, 0, 0, screenW, screenH, flags);
            Console.WriteLine("SetWindowPos: placed at bottom");

            Console.WriteLine("SUCCESS");
            return true;
        } catch (Exception ex) {
            Console.WriteLine("EXCEPTION: " + ex.Message);
            return false;
        }
    }
}
"@

# 执行注入
[WallpaperInjector]::Inject([IntPtr]${hwndInt}, ${screenWidth}, ${screenHeight})
`;
}

// ==================== C# Helper（备用方案） ====================

function buildCSharpHelper(hwndInt, screenWidth, screenHeight) {
    return `
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

class Injector {
    [DllImport("user32.dll")]
    static extern IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string className, string windowName);

    [DllImport("user32.dll")]
    static extern IntPtr SetParent(IntPtr child, IntPtr newParent);

    [DllImport("user32.dll")]
    static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int X, int Y, int cx, int cy, uint flags);

    [DllImport("user32.dll")]
    static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    static extern bool IsWindowVisible(IntPtr hWnd);

    static void Main() {
        IntPtr target = (IntPtr)${hwndInt};
        int sw = ${screenWidth}, sh = ${screenHeight};

        IntPtr progman = FindWindowEx(IntPtr.Zero, IntPtr.Zero, "Progman", null);
        if (progman == IntPtr.Zero) { Console.WriteLine("ERROR: Progman not found"); return; }

        SendMessage(progman, 0x052C, IntPtr.Zero, IntPtr.Zero);
        Thread.Sleep(300);

        IntPtr worker = IntPtr.Zero;
        IntPtr child = FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);
        while (child != IntPtr.Zero) {
            if (IsWindowVisible(child)) { worker = child; break; }
            child = FindWindowEx(progman, child, "WorkerW", null);
        }

        if (worker == IntPtr.Zero) { Console.WriteLine("ERROR: WorkerW not found"); return; }

        SetParent(target, worker);
        SetWindowPos(target, (IntPtr)1, 0, 0, sw, sh, 0x0040 | 0x0002 | 0x0001 | 0x0010);
        Console.WriteLine("SUCCESS");
    }
}
`;
}

// ==================== 导出 ====================

module.exports = {
    injectToWallpaperLayer,
    restoreFromWallpaperLayer,
};
