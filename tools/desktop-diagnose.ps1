# desktop-diagnose.ps1 — 壁纸挂不上桌面层时，收集排查需要的信息
#
# 用法：问题出现时（壁纸盖住图标 / 点"显示桌面"后壁纸消失），双击同目录的 desktop-diagnose.bat。
# 会在桌面上生成 wallpaper-diagnose-<时间>.txt，内容：
#   - 系统版本、显示器和缩放、正在运行的其他壁纸软件
#   - 桌面窗口层级（Progman / WorkerW / 图标层）和本程序所有窗口的位置、样式、父窗口
#   - 模拟一次"显示桌面"（Win+D）后再记录一遍，然后再按一次 Win+D 还原
#   - 本程序日志 main.log 的最后 2000 行（里面有每次启动注入桌面层的详细过程）
# 只读取信息，不修改任何设置。-SkipShowDesktop 可以跳过 Win+D 那一步。

param([switch]$SkipShowDesktop)

$ErrorActionPreference = 'Continue'
$lines = New-Object System.Collections.Generic.List[string]
function Say([string]$s) { $lines.Add($s); Write-Host $s }

Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class WD {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
    public delegate bool EnumProc(IntPtr h, IntPtr l);

    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr p, IntPtr a, string c, string w);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint f);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint c);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern uint GetDpiForSystem();
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int v, int size);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("advapi32.dll")] static extern bool OpenProcessToken(IntPtr p, uint access, out IntPtr t);
    [DllImport("advapi32.dll")] static extern bool GetTokenInformation(IntPtr t, int cls, out int info, int len, out int ret);

    public static string Cls(IntPtr h) { StringBuilder s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
    public static uint Pid(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }
    public static IntPtr Progman() { return FindWindowEx(IntPtr.Zero, IntPtr.Zero, "Progman", null); }

    public static string Info(IntPtr h) {
        if (h == IntPtr.Zero) return "(none)";
        RECT r; GetWindowRect(h, out r);
        StringBuilder t = new StringBuilder(256); GetWindowText(h, t, 256);
        int cloaked = 0; DwmGetWindowAttribute(h, 14, out cloaked, 4);   // DWMWA_CLOAKED
        return "0x" + h.ToInt64().ToString("X") + " class=" + Cls(h) + " title='" + t + "' pid=" + Pid(h)
            + " visible=" + IsWindowVisible(h) + " minimized=" + IsIconic(h) + " cloaked=" + cloaked
            + " style=0x" + GetWindowLong(h, -16).ToString("X8") + " exstyle=0x" + GetWindowLong(h, -20).ToString("X8")
            + " parent=0x" + GetAncestor(h, 1).ToInt64().ToString("X") + " owner=0x" + GetWindow(h, 4).ToInt64().ToString("X")
            + " rect=" + r.L + "," + r.T + "," + r.R + "," + r.B;
    }

    // 子窗口按 Z 序从上到下列出
    public static void Tree(IntPtr h, int depth, int maxDepth, List<string> outLines) {
        if (h == IntPtr.Zero || depth > maxDepth) return;
        outLines.Add(new string(' ', depth * 2) + Info(h));
        IntPtr c = FindWindowEx(h, IntPtr.Zero, null, null);
        while (c != IntPtr.Zero) { Tree(c, depth + 1, maxDepth, outLines); c = FindWindowEx(h, c, null, null); }
    }

    // 顶层窗口，Z 序从上到下
    public static List<IntPtr> TopLevel() {
        List<IntPtr> l = new List<IntPtr>();
        EnumWindows(delegate(IntPtr h, IntPtr x) { l.Add(h); return true; }, IntPtr.Zero);
        return l;
    }

    // 进程是否以管理员身份运行：yes / no / ?（读不到，通常说明它是管理员而本脚本不是）
    public static string Elevated(uint pid) {
        IntPtr p = OpenProcess(0x1000, false, pid);   // PROCESS_QUERY_LIMITED_INFORMATION
        if (p == IntPtr.Zero) return "?";
        string r = "?";
        IntPtr t;
        if (OpenProcessToken(p, 0x0008, out t)) {     // TOKEN_QUERY
            int e, len;
            if (GetTokenInformation(t, 20, out e, 4, out len)) r = e != 0 ? "yes" : "no";   // TokenElevation
            CloseHandle(t);
        }
        CloseHandle(p);
        return r;
    }

    public static void PressWinD() {
        keybd_event(0x5B, 0, 0, UIntPtr.Zero);
        keybd_event(0x44, 0, 0, UIntPtr.Zero);
        keybd_event(0x44, 0, 2, UIntPtr.Zero);
        keybd_event(0x5B, 0, 2, UIntPtr.Zero);
    }
}
"@

[void][WD]::SetProcessDPIAware()
Add-Type -AssemblyName System.Windows.Forms

# 本程序的进程：exe 旁边有 resources\wallpapers 目录（安装目录可能被改过，不按路径名判断）
$appPids = @(Get-Process | Where-Object {
    $_.Path -and (Test-Path -LiteralPath (Join-Path (Split-Path $_.Path) 'resources\wallpapers'))
} | ForEach-Object { [uint32]$_.Id })

function Snapshot([string]$phase) {
    Say ''
    Say "==================== $phase ===================="
    # 前台窗口的标题可能是隐私内容（网页标题、聊天对象），不记录
    Say ('foreground: ' + ([WD]::Info([WD]::GetForegroundWindow()) -replace "title='[^']*'", 'title=(hidden)'))

    Say '--- Progman (desktop) tree ---'
    $tree = New-Object System.Collections.Generic.List[string]
    [WD]::Tree([WD]::Progman(), 0, 3, $tree)
    $tree | ForEach-Object { Say $_ }

    Say '--- top-level windows: Progman / visible WorkerW / this app (index = z-order, 1 = topmost) ---'
    $i = 0
    foreach ($h in [WD]::TopLevel()) {
        $i++
        $cls = [WD]::Cls($h)
        $pid_ = [WD]::Pid($h)
        $isApp = $appPids -contains $pid_
        if ($cls -eq 'Progman' -or $cls -eq 'WorkerW' -or $isApp) {
            $info = [WD]::Info($h)
            # 隐藏的 WorkerW 很多（别的 Chromium 程序的消息窗口），只列可见的
            if ($cls -eq 'WorkerW' -and $info -match 'visible=False') { continue }
            if ($isApp -and $info -match 'visible=False') { continue }
            Say ("#$i " + $info)
            if ($cls -eq 'WorkerW') {
                $sub = New-Object System.Collections.Generic.List[string]
                [WD]::Tree($h, 0, 2, $sub)
                $sub | Select-Object -Skip 1 | ForEach-Object { Say ('    ' + $_) }
            }
        }
    }
}

Say "wallpaper diagnose  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"

Say ''
Say '==================== system ===================='
$cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
Say ("Windows: {0} / {1} / build {2}.{3}" -f $cv.ProductName, $cv.DisplayVersion, $cv.CurrentBuild, $cv.UBR)
try { Say ("system DPI: " + [WD]::GetDpiForSystem() + " (96 = 100%)") } catch { Say 'system DPI: ?' }
foreach ($s in [System.Windows.Forms.Screen]::AllScreens) {
    Say ("monitor {0} primary={1} bounds={2} workArea={3}" -f $s.DeviceName, $s.Primary, $s.Bounds, $s.WorkingArea)
}

Say ''
Say '==================== processes ===================='
foreach ($id in $appPids) {
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($p) { Say ("app pid={0} elevated={1} started={2} path={3}" -f $id, [WD]::Elevated($id), $p.StartTime, $p.Path) }
}
if (-not $appPids.Count) { Say 'app: not running' }
Get-Process | Where-Object { $_.ProcessName -match 'wallpaper|lively|webwallpaper|deskscapes|rainmeter|translucenttb|startallback|explorerpatcher|windhawk' -and $appPids -notcontains [uint32]$_.Id } |
    ForEach-Object { Say ("other: {0} pid={1} path={2}" -f $_.ProcessName, $_.Id, $_.Path) }

Snapshot 'now'

if (-not $SkipShowDesktop) {
    Say ''
    Say '(pressing Win+D = show desktop)'
    [WD]::PressWinD()
    try {
        Start-Sleep -Milliseconds 2500
        Snapshot 'after show desktop'
    } finally {
        Start-Sleep -Milliseconds 300
        [WD]::PressWinD()
    }
}

Say ''
Say '==================== main.log (last 2000 lines) ===================='
$log = Join-Path $env:APPDATA 'interactive-desktop-wallpaper\logs\main.log'
if (Test-Path -LiteralPath $log) {
    Get-Content -LiteralPath $log -Encoding UTF8 -Tail 2000 | ForEach-Object { $lines.Add($_) }
    Write-Host '(main.log appended)'
} else {
    Say "not found: $log"
}

$outFile = Join-Path ([Environment]::GetFolderPath('Desktop')) ("wallpaper-diagnose-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + ".txt")
[System.IO.File]::WriteAllLines($outFile, $lines, (New-Object System.Text.UTF8Encoding $true))
Write-Host ''
Write-Host "完成，结果已保存到：$outFile"
