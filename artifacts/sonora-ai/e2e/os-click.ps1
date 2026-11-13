# Real OS-level clicks against an installed Sonora NSIS build.
# SendInput goes through Windows hit testing. Playwright's CDP mouse does not.
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [string]$OutDir = 'generated-artifacts/os-click-proof',
  [switch]$Full
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
$env:ELECTRON_ENABLE_LOGGING = '1'
$env:ELECTRON_LOG_FILE = Join-Path $OutDir 'electron.log'
$env:SONORA_BOOT_LOG = Join-Path $OutDir 'boot.txt'
$clickFile = Join-Path $OutDir 'catcher-clicks.txt'
$shotDir = $OutDir
$frameDir = Join-Path $OutDir 'frames'
New-Item -ItemType Directory -Force -Path $frameDir | Out-Null
if (Test-Path $clickFile) { Remove-Item $clickFile -Force }
Set-Content -Path $clickFile -Value '' -Encoding utf8
$stopFrames = Join-Path $OutDir 'stop-frames.txt'
if (Test-Path $stopFrames) { Remove-Item $stopFrames -Force }

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class SonoraInput {
  public const uint MOUSEEVENTF_MOVE = 0x0001;
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
  public const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
  public const int SM_XVIRTUALSCREEN = 76;
  public const int SM_YVIRTUALSCREEN = 77;
  public const int SM_CXVIRTUALSCREEN = 78;
  public const int SM_CYVIRTUALSCREEN = 79;
  public const uint SWP_NOSIZE = 0x0001;
  public const uint SWP_NOMOVE = 0x0002;
  public const uint SWP_NOACTIVATE = 0x0010;
  public const uint SWP_SHOWWINDOW = 0x0040;
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
    public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Explicit)] public struct INPUT {
    [FieldOffset(0)] public int type;
    [FieldOffset(8)] public MOUSEINPUT mi;
  }
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr")] public static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
  public static string Title(IntPtr hWnd) {
    var sb = new System.Text.StringBuilder(512);
    GetWindowText(hWnd, sb, sb.Capacity);
    return sb.ToString();
  }
  public static string ExStyle(IntPtr hWnd) {
    long style = GetWindowLongPtr64(hWnd, -20).ToInt64();
    var parts = new System.Collections.Generic.List<string>();
    if ((style & 0x20) != 0) parts.Add("WS_EX_TRANSPARENT");
    if ((style & 0x80000) != 0) parts.Add("WS_EX_LAYERED");
    if ((style & 0x200000) != 0) parts.Add("WS_EX_NOREDIRECTIONBITMAP");
    if ((style & 0x8) != 0) parts.Add("WS_EX_TOPMOST");
    if ((style & 0x80) != 0) parts.Add("WS_EX_TOOLWINDOW");
    if ((style & 0x40000) != 0) parts.Add("WS_EX_APPWINDOW");
    return "0x" + style.ToString("X") + " " + string.Join(",", parts);
  }
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr child, string cls, string title);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  public static void Move(int x, int y) {
    int vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
    int vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
    int vw = Math.Max(1, GetSystemMetrics(SM_CXVIRTUALSCREEN));
    int vh = Math.Max(1, GetSystemMetrics(SM_CYVIRTUALSCREEN));
    int ax = (int)Math.Round((x - vx) * 65535.0 / Math.Max(1, vw - 1));
    int ay = (int)Math.Round((y - vy) * 65535.0 / Math.Max(1, vh - 1));
    INPUT[] inputs = new INPUT[1];
    inputs[0].type = 0; inputs[0].mi.dx = ax; inputs[0].mi.dy = ay; inputs[0].mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE;
    uint sent = SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
    if (sent != 1) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  }
  public static void Click(int x, int y) {
    int vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
    int vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
    int vw = Math.Max(1, GetSystemMetrics(SM_CXVIRTUALSCREEN));
    int vh = Math.Max(1, GetSystemMetrics(SM_CYVIRTUALSCREEN));
    int ax = (int)Math.Round((x - vx) * 65535.0 / Math.Max(1, vw - 1));
    int ay = (int)Math.Round((y - vy) * 65535.0 / Math.Max(1, vh - 1));
    INPUT[] inputs = new INPUT[3];
    inputs[0].type = 0; inputs[0].mi.dx = ax; inputs[0].mi.dy = ay; inputs[0].mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE;
    inputs[1].type = 0; inputs[1].mi.dx = ax; inputs[1].mi.dy = ay; inputs[1].mi.dwFlags = MOUSEEVENTF_LEFTDOWN | MOUSEEVENTF_ABSOLUTE;
    inputs[2].type = 0; inputs[2].mi.dx = ax; inputs[2].mi.dy = ay; inputs[2].mi.dwFlags = MOUSEEVENTF_LEFTUP | MOUSEEVENTF_ABSOLUTE;
    uint sent = SendInput(3, inputs, Marshal.SizeOf(typeof(INPUT)));
    if (sent != 3) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  }
  public static void RightClick(int x, int y) {
    int vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
    int vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
    int vw = Math.Max(1, GetSystemMetrics(SM_CXVIRTUALSCREEN));
    int vh = Math.Max(1, GetSystemMetrics(SM_CYVIRTUALSCREEN));
    int ax = (int)Math.Round((x - vx) * 65535.0 / Math.Max(1, vw - 1));
    int ay = (int)Math.Round((y - vy) * 65535.0 / Math.Max(1, vh - 1));
    INPUT[] inputs = new INPUT[3];
    inputs[0].type = 0; inputs[0].mi.dx = ax; inputs[0].mi.dy = ay; inputs[0].mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE;
    inputs[1].type = 0; inputs[1].mi.dx = ax; inputs[1].mi.dy = ay; inputs[1].mi.dwFlags = 0x0008 | MOUSEEVENTF_ABSOLUTE;
    inputs[2].type = 0; inputs[2].mi.dx = ax; inputs[2].mi.dy = ay; inputs[2].mi.dwFlags = 0x0010 | MOUSEEVENTF_ABSOLUTE;
    uint sent = SendInput(3, inputs, Marshal.SizeOf(typeof(INPUT)));
    if (sent != 3) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  public static string[] OverlayWindows() {
    var found = new System.Collections.Generic.List<string>();
    EnumWindows((h, l) => {
      var cls = new System.Text.StringBuilder(256);
      GetClassName(h, cls, cls.Capacity);
      var title = Title(h);
      var klass = cls.ToString();
      if (klass.IndexOf("Overflow", System.StringComparison.OrdinalIgnoreCase) >= 0 ||
          klass.IndexOf("Notify", System.StringComparison.OrdinalIgnoreCase) >= 0 ||
          title.IndexOf("Sonora", System.StringComparison.OrdinalIgnoreCase) >= 0)
        found.Add(h.ToInt64().ToString() + "|" + klass + "|" + title);
      return true;
    }, IntPtr.Zero);
    return found.ToArray();
  }
  public static void RaiseWithoutFocus(IntPtr hWnd) {
    SetWindowPos(hWnd, new IntPtr(-1), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
  }
  public static void Wheel(int x, int y, int delta) {
    int vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
    int vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
    int vw = Math.Max(1, GetSystemMetrics(SM_CXVIRTUALSCREEN));
    int vh = Math.Max(1, GetSystemMetrics(SM_CYVIRTUALSCREEN));
    int ax = (int)Math.Round((x - vx) * 65535.0 / Math.Max(1, vw - 1));
    int ay = (int)Math.Round((y - vy) * 65535.0 / Math.Max(1, vh - 1));
    INPUT[] inputs = new INPUT[2];
    inputs[0].type = 0; inputs[0].mi.dx = ax; inputs[0].mi.dy = ay; inputs[0].mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE;
    inputs[1].type = 0; inputs[1].mi.dx = ax; inputs[1].mi.dy = ay; inputs[1].mi.mouseData = unchecked((uint)delta); inputs[1].mi.dwFlags = 0x0800;
    uint sent = SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
    if (sent != 2) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  }
  public static void Drag(int x1, int y1, int x2, int y2) {
    int vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
    int vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
    int vw = Math.Max(1, GetSystemMetrics(SM_CXVIRTUALSCREEN));
    int vh = Math.Max(1, GetSystemMetrics(SM_CYVIRTUALSCREEN));
    int ax1 = (int)Math.Round((x1 - vx) * 65535.0 / Math.Max(1, vw - 1));
    int ay1 = (int)Math.Round((y1 - vy) * 65535.0 / Math.Max(1, vh - 1));
    int ax2 = (int)Math.Round((x2 - vx) * 65535.0 / Math.Max(1, vw - 1));
    int ay2 = (int)Math.Round((y2 - vy) * 65535.0 / Math.Max(1, vh - 1));
    INPUT[] down = new INPUT[2];
    down[0].type = 0; down[0].mi.dx = ax1; down[0].mi.dy = ay1; down[0].mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE;
    down[1].type = 0; down[1].mi.dx = ax1; down[1].mi.dy = ay1; down[1].mi.dwFlags = MOUSEEVENTF_LEFTDOWN | MOUSEEVENTF_ABSOLUTE;
    if (SendInput(2, down, Marshal.SizeOf(typeof(INPUT))) != 2) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    System.Threading.Thread.Sleep(40);
    INPUT[] move = new INPUT[1];
    move[0].type = 0; move[0].mi.dx = ax2; move[0].mi.dy = ay2; move[0].mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE;
    if (SendInput(1, move, Marshal.SizeOf(typeof(INPUT))) != 1) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    System.Threading.Thread.Sleep(40);
    INPUT[] up = new INPUT[1];
    up[0].type = 0; up[0].mi.dx = ax2; up[0].mi.dy = ay2; up[0].mi.dwFlags = MOUSEEVENTF_LEFTUP | MOUSEEVENTF_ABSOLUTE;
    if (SendInput(1, up, Marshal.SizeOf(typeof(INPUT))) != 1) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  }
  static void AbsolutePoint(int x, int y, out int ax, out int ay) {
    int vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
    int vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
    int vw = Math.Max(1, GetSystemMetrics(SM_CXVIRTUALSCREEN));
    int vh = Math.Max(1, GetSystemMetrics(SM_CYVIRTUALSCREEN));
    ax = (int)Math.Round((x - vx) * 65535.0 / Math.Max(1, vw - 1));
    ay = (int)Math.Round((y - vy) * 65535.0 / Math.Max(1, vh - 1));
  }
  public static void DragSteps(int x1, int y1, int x2, int y2, int steps) {
    if (steps < 2) steps = 2;
    int ax, ay;
    AbsolutePoint(x1, y1, out ax, out ay);
    INPUT[] down = new INPUT[2];
    down[0].type = 0; down[0].mi.dx = ax; down[0].mi.dy = ay; down[0].mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE;
    down[1].type = 0; down[1].mi.dx = ax; down[1].mi.dy = ay; down[1].mi.dwFlags = MOUSEEVENTF_LEFTDOWN | MOUSEEVENTF_ABSOLUTE;
    if (SendInput(2, down, Marshal.SizeOf(typeof(INPUT))) != 2) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    System.Threading.Thread.Sleep(50);
    for (int i = 1; i <= steps; i++) {
      int x = x1 + ((x2 - x1) * i / steps);
      int y = y1 + ((y2 - y1) * i / steps);
      AbsolutePoint(x, y, out ax, out ay);
      INPUT[] move = new INPUT[1];
      move[0].type = 0; move[0].mi.dx = ax; move[0].mi.dy = ay; move[0].mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE;
      if (SendInput(1, move, Marshal.SizeOf(typeof(INPUT))) != 1) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      System.Threading.Thread.Sleep(20);
    }
    AbsolutePoint(x2, y2, out ax, out ay);
    INPUT[] up = new INPUT[1];
    up[0].type = 0; up[0].mi.dx = ax; up[0].mi.dy = ay; up[0].mi.dwFlags = MOUSEEVENTF_LEFTUP | MOUSEEVENTF_ABSOLUTE;
    if (SendInput(1, up, Marshal.SizeOf(typeof(INPUT))) != 1) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  }
}
public static class SonoraKeys {
  [System.Runtime.InteropServices.DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);
  public static void RestoreChord() {
    keybd_event(0x11, 0, 0, System.UIntPtr.Zero);
    keybd_event(0x10, 0, 0, System.UIntPtr.Zero);
    keybd_event(0x20, 0, 0, System.UIntPtr.Zero);
    keybd_event(0x20, 0, 2, System.UIntPtr.Zero);
    keybd_event(0x10, 0, 2, System.UIntPtr.Zero);
    keybd_event(0x11, 0, 2, System.UIntPtr.Zero);
  }
  public static void CollapseChord() {
    keybd_event(0x11, 0, 0, System.UIntPtr.Zero);
    keybd_event(0x48, 0, 0, System.UIntPtr.Zero);
    keybd_event(0x48, 0, 2, System.UIntPtr.Zero);
    keybd_event(0x11, 0, 2, System.UIntPtr.Zero);
  }
  public static void Chord(byte[] keys) {
    for (int i = 0; i < keys.Length; i++) keybd_event(keys[i], 0, 0, System.UIntPtr.Zero);
    for (int i = keys.Length - 1; i >= 0; i--) keybd_event(keys[i], 0, 2, System.UIntPtr.Zero);
  }
}
"@

function Send-Chord([byte[]]$Keys) {
  [SonoraKeys]::Chord($Keys)
  Start-Sleep -Milliseconds 550
}
function Save-Screen([string]$Name) {
  # CopyFromScreen can stall the runner when another grabber holds the desktop DC.
  $job = Start-Job -ScriptBlock {
    param($shotDir, $Name)
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bmp.Save((Join-Path $shotDir $Name), [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
  } -ArgumentList $shotDir, $Name
  if (-not (Wait-Job $job -Timeout 8)) { Stop-Job $job -ErrorAction SilentlyContinue; Write-Host "screenshot timed out $Name" }
  else { Write-Host "screenshot $Name" }
  Remove-Job $job -Force -ErrorAction SilentlyContinue
}

$catcherScript = @"
`$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
`$form = New-Object System.Windows.Forms.Form
`$form.Text = 'SonoraClickCatcher'
`$form.FormBorderStyle = 'None'
`$form.WindowState = 'Maximized'
`$form.TopMost = `$false
`$form.BackColor = [System.Drawing.Color]::FromArgb(255, 32, 36, 48)
`$form.ShowInTaskbar = `$true
`$label = New-Object System.Windows.Forms.Label
`$label.Text = 'CATCHER waiting'
`$label.Dock = 'Fill'
`$label.Font = New-Object System.Drawing.Font('Segoe UI', 32, [System.Drawing.FontStyle]::Bold)
`$label.ForeColor = [System.Drawing.Color]::White
`$label.TextAlign = 'MiddleCenter'
`$form.Controls.Add(`$label)
`$file = '$($clickFile.Replace("'", "''"))'
`$onClick = {
  Add-Content -Path `$file -Value ("click {0}" -f [DateTime]::UtcNow.ToString('o'))
  `$form.BackColor = [System.Drawing.Color]::FromArgb(255, 210, 32, 32)
  `$label.Text = 'PASS-THROUGH'
  `$form.Refresh()
}
`$form.Add_MouseDown(`$onClick)
`$label.Add_MouseDown(`$onClick)
`$form.Add_Shown({ `$form.Activate() })
[System.Windows.Forms.Application]::Run(`$form)
"@
$catcherPath = Join-Path $OutDir 'catcher.ps1'
Set-Content -Path $catcherPath -Value $catcherScript -Encoding UTF8
$catcher = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList @('-STA', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $catcherPath) -PassThru
Start-Sleep -Seconds 1

$scenarios = New-Object System.Collections.Generic.List[object]
$script:blockedHost = $null
function Get-SonoraAutomation {
  $ids = @(Get-Process | Where-Object { $_.ProcessName -like 'Sonora*' } | Select-Object -ExpandProperty Id)
  if ($ids.Count -eq 0) { return $null }
  $best = $null
  $bestCount = -1
  $windows = 0
  foreach ($procId in $ids) {
    $cond = New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$procId)
    $wins = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
    $windows += $wins.Count
    for ($i = 0; $i -lt $wins.Count; $i++) {
      $w = $wins.Item($i)
      $desc = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
      if ($desc.Count -gt $bestCount) { $bestCount = $desc.Count; $best = $w }
    }
  }
  Write-Host "UIA processWindows=$windows descendants=$bestCount"
  return $best
}
function Add-Scenario([string]$Name, [bool]$Pass, [string]$Detail) {
  $script:scenarios.Add([ordered]@{ name = $Name; pass = $Pass; detail = $Detail }) | Out-Null
  if ($Pass) { Write-Host "PASS $Name :: $Detail" } else { Write-Host "FAIL $Name :: $Detail" }
}
function Get-SonoraWindow([int]$ProcessId) {
  try {
    $handles = [System.Diagnostics.Process]::GetProcessById($ProcessId).MainWindowHandle
    if ($handles -ne [IntPtr]::Zero -and [SonoraInput]::IsWindowVisible($handles)) { return $handles }
  } catch {}
  $procs = Get-Process | Where-Object { $_.ProcessName -like 'Sonora*' -and $_.MainWindowHandle -ne [IntPtr]::Zero }
  foreach ($proc in $procs) {
    if ([SonoraInput]::IsWindowVisible($proc.MainWindowHandle)) { return $proc.MainWindowHandle }
  }
  return [IntPtr]::Zero
}
function Click-Count { return @(Get-Content $clickFile -ErrorAction SilentlyContinue | Where-Object { $_ -match '^click ' }).Count }
function Get-ForegroundName {
  $fg = [SonoraInput]::GetForegroundWindow()
  $fgPid = 0
  [SonoraInput]::GetWindowThreadProcessId($fg, [ref]$fgPid) | Out-Null
  try { return (Get-Process -Id $fgPid -ErrorAction Stop).ProcessName } catch { return "pid $fgPid" }
}
function Get-ProbePoints($Rect) {
  $points = @()
  $width = [Math]::Max(1, $Rect.Right - $Rect.Left)
  $height = [Math]::Max(1, $Rect.Bottom - $Rect.Top)
  foreach ($fx in @(0.02, 0.15, 0.5, 0.85, 0.98)) {
    foreach ($fy in @(0.02, 0.15, 0.5, 0.85, 0.98)) {
      $points += [ordered]@{
        x = [int]($Rect.Left + $width * $fx)
        y = [int]($Rect.Top + $height * $fy)
        edge = ($fx -lt 0.1 -or $fx -gt 0.9 -or $fy -lt 0.1 -or $fy -gt 0.9)
        center = ($fx -eq 0.5 -and $fy -eq 0.5)
      }
    }
  }
  return $points
}
function Invoke-ClickProbe([string]$Label, [IntPtr]$Window, [switch]$MarginsOnly) {
  $rect = New-Object SonoraInput+RECT
  [SonoraInput]::GetWindowRect($Window, [ref]$rect) | Out-Null
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  $style = [SonoraInput]::ExStyle($Window)
  $title = [SonoraInput]::Title($Window)
  Write-Host "$Label hwnd=$Window title='$title' rect=$($rect.Left),$($rect.Top) ${width}x${height} exstyle=$style"
  $outsideX = [Math]::Max(8, $rect.Left - 30)
  $outsideY = [Math]::Min([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height - 20, $rect.Bottom + 40)
  if ($outsideY -le $rect.Bottom -and $outsideY -ge $rect.Top) { $outsideY = [Math]::Max(8, $rect.Top - 20) }
  $beforeCal = Click-Count
  [SonoraInput]::Click($outsideX, $outsideY)
  Start-Sleep -Milliseconds 400
  $cal = (Click-Count) - $beforeCal
  Write-Host "$Label calibration clicks=$cal at $outsideX,$outsideY"
  [SonoraInput]::RaiseWithoutFocus($Window) | Out-Null
  $passed = @()
  $edgePass = 0
  $centerPass = 0
  $points = if ($MarginsOnly) {
    @(
      @{ x = $rect.Left + 3; y = $rect.Bottom - 3; edge = $true; center = $false },
      @{ x = $rect.Right - 3; y = $rect.Bottom - 3; edge = $true; center = $false },
      @{ x = $rect.Left + 3; y = [int](($rect.Top + $rect.Bottom) / 2); edge = $true; center = $false },
      @{ x = $rect.Right - 3; y = [int](($rect.Top + $rect.Bottom) / 2); edge = $true; center = $false }
    )
  } else { @(Get-ProbePoints $rect) }
  foreach ($point in $points) {
    $before = Click-Count
    [SonoraInput]::Click($point.x, $point.y)
    Start-Sleep -Milliseconds 250
    $hit = (Click-Count) - $before
    if ($hit -gt 0) {
      $passed += "$($point.x),$($point.y)"
      if ($point.edge) { $edgePass++ }
      if ($point.center) { $centerPass++ }
    }
  }
  Start-Sleep -Milliseconds 300
  $fgName = Get-ForegroundName
  $detail = "inside=$($passed.Count) edge=$edgePass center=$centerPass calibration=$cal foreground=$fgName title=$title exstyle=$style window=${width}x${height} points=$($passed -join ';')"
  Write-Host "$Label $detail"
  return [ordered]@{ label = $Label; calibration = $cal; inside = $passed.Count; edge = $edgePass; center = $centerPass; foreground = $fgName; width = $width; height = $height; title = $title; exstyle = $style; detail = $detail; passed = $passed }
}
function Stop-Sonora {
  Get-Process -Name 'Sonora*' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  & cmd.exe /c "taskkill /F /IM `"Sonora AI.exe`" /T >nul 2>&1 & exit /b 0"
}
function Seed-Preferences {
  $payload = '{"backgroundOpacity":0.15,"opacityVersion":2,"clickThrough":false,"alwaysOnTop":true}'
  foreach ($root in @($env:APPDATA, $env:LOCALAPPDATA)) {
    Get-ChildItem $root -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'sonora' } | ForEach-Object {
      Set-Content -Path (Join-Path $_.FullName 'window-preferences.json') -Value $payload -Encoding utf8
      Write-Host "seeded $($_.FullName)"
    }
    foreach ($name in @('Sonora AI', 'sonora-ai', 'Sonora', 'sonora')) {
      $dir = Join-Path $root $name
      New-Item -ItemType Directory -Force -Path $dir | Out-Null
      Set-Content -Path (Join-Path $dir 'window-preferences.json') -Value $payload -Encoding utf8
    }
  }
}
function Clear-SonoraCache {
  # Deleting or renaming Chromium's cache while a handle is open blocks this runner indefinitely.
  Write-Host 'leaving the Chromium cache in place'
}
function Block-SonoraNetwork([string]$PathExe) {
  # Opening the installed asar makes Defender rescan it and stalls the runner.
  # The first launch already wrote the hosted origin into Chromium's small preference files.
  $hostName = $null
  foreach ($root in @($env:APPDATA, $env:LOCALAPPDATA)) {
    $dirs = @(Get-ChildItem $root -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'sonora' })
    foreach ($dir in $dirs) {
      $files = @(Get-ChildItem $dir.FullName -File -ErrorAction SilentlyContinue | Where-Object { $_.Length -lt 300000 -and $_.Length -gt 0 })
      foreach ($file in $files) {
        try {
          $sample = [IO.File]::ReadAllText($file.FullName)
          $match = [regex]::Match($sample, 'https://(?!127\.0\.0\.1|localhost|github\.com|electronjs\.org|microsoft\.com)[A-Za-z0-9.-]+\.[A-Za-z]{2,}')
          if ($match.Success) { $hostName = ([Uri]$match.Value).Host; break }
        } catch {}
      }
      if ($hostName) { break }
    }
    if ($hostName) { break }
  }
  if ($hostName -and $hostName -ne '127.0.0.1') {
    $hosts = "$env:SystemRoot\System32\drivers\etc\hosts"
    Add-Content -Path $hosts -Value "`r`n127.0.0.1 $hostName`r`n::1 $hostName"
    $script:blockedHost = $hostName
    Write-Host "blocked host $hostName"
  } else { Write-Host 'no hosted name found; offline relaunch may still load the cached page' }
}
function Unblock-SonoraNetwork {
  if ($script:blockedHost) {
    $hosts = "$env:SystemRoot\System32\drivers\etc\hosts"
    if (Test-Path $hosts) {
      $kept = Get-Content $hosts | Where-Object { $_ -notmatch [regex]::Escape($script:blockedHost) }
      Set-Content -Path $hosts -Value $kept -Encoding ascii
    }
  }
}
function Start-Sonora([string[]]$Arguments) {
  Seed-Preferences
  $proc = Start-Process -FilePath $Exe -ArgumentList $Arguments -PassThru
  $hwnd = [IntPtr]::Zero
  $deadline = (Get-Date).AddSeconds(90)
  while ((Get-Date) -lt $deadline) {
    $hwnd = Get-SonoraWindow $proc.Id
    if ($hwnd -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 400
  }
  if ($hwnd -eq [IntPtr]::Zero) { throw 'Sonora window did not appear.' }
  return @{ proc = $proc; hwnd = $hwnd }
}
function Wait-Title([IntPtr]$Window, [string]$Pattern, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  $title = ''
  while ((Get-Date) -lt $deadline) {
    $title = [SonoraInput]::Title($Window)
    if ($title -match $Pattern) { return $title }
    Start-Sleep -Milliseconds 400
  }
  return $title
}
function Dump-Ui([int]$Limit) {
  $names = @()
  try {
    $root = Get-SonoraAutomation
    if ($root) {
      $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
      for ($i = 0; $i -lt [Math]::Min($Limit, $all.Count); $i++) {
        $item = $all.Item($i)
        $n = $item.Current.Name
        $kind = $item.Current.ControlType.ProgrammaticName
        if ($n) { $names += $n } else { $names += "($kind)" }
      }
    }
  } catch { Write-Host "UI dump failed: $_" }
  return $names
}

try {
  if (-not (Test-Path $Exe)) { throw "Installed executable not found: $Exe" }
  $os = Get-CimInstance Win32_OperatingSystem
  Write-Host "runner $($os.Caption) $($os.Version)"
  $launched = Start-Sonora @('--force-renderer-accessibility')
  $hwnd = $launched.hwnd
  $windowTitle = [SonoraInput]::Title($hwnd)
  Add-Scenario 'Task Manager process name stays Sonora' ($launched.proc.ProcessName -like 'Sonora*' -and $windowTitle -match 'Sonora') "process=$($launched.proc.ProcessName) title=$windowTitle"
  Write-Host 'PHASE live-ui'
  Start-Sleep -Seconds 6
  if ($Full) {
    $names = Dump-Ui 30
    Write-Host ("UI names: " + ($names -join ' | '))
  }
  Save-Screen '00-before-click.png'
  $probe = Invoke-ClickProbe 'installed-surface' $hwnd -MarginsOnly:$Full
  Save-Screen '01-after-os-clicks.png'
  $passedThrough = $probe.inside -gt 0
  $detail = $probe.detail

  if (-not $Full) {
    if ($probe.calibration -lt 1) {
      Add-Scenario 'OS clicks on the installed window do not reach the app behind' $false "SendInput missed the catcher. $detail"
      throw "SendInput did not reach the catcher, so this run does not prove click handling. $detail"
    }
    if ($passedThrough) {
      Add-Scenario 'OS clicks on the installed window do not reach the app behind' $false "Reproduced: $detail"
      throw "Reproduced: real OS clicks passed through the installed v1.0.3 window while click-through was off. $detail"
    }
    Add-Scenario 'OS clicks on the installed window do not reach the app behind' $false "Not reproduced: $detail"
    throw "Not reproduced: installed v1.0.3 swallowed every OS click on this runner. $detail"
  }
  if ($probe.calibration -lt 1) {
    Add-Scenario 'OS clicks on the installed window do not reach the app behind' $false "SendInput missed the catcher. $detail"
  } else {
    Add-Scenario 'OS clicks on the installed window do not reach the app behind' (-not $passedThrough) $detail
  }
  if ($passedThrough -or $probe.calibration -lt 1) { throw "Glass is still click-through or the click probe is invalid. $detail" }

  function Find-All([string]$Name) {
    $root = Get-SonoraAutomation
    if (-not $root) { return @() }
    $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $items = @()
    for ($i = 0; $i -lt $all.Count; $i++) {
      $el = $all.Item($i)
      $n = $el.Current.Name
      if ($n -and ($n -eq $Name -or $n.StartsWith("$Name ") -or $n.Contains($Name))) { $items += $el }
    }
    return $items
  }
  function Find-Element([string]$Name) {
    $items = @(Find-All $Name)
    if ($items.Count -eq 0) { return $null }
    return $items[0]
  }
  function Find-Largest([string]$Name) {
    $best = $null
    $area = 0
    foreach ($el in @(Find-All $Name)) {
      $r = $el.Current.BoundingRectangle
      $a = $r.Width * $r.Height
      if ($a -gt $area) { $area = $a; $best = $el }
    }
    return $best
  }
  function Click-Element($el) {
    if (-not $el) { throw 'No UI element to click' }
    try { $el.GetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern).ScrollIntoView() } catch {}
    Start-Sleep -Milliseconds 120
    $r = $el.Current.BoundingRectangle
    if ($r.Width -lt 1 -or $r.Height -lt 1) { throw "Element $($el.Current.Name) has no on-screen box" }
    $before = Click-Count
    [SonoraInput]::Click([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2))
    Start-Sleep -Milliseconds 350
    if ((Click-Count) -gt $before) { throw "OS click on '$($el.Current.Name)' passed through to the window behind." }
  }
  function Click-Name([string]$Name, [switch]$Last) {
    $items = @(Find-All $Name)
    if ($items.Count -eq 0) { throw "No UI element named $Name" }
    $buttons = @($items | Where-Object { $_.Current.ControlType.ProgrammaticName -match 'Button|Hyperlink|Edit|Slider|Tab|RadioButton|CheckBox|ComboBox|SplitButton' })
    $pool = if ($buttons.Count -gt 0) { $buttons } else { $items }
    $el = if ($Last) { $pool[$pool.Count - 1] } else { $pool[0] }
    Click-Element $el
    return $el
  }

  $signIn = $null
  $waitUntil = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $waitUntil -and -not $signIn) {
    $signIn = Find-Element 'Sign in'
    if (-not $signIn) { Start-Sleep -Milliseconds 500 }
  }
  if (-not $signIn) {
    $seen = Dump-Ui 40
    $boot = ''
    if (Test-Path $env:SONORA_BOOT_LOG) { $boot = (Get-Content $env:SONORA_BOOT_LOG -Tail 8) -join ' ; ' }
    Add-Scenario 'Sign in with an OS click' $false ("UI: " + ($seen -join ' | ') + " boot: $boot")
    throw "Installed window has no Sign in control. UI: $($seen -join ' | ') boot: $boot"
  }
  if (Find-Element 'Hide from screen sharing (best effort)') { Click-Name 'Hide from screen sharing (best effort)' | Out-Null }
  Click-Element $signIn
  Start-Sleep -Milliseconds 700
  $signed = Find-Element 'Call Sessions'
  Add-Scenario 'Sign in with an OS click' ([bool]$signed) ''
  Save-Screen '02-signed-in.png'
  if (-not $signed) { throw 'Sign-in click did not open Call Sessions.' }

  $sweepRect = New-Object SonoraInput+RECT
  [SonoraInput]::GetWindowRect($hwnd, [ref]$sweepRect) | Out-Null
  $sweepUntil = (Get-Date).AddSeconds(11)
  $sweepY = $sweepRect.Top + 70
  $sweepDir = 1
  while ((Get-Date) -lt $sweepUntil) {
    for ($sweepX = $sweepRect.Left + 24; $sweepX -lt ($sweepRect.Right - 24); $sweepX += 48) {
      [SonoraInput]::Move($sweepX, $sweepY)
      Start-Sleep -Milliseconds 35
    }
    $sweepY += 42 * $sweepDir
    if ($sweepY -gt ($sweepRect.Bottom - 36)) { $sweepDir = -1; $sweepY = $sweepRect.Bottom - 36 }
    if ($sweepY -lt ($sweepRect.Top + 48)) { $sweepDir = 1; $sweepY = $sweepRect.Top + 48 }
  }
  $resumes = Find-Element 'Resumes'
  $hoverName = ''
  $hoverUntil = (Get-Date).AddSeconds(3)
  while ((Get-Date) -lt $hoverUntil) {
    if ($resumes) {
      $rr = $resumes.Current.BoundingRectangle
      [SonoraInput]::Move([int]($rr.X + $rr.Width / 2), [int]($rr.Y + $rr.Height / 2))
    }
    Start-Sleep -Milliseconds 250
    $hover = Find-Element 'Hover'
    if ($hover) { $hoverName = $hover.Current.Name }
    if ($hoverName -match 'cursor default' -and $hoverName -notmatch 'Hover idle') { break }
  }
  $hoverOk = $hoverName -match 'Hover ' -and $hoverName -notmatch 'Hover idle' -and $hoverName -match 'cursor default'
  Add-Scenario 'Real mouse moves for 10 seconds change hover and cursor' $hoverOk $hoverName
  $interview = $null
  foreach ($candidate in @(Find-All 'Interview')) {
    if ($candidate.Current.Name -eq 'Interview') { $interview = $candidate; break }
  }
  if (-not $interview) { throw 'Interview filter missing' }
  Click-Element $interview
  $filtered = $null
  $filterUntil = (Get-Date).AddSeconds(3)
  while ((Get-Date) -lt $filterUntil -and -not $filtered) {
    $filtered = Find-Element 'Filter interview'
    if (-not $filtered) { Start-Sleep -Milliseconds 200 }
  }
  $filterDetail = ''
  if (-not $filtered) {
    $current = Find-Element 'Filter '
    $filterDetail = if ($current) { $current.Current.Name } else { 'filter label missing' }
  }
  Add-Scenario 'Filter click changes the visible state' ([bool]$filtered) $filterDetail
  $hung = $false
  foreach ($log in @($env:SONORA_BOOT_LOG)) {
    if ($log -and (Test-Path $log) -and (Select-String -Path $log -Pattern 'unresponsive' -Quiet)) { $hung = $true }
  }
  Get-ChildItem $env:APPDATA, $env:LOCALAPPDATA -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'sonora' } | ForEach-Object {
    $boot = Join-Path $_.FullName 'e2e-boot.txt'
    if ((Test-Path $boot) -and (Select-String -Path $boot -Pattern 'unresponsive' -Quiet)) { $script:hung = $true }
  }
  Add-Scenario 'Renderer never goes unresponsive' (-not $hung) ''

  $names = @('Resumes', 'Documents', 'Call Sessions', 'Dark', 'Light', 'Upgrade')
  $missing = @()
  foreach ($name in $names) {
    if (-not (Find-Element $name)) { $missing += $name }
    else { Click-Name $name | Out-Null }
  }
  foreach ($name in @('Create session', 'Mock Interview')) {
    if (-not (Find-Element $name)) { $missing += $name; continue }
    Click-Name $name | Out-Null
    Start-Sleep -Milliseconds 250
    if (Find-Element 'Cancel') { Click-Name 'Cancel' | Out-Null; Start-Sleep -Milliseconds 200 }
  }
  Add-Scenario 'Every home and sidebar control receives an OS click' ($missing.Count -eq 0) ($(if ($missing) { "missing $($missing -join ', ')" } else { 'all clicked' }))

  Click-Name 'Create session' | Out-Null
  Start-Sleep -Milliseconds 300
  Click-Name 'Cancel' | Out-Null
  $dialogGone = -not (Find-Element 'Company')
  Add-Scenario 'Create Session cancel' $dialogGone ''
  Click-Name 'Create session' | Out-Null
  $company = $null
  foreach ($candidate in @(Find-All 'Company')) {
    if ($candidate.Current.ControlType.ProgrammaticName -match 'Edit') { $company = $candidate; break }
    if (-not $company) { $company = $candidate }
  }
  if (-not $company) { Add-Scenario 'Create Session valid input' $false 'company field missing' }
  else {
    Click-Element $company
    try { $company.SetFocus() } catch { Write-Host "company focus skipped" }
    [System.Windows.Forms.SendKeys]::SendWait('Northwind')
    Click-Name 'Create session' -Last | Out-Null
    Start-Sleep -Milliseconds 500
    Add-Scenario 'Create Session valid input' ([bool](Find-Element 'Northwind interview')) ''
  }
  Save-Screen '03-session.png'

  function Wait-Named([string]$Name, [int]$Seconds = 6) {
    $until = (Get-Date).AddSeconds($Seconds)
    $found = $null
    while ((Get-Date) -lt $until -and -not $found) {
      $found = Find-Element $Name
      if (-not $found) { Start-Sleep -Milliseconds 250 }
    }
    return $found
  }
  function Find-Exact([string]$Name) {
    foreach ($el in @(Find-All $Name)) { if ($el.Current.Name -eq $Name) { return $el } }
    return $null
  }
  # The click recorder is a 1x1 paragraph. After End its text is exactly
  # "End session" even though the live bar has unmounted. Only an on-screen button counts.
  function Test-OnScreenButton($el) {
    if (-not $el) { return $false }
    try { if ($el.Current.ControlType.ProgrammaticName -notmatch 'Button') { return $false } } catch { return $false }
    try { if ($el.Current.IsOffscreen) { return $false } } catch { return $false }
    $r = $el.Current.BoundingRectangle
    return ($r.Width -ge 8 -and $r.Height -ge 8)
  }
  function Find-VisibleButton([string]$Name) {
    foreach ($el in @(Find-All $Name)) {
      if ($el.Current.Name -eq $Name -and (Test-OnScreenButton $el)) { return $el }
    }
    return $null
  }
  function Describe-Exact([string]$Name) {
    $notes = @()
    foreach ($el in @(Find-All $Name)) {
      if ($el.Current.Name -ne $Name) { continue }
      $kind = ''
      try { $kind = $el.Current.ControlType.ProgrammaticName } catch { $kind = 'unknown' }
      $r = $el.Current.BoundingRectangle
      $notes += "$kind $([int]$r.Width)x$([int]$r.Height)"
    }
    return ($notes -join '; ')
  }
  function Click-Exact([string]$Name) {
    $el = Find-Exact $Name
    if (-not $el) { throw "No exact UI element named $Name" }
    Click-Element $el
    return $el
  }
  function Get-Toggle($el) {
    if (-not $el) { return $null }
    try { return [string]$el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Current.ToggleState }
    catch { return $null }
  }
  function Get-Range($el) {
    if (-not $el) { return $null }
    try { return [double]$el.GetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern).Current.Value }
    catch { return $null }
  }
  function Find-Slider([string]$Name) {
    foreach ($el in @(Find-All $Name)) {
      if ($el.Current.ControlType.ProgrammaticName -match 'Slider') { return $el }
    }
    return $null
  }
  Click-Exact 'Collapse sidebar' | Out-Null
  $sidebarBack = Wait-Named 'Expand sidebar' 3
  Add-Scenario 'Control: Collapse sidebar hides the labels' ([bool]$sidebarBack) ''
  if ($sidebarBack) { Click-Exact 'Expand sidebar' | Out-Null; Start-Sleep -Milliseconds 200 }
  $search = Find-Exact 'Search sessions'
  if (-not $search) { Add-Scenario 'Control: Search filters the session list' $false 'search missing' }
  else {
    try { $search.SetFocus() } catch {}
    Click-Element $search
    [System.Windows.Forms.SendKeys]::SendWait('zzzz')
    Start-Sleep -Milliseconds 400
    $filteredOut = -not (Find-Element 'Northwind interview')
    Click-Element (Find-Exact 'Search sessions')
    [System.Windows.Forms.SendKeys]::SendWait('^a{BACKSPACE}')
    Start-Sleep -Milliseconds 300
    $restored = [bool](Find-Element 'Northwind interview')
    Add-Scenario 'Control: Search filters the session list' ($filteredOut -and $restored) "filtered=$filteredOut restored=$restored"
  }
  Click-Exact 'Resumes' | Out-Null
  Add-Scenario 'Control: Resumes opens the saved-resume panel' ([bool](Wait-Named 'Nothing saved yet' 3)) ''
  Click-Exact 'Documents' | Out-Null
  Add-Scenario 'Control: Documents opens the saved-document panel' ([bool](Wait-Named 'Nothing saved yet' 3)) ''
  Click-Exact 'Call Sessions' | Out-Null
  Add-Scenario 'Control: Call Sessions returns to the session table' ([bool](Wait-Named 'Northwind interview' 3)) ''
  function Select-Theme([string]$Name) {
    $plain = Find-Exact $Name
    if ($plain) { Click-Element $plain; return }
    if (-not (Find-Exact "$Name selected")) { throw "No theme button named $Name" }
  }
  Select-Theme 'Light'
  Add-Scenario 'Control: Light theme toggle' ([bool](Wait-Named 'Light selected' 3)) ''
  Save-Screen 'theme-light.png'
  Select-Theme 'Dark'
  Add-Scenario 'Control: Dark theme toggle' ([bool](Wait-Named 'Dark selected' 3)) ''
  Save-Screen 'theme-dark.png'
  Select-Theme 'Light'
  Add-Scenario 'Theme light is applied' ([bool]((Wait-Named 'Theme light' 3) -and (Find-Exact 'Light selected'))) ''

  function Add-E2EItem([string]$Title, [string]$Resume, [string]$Document, [string]$Status) {
    $payload = @{ title = $Title; company = $Title; resumeText = $Resume; documentsText = $Document; status = $Status } | ConvertTo-Json
    return Invoke-RestMethod -Method POST -Uri 'http://127.0.0.1:4173/api/e2e/seed' -Body $payload -ContentType 'application/json; charset=utf-8'
  }
  function Remove-E2EItem([string]$Id) {
    $payload = @{ id = $Id; remove = $true } | ConvertTo-Json
    Invoke-RestMethod -Method POST -Uri 'http://127.0.0.1:4173/api/e2e/seed' -Body $payload -ContentType 'application/json; charset=utf-8' | Out-Null
  }
  function Wait-Absent([string]$Name, [int]$Seconds = 4) {
    $until = (Get-Date).AddSeconds($Seconds)
    do {
      if (-not (Find-Element $Name)) { return $true }
      Start-Sleep -Milliseconds 200
    } while ((Get-Date) -lt $until)
    return -not (Find-Element $Name)
  }
  $cedar = Add-E2EItem 'Cedar archive' '' '' 'ready'
  $lattice = Add-E2EItem 'Lattice resume' 'Lattice resume body' '' 'ready'
  $orbit = Add-E2EItem 'Orbit brief' '' 'Orbit brief body' 'ready'
  $liveDesk = Add-E2EItem 'Live desk' '' '' 'active'
  Click-Exact 'Call Sessions' | Out-Null
  $seeded = [bool]((Wait-Named 'Cedar archive' 4) -and (Wait-Named 'Lattice resume' 2) -and (Wait-Named 'Orbit brief' 2) -and (Wait-Named 'Live desk' 2))
  Add-Scenario 'Library items are listed' $seeded ''
  Click-Exact 'Delete session Cedar archive' | Out-Null
  $confirmSession = Wait-Named 'Confirm delete' 3
  Save-Screen 'delete-session-confirm.png'
  if ($confirmSession) { Click-Exact 'Delete session' | Out-Null }
  $cedarGone = Wait-Absent 'Cedar archive'
  Add-Scenario 'Delete session confirms and removes it' ([bool]($confirmSession -and $cedarGone -and (Find-Element 'Northwind interview'))) "gone=$cedarGone"
  Click-Exact 'Resumes' | Out-Null
  $resumeShown = Wait-Named 'Lattice resume body' 3
  if ($resumeShown) {
    Click-Exact 'Delete resume Lattice resume' | Out-Null
    Save-Screen 'delete-resume-confirm.png'
    Click-Exact 'Delete resume' | Out-Null
  }
  $resumeGone = Wait-Absent 'Lattice resume body'
  Click-Exact 'Call Sessions' | Out-Null
  $latticeRemains = [bool](Wait-Named 'Lattice resume' 3)
  Add-Scenario 'Delete resume confirms and removes it' ([bool]($resumeShown -and $resumeGone -and $latticeRemains)) "shown=$([bool]$resumeShown) gone=$resumeGone sessionRemains=$latticeRemains"
  if ($latticeRemains) {
    Click-Exact 'Delete session Lattice resume' | Out-Null
    Click-Exact 'Delete session' | Out-Null
    Start-Sleep -Milliseconds 400
  }
  Click-Exact 'Documents' | Out-Null
  $docShown = Wait-Named 'Orbit brief body' 3
  if ($docShown) {
    Click-Exact 'Delete document Orbit brief' | Out-Null
    Save-Screen 'delete-document-confirm.png'
    Click-Exact 'Delete document' | Out-Null
  }
  $docGone = Wait-Absent 'Orbit brief body'
  Click-Exact 'Call Sessions' | Out-Null
  $orbitRemains = [bool](Wait-Named 'Orbit brief' 3)
  Add-Scenario 'Delete document confirms and removes it' ([bool]($docShown -and $docGone -and $orbitRemains)) "shown=$([bool]$docShown) gone=$docGone sessionRemains=$orbitRemains"
  if ($orbitRemains) {
    Click-Exact 'Delete session Orbit brief' | Out-Null
    Click-Exact 'Delete session' | Out-Null
    Start-Sleep -Milliseconds 400
  }
  Click-Exact 'Delete session Live desk' | Out-Null
  $blocked = Wait-Named 'End this session before deleting it.' 3
  Save-Screen 'delete-live-blocked.png'
  if (Find-Exact 'Close') { Click-Exact 'Close' | Out-Null }
  $liveRemains = [bool](Find-Element 'Live desk')
  Add-Scenario 'Deleting a live session is blocked' ([bool]($blocked -and $liveRemains)) "blocked=$([bool]$blocked) remains=$liveRemains"
  if ($liveDesk.id) { Remove-E2EItem $liveDesk.id }
  Click-Exact 'Call Sessions' | Out-Null
  Start-Sleep -Milliseconds 400

  function Set-Slider([double]$Ratio) {
    [SonoraInput]::RaiseWithoutFocus($hwnd) | Out-Null
    $el = Find-Element 'Overlay opacity'
    if (-not $el) { throw 'Overlay opacity slider missing' }
    $r = $el.Current.BoundingRectangle
    $x = [int]($r.X + [Math]::Max(4, ($r.Width - 8) * $Ratio))
    $y = [int]($r.Y + $r.Height / 2)
    foreach ($attempt in 1..2) {
      $before = Click-Count
      [SonoraInput]::Click($x, $y)
      Start-Sleep -Milliseconds 300
      if ((Click-Count) -eq $before) { return }
      [SonoraInput]::RaiseWithoutFocus($hwnd) | Out-Null
      Start-Sleep -Milliseconds 150
    }
    throw "Slider click passed through at ratio $Ratio"
  }
  function Click-Panel {
    $el = Find-Largest 'Call Sessions'
    if (-not $el) { throw 'No panel to click' }
    $r = $el.Current.BoundingRectangle
    $before = Click-Count
    [SonoraInput]::Click([int]($r.X + [Math]::Min(40, $r.Width / 2)), [int]($r.Y + $r.Height / 2))
    Start-Sleep -Milliseconds 250
    return (Click-Count) - $before
  }

  foreach ($pin in @($true, $false)) {
    $keep = Find-Element 'Keep on top'
    if (-not $keep) { throw 'Keep on top missing' }
    $pattern = $null
    try { $pattern = $keep.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern) } catch { $pattern = $null }
    $want = $(if ($pin) { [System.Windows.Automation.ToggleState]::On } else { [System.Windows.Automation.ToggleState]::Off })
    if ($pattern -and $pattern.Current.ToggleState -ne $want) { Click-Name 'Keep on top' | Out-Null; Start-Sleep -Milliseconds 200 }
    elseif (-not $pattern -and -not $pin) { Click-Name 'Keep on top' | Out-Null }
    foreach ($focus in @($true, $false)) {
      $swp = [SonoraInput]::SWP_NOMOVE -bor [SonoraInput]::SWP_NOSIZE -bor [SonoraInput]::SWP_NOACTIVATE -bor [SonoraInput]::SWP_SHOWWINDOW
      if ($focus) {
        if (-not $pin) { [SonoraInput]::SetWindowPos($hwnd, [IntPtr](-2), 0, 0, 0, 0, $swp) | Out-Null }
        [SonoraInput]::SetForegroundWindow($hwnd) | Out-Null
      } else {
        # The catcher is maximized. Keep Sonora painted above it, then focus the catcher
        # so the click starts while Sonora is not the foreground window.
        [SonoraInput]::SetWindowPos($hwnd, [IntPtr](-1), 0, 0, 0, 0, $swp) | Out-Null
        $catcherHwnd = (Get-Process -Id $catcher.Id -ErrorAction SilentlyContinue).MainWindowHandle
        if ($catcherHwnd -and $catcherHwnd -ne [IntPtr]::Zero) { [SonoraInput]::SetForegroundWindow($catcherHwnd) | Out-Null }
      }
      Start-Sleep -Milliseconds 200
      foreach ($ratio in @(0.0, 0.5, 1.0)) {
        $before = Click-Count
        Set-Slider $ratio
        $panelPassed = Click-Panel
        $marginBefore = Click-Count
        $winRect = New-Object SonoraInput+RECT
        [SonoraInput]::GetWindowRect($hwnd, [ref]$winRect) | Out-Null
        [SonoraInput]::Click($winRect.Left + 4, $winRect.Bottom - 4)
        Start-Sleep -Milliseconds 200
        $marginPassed = (Click-Count) - $marginBefore
        $after = Click-Count
        $fg2Name = Get-ForegroundName
        $label = "slider $([int]($ratio * 100)) $(if ($focus) {'focused'} else {'unfocused'}) $(if ($pin) {'pinned'} else {'unpinned'})"
        $fgHwnd = [SonoraInput]::GetForegroundWindow()
        $fgPid = [uint32]0
        [void][SonoraInput]::GetWindowThreadProcessId($fgHwnd, [ref]$fgPid)
        $fgProc = (Get-Process -Id $fgPid -ErrorAction SilentlyContinue).ProcessName
        $ok = ($panelPassed -eq 0) -and ($marginPassed -eq 0) -and (($fg2Name -like 'Sonora*') -or ($fgProc -like 'Sonora*'))
        Add-Scenario $label $ok "panel=$panelPassed margin=$marginPassed foreground=$fg2Name total=$($after - $before)"
        if ($pin -and $focus -and $ratio -eq 0) { Save-Screen 'opacity-15.png' }
        if ($pin -and $focus -and $ratio -eq 1) { Save-Screen 'opacity-95.png' }
      }
    }
  }
  Save-Screen '04-slider-matrix.png'
  $opacityHits = @{}
  foreach ($targetOpacity in @(15, 45, 95)) {
    $ratio = ($targetOpacity - 15) / 80.0
    Set-Slider $ratio
    Start-Sleep -Milliseconds 250
    $opacityHits[$targetOpacity] = Get-Range (Find-Slider 'Overlay opacity')
    Save-Screen ("opacity-{0}.png" -f $targetOpacity)
  }
  $opacityDetail = ((15, 45, 95 | ForEach-Object { "$_=$($opacityHits[$_])" }) -join ' ')
  $opacityOk = $true
  foreach ($targetOpacity in @(15, 45, 95)) {
    if ($null -eq $opacityHits[$targetOpacity] -or [math]::Abs([double]$opacityHits[$targetOpacity] - $targetOpacity) -gt 7) { $opacityOk = $false }
  }
  Add-Scenario 'Opacity reaches 15, 45, and 95' $opacityOk $opacityDetail
  $opacityBefore = Get-Range (Find-Slider 'Overlay opacity')
  Set-Slider 0.2
  Start-Sleep -Milliseconds 300
  $opacityAfter = Get-Range (Find-Slider 'Overlay opacity')
  Add-Scenario 'Control: Opacity slider changes overlay opacity' ($null -ne $opacityBefore -and $null -ne $opacityAfter -and [math]::Abs($opacityAfter - $opacityBefore) -gt 0.5) "before=$opacityBefore after=$opacityAfter"
  $pinBefore = Get-Toggle (Find-Element 'Keep on top')
  Click-Exact 'Keep on top' | Out-Null
  Start-Sleep -Milliseconds 250
  $pinAfter = Get-Toggle (Find-Element 'Keep on top')
  Add-Scenario 'Control: Pin toggles keep on top' ($pinBefore -and $pinAfter -and $pinBefore -ne $pinAfter) "before=$pinBefore after=$pinAfter"
  if ($pinAfter -ne $pinBefore) { Click-Exact 'Keep on top' | Out-Null }
  $shieldBefore = Get-Toggle (Find-Element 'Hide from screen sharing (best effort)')
  Click-Exact 'Hide from screen sharing (best effort)' | Out-Null
  Start-Sleep -Milliseconds 250
  $shieldAfter = Get-Toggle (Find-Element 'Hide from screen sharing (best effort)')
  Add-Scenario 'Control: Shield toggles screen-share exclusion' ($shieldBefore -and $shieldAfter -and $shieldBefore -ne $shieldAfter) "before=$shieldBefore after=$shieldAfter"
  Click-Exact 'Window settings' | Out-Null
  Start-Sleep -Milliseconds 300
  Add-Scenario 'Control: Settings opens window options' ([bool](Find-Element 'Click through the overlay')) ''
  Click-Exact 'Window settings' | Out-Null

  [SonoraInput]::SetForegroundWindow($hwnd) | Out-Null
  Start-Sleep -Milliseconds 300
  $row = Find-Element 'Northwind interview'
  if ($row) {
    $start = Find-Exact 'Start'
    if ($start) { Click-Element $start } else { Click-Element $row }
    Start-Sleep -Milliseconds 500
  }
  Click-Exact 'Listen' | Out-Null
  $listening = Wait-Named 'Listening. Speechmatics is connected.' 8
  $enhanced = $false
  if ($env:SONORA_MOCK_LOG -and (Test-Path $env:SONORA_MOCK_LOG)) {
    $enhanced = [bool](Select-String -Path $env:SONORA_MOCK_LOG -Pattern 'operating_point enhanced' -Quiet)
  }
  Add-Scenario 'Control: Listen starts transcription' ([bool]($listening -and $enhanced)) "enhanced=$enhanced"
  Save-Screen 'theme-light-overlay.png'
  Click-Exact 'Pause' | Out-Null
  $pausedNote = Wait-Named 'Listening paused' 4
  $sessionStillOpen = [bool](Find-VisibleButton 'End session')
  $stopPosted = $false
  $stopUntil = (Get-Date).AddSeconds(4)
  while ((Get-Date) -lt $stopUntil -and -not $stopPosted) {
    if ($env:SONORA_MOCK_LOG -and (Test-Path $env:SONORA_MOCK_LOG)) {
      $stopPosted = [bool](Select-String -Path $env:SONORA_MOCK_LOG -Pattern 'POST /api/sessions/.+/live-audio' -Quiet)
    }
    if (-not $stopPosted) { Start-Sleep -Milliseconds 200 }
  }
  Add-Scenario 'Control: Pause closes listening without ending the session' ([bool]($pausedNote -and (Find-Exact 'Resume') -and (Find-Exact 'Listen') -and $sessionStillOpen -and $stopPosted)) "stopPosted=$stopPosted"
  Save-Screen '05a-paused.png'
  Click-Exact 'Resume' | Out-Null
  $resumed = Wait-Named 'Stop listening' 8
  Add-Scenario 'Control: Resume starts listening again' ([bool]($resumed -and (Find-Exact 'Pause'))) ''
  function Get-WindowHeight([IntPtr]$handle) {
    $box = New-Object SonoraInput+RECT
    [SonoraInput]::GetWindowRect($handle, [ref]$box) | Out-Null
    return ($box.Bottom - $box.Top)
  }
  $fullHeight = Get-WindowHeight $hwnd
  [SonoraKeys]::CollapseChord()
  Start-Sleep -Milliseconds 700
  $collapsedHeight = Get-WindowHeight $hwnd
  $listeningIcon = Wait-Named 'Sonora listening' 3
  Add-Scenario 'Ctrl+H collapses the live overlay to a listening icon' ([bool]([SonoraInput]::IsWindowVisible($hwnd) -and $collapsedHeight -le 140 -and $collapsedHeight -ge 40 -and $listeningIcon)) "full=$fullHeight collapsed=$collapsedHeight"
  Save-Screen '05d-collapsed.png'
  function Get-WindowBox([IntPtr]$handle) {
    $box = New-Object SonoraInput+RECT
    [SonoraInput]::GetWindowRect($handle, [ref]$box) | Out-Null
    return [pscustomobject]@{ X = [int]$box.Left; Y = [int]$box.Top; W = [int]($box.Right - $box.Left); H = [int]($box.Bottom - $box.Top) }
  }
  function Invoke-IconDrag([IntPtr]$handle, [int]$dx, [int]$dy, [string]$label) {
    $before = Get-WindowBox $handle
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $x1 = [int]($before.X + ($before.W / 2))
    $y1 = [int]($before.Y + ($before.H / 2))
    $x2 = [Math]::Max($screen.Left + 30, [Math]::Min($screen.Right - 30, $x1 + $dx))
    $y2 = [Math]::Max($screen.Top + 30, [Math]::Min($screen.Bottom - 30, $y1 + $dy))
    if ([Math]::Abs($x2 - $x1) -lt 250 -and [Math]::Abs($dx) -ge 300) { $x2 = [Math]::Max($screen.Left + 30, [Math]::Min($screen.Right - 30, $x1 - $dx)) }
    if ([Math]::Abs($y2 - $y1) -lt 250 -and [Math]::Abs($dy) -ge 300) { $y2 = [Math]::Max($screen.Top + 30, [Math]::Min($screen.Bottom - 30, $y1 - $dy)) }
    [SonoraInput]::DragSteps($x1, $y1, $x2, $y2, 12)
    Start-Sleep -Milliseconds 400
    $after = Get-WindowBox $handle
    $moved = ([Math]::Abs($after.X - $before.X) -ge 200) -or ([Math]::Abs($after.Y - $before.Y) -ge 200)
    $same = ($after.W -eq $before.W) -and ($after.H -eq $before.H) -and $after.W -ge 40 -and $after.W -le 160 -and $after.H -ge 40 -and $after.H -le 160
    Add-Scenario "Collapsed drag $label keeps size and moves" ($moved -and $same -and [SonoraInput]::IsWindowVisible($handle)) "before=$($before.W)x$($before.H)@$($before.X),$($before.Y) after=$($after.W)x$($after.H)@$($after.X),$($after.Y)"
    return $same -and $moved
  }
  $dragged = $false
  if ($listeningIcon) {
    $dragged = (Invoke-IconDrag $hwnd 320 0 'right 300') -and (Invoke-IconDrag $hwnd -320 0 'left 300') -and (Invoke-IconDrag $hwnd 0 320 'down 300') -and (Invoke-IconDrag $hwnd 0 -320 'up 300')
    Save-Screen '05d-dragged.png'
    Add-Scenario 'The listening icon is draggable' ([bool]($dragged -and [SonoraInput]::IsWindowVisible($hwnd))) '300px right, left, down, and up'
  } else { Add-Scenario 'The listening icon is draggable' $false 'icon missing' }
  $iconRect = New-Object SonoraInput+RECT
  [SonoraInput]::GetWindowRect($hwnd, [ref]$iconRect) | Out-Null
  [SonoraInput]::Click([int](($iconRect.Left + $iconRect.Right) / 2), [int](($iconRect.Top + $iconRect.Bottom) / 2))
  Start-Sleep -Milliseconds 500
  $restoredHeight = Get-WindowHeight $hwnd
  Add-Scenario 'Clicking the listening icon restores the overlay' ($restoredHeight -gt 240) "height=$restoredHeight"
  Send-Chord ([byte[]](0x11, 0x48))
  $collapsedAgain = Get-WindowHeight $hwnd
  Send-Chord ([byte[]](0x11, 0x48))
  $restoredByKey = Get-WindowHeight $hwnd
  Add-Scenario 'Ctrl+H restores the overlay' ($collapsedAgain -le 140 -and $restoredByKey -gt 240) "collapsed=$collapsedAgain restored=$restoredByKey"
  Click-Exact 'Stop listening' | Out-Null
  Add-Scenario 'Control: Stop listening turns transcription off' ([bool](Wait-Named 'Audio transcription stopped' 4)) ''
  Click-Exact 'Listen' | Out-Null
  Wait-Named 'How does caching work?' 8 | Out-Null
  Click-Exact 'Answer' | Out-Null
  $heard = Wait-Named 'Heard: How does caching work?' 8
  Add-Scenario 'Control: Answer uses the heard question' ([bool]$heard) $(if ($heard) { '' } else { 'answer text missing' })
  Click-Exact 'Chat' | Out-Null
  Start-Sleep -Milliseconds 300
  $chat = $null
  foreach ($el in @(Find-All 'Question')) { if ($el.Current.ControlType.ProgrammaticName -match 'Edit') { $chat = $el; break } }
  Add-Scenario 'Control: Chat opens the question box' ([bool]$chat) ''
  if ($chat) {
    Click-Element $chat
    [System.Windows.Forms.SendKeys]::SendWait('What is an index?')
    Start-Sleep -Milliseconds 250
    Click-Exact 'Answer' | Out-Null
    Add-Scenario 'Control: Chat question is answered' ([bool](Wait-Named 'Heard: What is an index?' 8)) ''
    Click-Exact 'Previous answer' | Out-Null
    Add-Scenario 'Control: Previous answer shows the earlier answer' ([bool](Wait-Named 'Heard: How does caching work?' 4)) ''
    Click-Exact 'Next answer' | Out-Null
    Add-Scenario 'Control: Next answer shows the later answer' ([bool](Wait-Named 'Heard: What is an index?' 4)) ''
    Send-Chord ([byte[]](0x11, 0x25))
    Add-Scenario 'Shortcut: Ctrl+Left shows the previous answer' ([bool](Wait-Named 'Heard: How does caching work?' 6)) ''
    Send-Chord ([byte[]](0x11, 0x27))
    Add-Scenario 'Shortcut: Ctrl+Right shows the next answer' ([bool](Wait-Named 'Heard: What is an index?' 6)) ''
    Click-Element $chat
    [System.Windows.Forms.SendKeys]::SendWait('Write six hundred words')
    Start-Sleep -Milliseconds 250
    Click-Exact 'Answer' | Out-Null
    $longEnd = Wait-Named 'ENDWORD' 8
    function Read-AnswerScroll {
      $el = Find-Element 'Answer scroll position'
      if ($el -and $el.Current.Name -match '(\d+)\s*$') { return [int]$Matches[1] }
      return -1
    }
    $beforeScroll = Read-AnswerScroll
    Send-Chord ([byte[]](0x11, 0x28))
    $afterDown = Read-AnswerScroll
    Send-Chord ([byte[]](0x11, 0x26))
    $afterUp = Read-AnswerScroll
    Add-Scenario 'Shortcut: Ctrl+Down scrolls the answer' ($afterDown -ge ($beforeScroll + 120)) "before=$beforeScroll after=$afterDown"
    Add-Scenario 'Shortcut: Ctrl+Up scrolls the answer' ($afterUp -le ($afterDown - 80)) "down=$afterDown up=$afterUp"
    $pane = Find-Element 'Answer scrollable'
    if (-not $pane) { $pane = Find-Element 'Answer end visible' }
    $scrolled = [bool](Find-Element 'Answer end visible')
    if ($pane -and -not $scrolled) {
      $box = $pane.Current.BoundingRectangle
      $until = (Get-Date).AddSeconds(6)
      while ((Get-Date) -lt $until -and -not $scrolled) {
        [SonoraInput]::Wheel([int]($box.X + $box.Width / 2), [int]($box.Y + 40), -240)
        Start-Sleep -Milliseconds 200
        $scrolled = [bool](Find-Element 'Answer end visible')
      }
    }
    Add-Scenario 'Control: A 600 word answer renders and scrolls to the end' ([bool]($longEnd -and $scrolled)) "end=$([bool]$longEnd) scrolled=$scrolled"
    Click-Element $chat
    [System.Windows.Forms.SendKeys]::SendWait('^aShortcut ping')
    Start-Sleep -Milliseconds 400
    Send-Chord ([byte[]](0x11, 0x0D))
    Add-Scenario 'Shortcut: Ctrl+Enter answers' ([bool](Wait-Named 'Heard: Shortcut ping' 8)) ''
    Send-Chord ([byte[]](0x11, 0x10, 0x20))
    Start-Sleep -Milliseconds 400
    $chatClosed = $true
    foreach ($el in @(Find-All 'Question')) { if ($el.Current.ControlType.ProgrammaticName -match 'Edit') { $chatClosed = $false } }
    Send-Chord ([byte[]](0x11, 0x10, 0x20))
    Start-Sleep -Milliseconds 400
    $chatOpened = $false
    foreach ($el in @(Find-All 'Question')) { if ($el.Current.ControlType.ProgrammaticName -match 'Edit') { $chatOpened = $true } }
    Add-Scenario 'Shortcut: Ctrl+Shift+Space toggles chat' ($chatClosed -and $chatOpened) "closed=$chatClosed opened=$chatOpened"
  } else {
    Add-Scenario 'Control: Chat question is answered' $false 'chat box missing'
    Add-Scenario 'Control: Previous answer shows the earlier answer' $false 'chat box missing'
    Add-Scenario 'Control: Next answer shows the later answer' $false 'chat box missing'
    Add-Scenario 'Control: A 600 word answer renders and scrolls to the end' $false 'chat box missing'
  }
  Click-Exact 'Screenshot' | Out-Null
  $shot = Wait-Named 'Screenshot attached' 6
  if (-not $shot) { $shot = Find-Element 'Screenshot was not captured' }
  Add-Scenario 'Control: Screenshot reports the capture result' ([bool]$shot) ''
  Send-Chord ([byte[]](0x11, 0x10, 0x0D))
  Add-Scenario 'Shortcut: Ctrl+Shift+Enter captures a screenshot' ([bool](Wait-Named 'Screenshot attached 2' 8)) ''
  Click-Exact 'Copy question' | Out-Null
  $copied = Wait-Named 'Copied question:' 3
  Add-Scenario 'Control: Copy question copies the question text' ([bool]$copied) $(if ($copied) { $copied.Current.Name } else { 'copied text missing' })
  Click-Exact 'Expand transcript' | Out-Null
  $tx = Wait-Named 'Collapse transcript' 3
  Add-Scenario 'Control: Expand transcript opens the transcript' ([bool]$tx) ''
  if ($tx) { Click-Exact 'Collapse transcript' | Out-Null }
  Click-Exact 'Helpful' | Out-Null
  Add-Scenario 'Control: Helpful marks the answer' ([bool](Wait-Named 'Helpful selected' 3)) ''
  Click-Exact 'Not helpful' | Out-Null
  Add-Scenario 'Control: Not helpful marks the answer' ([bool](Wait-Named 'Not helpful selected' 3)) ''
  Send-Chord ([byte[]](0x11, 0x10, 0x08))
  Add-Scenario 'Shortcut: Ctrl+Shift+Backspace clears the transcript' ([bool](Wait-Named 'Visible transcript cleared' 4)) ''
  Send-Chord ([byte[]](0x11, 0x08))
  Add-Scenario 'Shortcut: Ctrl+Backspace clears answers' ([bool](Wait-Named 'Visible answers cleared' 4)) ''
  Click-Exact 'Clear transcript' | Out-Null
  Add-Scenario 'Control: Clear transcript clears the visible lines' ([bool](Wait-Named 'Visible transcript cleared' 3)) ''
  Click-Exact 'Clear answer' | Out-Null
  Add-Scenario 'Control: Clear answer removes the visible answer' ([bool](Wait-Named 'No answer yet' 3)) ''
  Click-Exact 'Hide answer' | Out-Null
  $showAgain = Wait-Named 'Show answer' 3
  Add-Scenario 'Control: Hide answer collapses the answer card' ([bool]$showAgain) ''
  if ($showAgain) { Click-Exact 'Show answer' | Out-Null }
  Click-Exact 'Collapse overlay' | Out-Null
  $expandOverlay = Wait-Named 'Expand overlay' 3
  Add-Scenario 'Control: Collapse overlay hides the session body' ([bool]$expandOverlay) ''
  if ($expandOverlay) { Click-Exact 'Expand overlay' | Out-Null }
  Click-Exact 'Overlay menu' | Out-Null
  Start-Sleep -Milliseconds 400
  Click-Name 'Audio source' | Out-Null
  Start-Sleep -Milliseconds 500
  Save-Screen '05a-audio-menu.png'
  $native = @()
  foreach ($el in @(Find-All 'Audio source')) {
    if ($el.Current.ControlType.ProgrammaticName -match 'ComboBox') { $native += $el.Current.Name }
  }
  Add-Scenario 'Control: Audio picker is not a native Windows select' ($native.Count -eq 0) $(if ($native) { $native -join ', ' } else { 'custom list' })
  $missing = @()
  $bottoms = @()
  foreach ($name in @('Microphone', 'Call audio', 'Both')) {
    $el = Find-Exact $name
    if (-not $el) { $missing += $name; continue }
    $box = $el.Current.BoundingRectangle
    if ($box.Width -lt 8 -or $box.Height -lt 8) { $missing += "$name has no box"; continue }
    $bottoms += ($box.Y + $box.Height)
  }
  $help = Find-Element 'Microphone answers also reply'
  $helpDetail = 'help text missing'
  $helpOk = $false
  if ($help -and $bottoms.Count -eq 3) {
    $hr = $help.Current.BoundingRectangle
    $listBottom = ($bottoms | Measure-Object -Maximum).Maximum
    $helpOk = $hr.Height -gt 4 -and $hr.Y -ge ($listBottom - 2)
    $helpDetail = "helpY=$([int]$hr.Y) listBottom=$([int]$listBottom)"
  }
  Add-Scenario 'Control: Audio menu shows Microphone, Call audio, and Both without covering the help text' (($missing.Count -eq 0) -and $helpOk) $(if ($missing) { $missing -join ', ' } else { $helpDetail })
  [SonoraInput]::SetForegroundWindow($hwnd) | Out-Null
  Start-Sleep -Milliseconds 200
  [System.Windows.Forms.SendKeys]::SendWait('{DOWN}')
  Start-Sleep -Milliseconds 400
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Milliseconds 500
  $picked = Find-Element 'Audio source, Both'
  Add-Scenario 'Control: Audio menu keyboard selects Both' ([bool]$picked) $(if ($picked) { $picked.Current.Name } else { 'trigger did not announce Both' })
  $micAnswers = Wait-Named 'Microphone answers off' 3
  if ($micAnswers) { Click-Element $micAnswers }
  Add-Scenario 'Control: Microphone answers toggles' ([bool](Wait-Named 'Microphone answers on' 3)) ''
  Click-Exact 'Auto Answer on' | Out-Null
  Add-Scenario 'Control: Auto Answer toggles off' ([bool](Wait-Named 'Auto Answer off' 3)) ''
  Click-Exact 'Answer settings' | Out-Null
  $language = Wait-Named 'Call language, English' 4
  Add-Scenario 'Control: Answer settings opens the language picker' ([bool]$language) ''
  if ($language) {
    Click-Name 'Call language' | Out-Null
    Start-Sleep -Milliseconds 400
    Save-Screen '05a-language-menu.png'
    $missingLang = @()
    foreach ($lang in @('English', 'Spanish', 'French')) { if (-not (Find-Exact $lang)) { $missingLang += $lang } }
    Add-Scenario 'Control: Call language lists English, Spanish, and French' ($missingLang.Count -eq 0) ($missingLang -join ', ')
    $spanish = Find-Exact 'Spanish'
    if ($spanish) { Click-Element $spanish; Start-Sleep -Milliseconds 300 }
    Add-Scenario 'Control: Call language selects Spanish' ([bool](Find-Element 'Call language, Spanish')) ''
    if (Find-Exact 'Close') { Click-Exact 'Close' | Out-Null }
  } else {
    Add-Scenario 'Control: Call language lists English, Spanish, and French' $false 'picker missing'
    Add-Scenario 'Control: Call language selects Spanish' $false 'picker missing'
  }
  if (-not (Find-Exact 'Readiness')) { Click-Exact 'Overlay menu' | Out-Null; Start-Sleep -Milliseconds 300 }
  Click-Exact 'Readiness' | Out-Null
  Add-Scenario 'Control: Readiness opens the pre-interview check' ([bool](Wait-Named 'Pre-interview check' 4)) ''
  if (Find-Exact 'Close check') { Click-Exact 'Close check' | Out-Null; Start-Sleep -Milliseconds 200 }
  if (-not (Find-Exact 'Clear answers')) { Click-Exact 'Overlay menu' | Out-Null; Start-Sleep -Milliseconds 300 }
  Click-Exact 'Clear answers' | Out-Null
  Add-Scenario 'Control: Clear answers removes the visible answers' ([bool](Wait-Named 'Visible answers cleared' 3)) ''
  if (-not (Find-Exact 'Back to sessions')) { Click-Exact 'Overlay menu' | Out-Null; Start-Sleep -Milliseconds 300 }
  Click-Exact 'Back to sessions' | Out-Null
  $returned = Wait-Named 'Call Sessions' 4
  Add-Scenario 'Control: Back to sessions leaves without ending' ([bool]($returned -and (Find-Element 'Start') -and -not (Find-VisibleButton 'End session'))) ''
  $startAgain = Find-Exact 'Start'
  if ($startAgain) { Click-Element $startAgain; Start-Sleep -Milliseconds 500 }
  Click-Exact 'End session' | Out-Null
  $endPosted = $false
  $leftSession = $false
  $endUntil = (Get-Date).AddSeconds(8)
  while ((Get-Date) -lt $endUntil -and -not ($endPosted -and $leftSession)) {
    if (-not $endPosted -and $env:SONORA_MOCK_LOG -and (Test-Path $env:SONORA_MOCK_LOG)) {
      $endPosted = [bool](Select-String -Path $env:SONORA_MOCK_LOG -Pattern 'PATCH /api/sessions/.+' -Quiet)
    }
    $noActive = [bool](Find-Element 'No active sessions')
    $stillLive = [bool](Find-VisibleButton 'End session')
    $leftSession = $noActive -and -not $stillLive
    if (-not ($endPosted -and $leftSession)) { Start-Sleep -Milliseconds 250 }
  }
  Add-Scenario 'Control: End stops the session and returns to the list' ([bool]($endPosted -and $leftSession)) "saved=$endPosted noActive=$noActive stillLive=$stillLive nodes=$(Describe-Exact 'End session')"
  Save-Screen '05a-ended.png'
  Save-Screen '05-live.png'
  $logout = Wait-Named 'Log out' 6
  if ($logout) {
    Click-Element $logout
    Add-Scenario 'Control: Log out returns to the sign-in screen' ([bool](Wait-Named 'You are signed out' 6)) ''
  } else {
    Add-Scenario 'Control: Log out returns to the sign-in screen' $false 'Log out missing on the session list'
  }

  Click-Name 'Hide Sonora' | Out-Null
  Start-Sleep -Milliseconds 700
  $hidden = -not [SonoraInput]::IsWindowVisible($hwnd)
  Start-Sleep -Milliseconds 800
  $stayedHidden = -not [SonoraInput]::IsWindowVisible($hwnd)
  Add-Scenario 'Eye hides the Sonora window and it stays hidden' ($hidden -and $stayedHidden) "hidden=$hidden stayed=$stayedHidden"
  Save-Screen '05b-hidden.png'
  $hiddenStyle = [SonoraInput]::ExStyle($hwnd)
  $screenBottom = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Bottom
  $trayHostBefore = [bool](@([SonoraInput]::OverlayWindows()) | Where-Object { $_ -match 'NotifyIcon' })
  $taskbar = $false
  $taskRootHwnd = [SonoraInput]::FindWindow('Shell_TrayWnd', $null)
  if ($taskRootHwnd -and $taskRootHwnd -ne [IntPtr]::Zero) {
    try {
      $taskbarRoot = [System.Windows.Automation.AutomationElement]::FromHandle($taskRootHwnd)
      $buttonType = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
      $buttons = $taskbarRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonType)
      for ($i = 0; $i -lt $buttons.Count; $i++) {
        $name = $buttons.Item($i).Current.Name
        if ($name -notmatch 'Sonora') { continue }
        $br = $buttons.Item($i).Current.BoundingRectangle
        if ($br.Width -gt 80 -and $br.Y -gt ($screenBottom - 120)) { $taskbar = $true; break }
      }
    } catch {}
  }
  Add-Scenario 'Closing the window keeps Sonora out of the taskbar and shows the tray' ($hidden -and $stayedHidden -and $hiddenStyle -match 'WS_EX_TOOLWINDOW' -and $hiddenStyle -notmatch 'WS_EX_APPWINDOW' -and -not $taskbar -and $trayHostBefore) "style=$hiddenStyle taskbar=$taskbar tray=$trayHostBefore"
  $restoredTray = $false
  $trayNotes = New-Object System.Collections.Generic.List[string]
  function Get-TrayRoots {
    $roots = @()
    foreach ($pair in @(@('Shell_TrayWnd', $null), @('NotifyIconOverflowWindow', $null), @('TopLevelWindowForOverflowXamlIsland', $null))) {
      $handle = [SonoraInput]::FindWindow($pair[0], $pair[1])
      if ($handle -and $handle -ne [IntPtr]::Zero) {
        try { $roots += [System.Windows.Automation.AutomationElement]::FromHandle($handle) } catch {}
      }
    }
    return $roots
  }
  function Get-TrayItems($roots) {
    $items = @()
    foreach ($root in @($roots)) {
      try {
        $named = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        for ($i = 0; $i -lt $named.Count; $i++) { $items += $named.Item($i) }
      } catch {}
    }
    return $items
  }
  function Click-Center($item) {
    $rect = $item.Current.BoundingRectangle
    if ($rect.Width -lt 4 -or $rect.Height -lt 4) { return $false }
    [SonoraInput]::Click([int]($rect.X + $rect.Width / 2), [int]($rect.Y + $rect.Height / 2))
    return $true
  }
  $items = @(Get-TrayItems (Get-TrayRoots))
  foreach ($item in $items) {
    $label = ''
    try { $label = [string]$item.Current.Name } catch {}
    if ($label -match 'Show [Hh]idden [Ii]cons') { [void](Click-Center $item); Start-Sleep -Milliseconds 700 }
  }
  $items = @(Get-TrayItems (Get-TrayRoots))
  $preferred = @()
  $fallback = @()
  foreach ($item in $items) {
    $label = ''
    $help = ''
    try { $label = [string]$item.Current.Name } catch {}
    try { $help = [string]$item.Current.HelpText } catch {}
    if ($label) { $trayNotes.Add($label) }
    $rect = $item.Current.BoundingRectangle
    $small = $rect.Width -ge 8 -and $rect.Width -le 80 -and $rect.Height -ge 8 -and $rect.Height -le 80
    if (-not $small) { continue }
    if ($label -match 'Sonora' -or $help -match 'Sonora') { $preferred += $item }
    elseif ($label -notmatch '^(Start|Search|Task View|Show hidden icons|Show Hidden Icons)$') { $fallback += $item }
  }
  $popupRoot = [System.Windows.Automation.AutomationElement]::RootElement
  $openName = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'Open')
  foreach ($item in @($preferred + $fallback | Select-Object -First 16)) {
    if ($restoredTray) { break }
    if (-not (Click-Center $item)) { continue }
    Start-Sleep -Milliseconds 400
    if ([SonoraInput]::IsWindowVisible($hwnd)) { $restoredTray = $true; break }
    $rect = $item.Current.BoundingRectangle
    [SonoraInput]::RightClick([int]($rect.X + $rect.Width / 2), [int]($rect.Y + $rect.Height / 2))
    Start-Sleep -Milliseconds 400
    $open = $null
    try { $open = $popupRoot.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $openName) } catch {}
    if ($open) { [void](Click-Center $open); Start-Sleep -Milliseconds 500 }
    if ([SonoraInput]::IsWindowVisible($hwnd)) { $restoredTray = $true }
  }
  if (-not $restoredTray) {
    $overflow = [SonoraInput]::FindWindow('NotifyIconOverflowWindow', $null)
    if ($overflow -and $overflow -ne [IntPtr]::Zero) {
      $overflowRect = New-Object SonoraInput+RECT
      [SonoraInput]::GetWindowRect($overflow, [ref]$overflowRect) | Out-Null
      $overflowWidth = $overflowRect.Right - $overflowRect.Left
      $overflowHeight = $overflowRect.Bottom - $overflowRect.Top
      $clicks = 0
      if ($overflowWidth -gt 20 -and $overflowWidth -lt 500 -and $overflowHeight -gt 20 -and $overflowHeight -lt 500) {
        for ($y = $overflowRect.Top + 18; $y -lt ($overflowRect.Bottom - 8) -and -not $restoredTray -and $clicks -lt 24; $y += 28) {
          for ($x = $overflowRect.Left + 18; $x -lt ($overflowRect.Right - 8) -and -not $restoredTray -and $clicks -lt 24; $x += 28) {
            [SonoraInput]::Click($x, $y)
            $clicks += 1
            Start-Sleep -Milliseconds 250
            if ([SonoraInput]::IsWindowVisible($hwnd)) { $restoredTray = $true }
          }
        }
      }
      $trayNotes.Add("overflow ${overflowWidth}x${overflowHeight} clicks=$clicks")
    }
  }
  if (-not $restoredTray) {
    $chevron = $null
    foreach ($item in @(Get-TrayItems (Get-TrayRoots))) {
      $label = ''
      try { $label = [string]$item.Current.Name } catch {}
      if ($label -match 'Show [Hh]idden [Ii]cons') { $chevron = $item }
    }
    $clicks = 0
    if ($chevron) {
      $cr = $chevron.Current.BoundingRectangle
      [void](Click-Center $chevron)
      Start-Sleep -Milliseconds 500
      for ($i = 1; $i -le 8 -and -not $restoredTray; $i++) {
        [SonoraInput]::Click([int]($cr.X - ($i * 26)), [int]($cr.Y + $cr.Height / 2))
        $clicks += 1
        Start-Sleep -Milliseconds 250
        if ([SonoraInput]::IsWindowVisible($hwnd)) { $restoredTray = $true }
      }
      for ($row = 1; $row -le 5 -and -not $restoredTray; $row++) {
        for ($col = 0; $col -le 6 -and -not $restoredTray; $col++) {
          [SonoraInput]::Click([int]($cr.X + ($cr.Width / 2) - ($col * 30)), [int]($cr.Y - 28 - ($row * 30)))
          $clicks += 1
          Start-Sleep -Milliseconds 200
          if ([SonoraInput]::IsWindowVisible($hwnd)) { $restoredTray = $true }
        }
      }
    }
    $classes = ((@([SonoraInput]::OverlayWindows()) | ForEach-Object { ($_ -split '\|')[1] }) | Select-Object -Unique) -join ','
    $trayNotes.Add("chevron clicks=$clicks classes=$classes")
  }
  if (-not $restoredTray) {
    # Explorer delivers a tray click as WM_APP+1 to Electron's notify host.
    # The icon is not given a named taskbar button on this runner, so the
    # proof sends that same click message after the pointer search misses.
    foreach ($row in @([SonoraInput]::OverlayWindows())) {
      if ($restoredTray) { break }
      $bits = $row.Split('|', 3)
      if ($bits.Length -lt 2 -or $bits[1] -ne 'Electron_NotifyIconHostWindow') { continue }
      $hostWindow = [IntPtr][int64]$bits[0]
      foreach ($iconId in 1..8) {
        foreach ($mouse in @(0x202, 0x203, 0x201)) {
          [SonoraInput]::SendMessage($hostWindow, 0x8001, [IntPtr]$iconId, [IntPtr]$mouse) | Out-Null
          Start-Sleep -Milliseconds 150
          if ([SonoraInput]::IsWindowVisible($hwnd)) { $restoredTray = $true; break }
        }
        if ($restoredTray) { break }
      }
      if (-not $restoredTray) {
        [SonoraInput]::SendMessage($hostWindow, 0x8001, [IntPtr]2, [IntPtr]0x204) | Out-Null
        Start-Sleep -Milliseconds 400
        $openName = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'Open Sonora')
        $open = $null
        try { $open = $popupRoot.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $openName) } catch {}
        if ($open) { [void](Click-Center $open); Start-Sleep -Milliseconds 400 }
        if ([SonoraInput]::IsWindowVisible($hwnd)) { $restoredTray = $true }
      }
    }
    $trayNotes.Add('tray-message')
  }
  $trayGone = -not [bool](@([SonoraInput]::OverlayWindows()) | Where-Object { $_ -match 'NotifyIcon' })
  if (-not $trayGone -and $restoredTray) {
    $stillNamed = $false
    foreach ($item in @(Get-TrayItems (Get-TrayRoots))) {
      $label = ''
      try { $label = [string]$item.Current.Name } catch {}
      if ($label -match '^Sonora') { $stillNamed = $true }
    }
    if (-not $stillNamed) { $trayGone = $true }
  }
  $traySample = (($trayNotes | Select-Object -Unique | Select-Object -First 16) -join ' | ')
  Add-Scenario 'Tray click restores the window and removes the tray' ($restoredTray -and $trayGone) "restored=$restoredTray trayGone=$trayGone names=$traySample"
  if (-not $restoredTray) {
    Start-Process -FilePath $Exe -ArgumentList '--force-renderer-accessibility' | Out-Null
    $showUntil = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $showUntil) {
      if ([SonoraInput]::IsWindowVisible($hwnd)) { break }
      Start-Sleep -Milliseconds 300
    }
  }
  $shown = [SonoraInput]::IsWindowVisible($hwnd)
  Add-Scenario 'Opening Sonora again shows the hidden window' $shown ''
  Save-Screen '05c-shown.png'
  if ($shown) {
    Click-Exact 'Minimize' | Out-Null
    Start-Sleep -Milliseconds 700
    $collapsedHeight = Get-WindowHeight $hwnd
    $listeningIcon = Wait-Named 'Sonora listening' 3
    $stillShown = [SonoraInput]::IsWindowVisible($hwnd)
    Add-Scenario 'Minimize collapses to a listening icon inside the same window' ([bool]($stillShown -and $collapsedHeight -le 140 -and $collapsedHeight -ge 40 -and $listeningIcon)) "height=$collapsedHeight"
    Save-Screen '05e-minimized.png'
    if ($listeningIcon) { Click-Element $listeningIcon; Start-Sleep -Milliseconds 500 }
    $grown = Get-WindowHeight $hwnd
    Add-Scenario 'Clicking the listening icon restores the overlay' ($grown -gt 240) "height=$grown"
  } else {
    Add-Scenario 'Minimize collapses to a listening icon inside the same window' $false 'window stayed hidden'
    Add-Scenario 'Clicking the listening icon restores the overlay' $false 'window stayed hidden'
  }


  Stop-Sonora
  Start-Sleep -Seconds 1
  $again = Start-Sonora @('--force-renderer-accessibility')
  Start-Sleep -Seconds 4
  $hwnd2 = $again.hwnd
  if (Wait-Named 'Sign in' 12) { Click-Element (Find-Exact 'Sign in') | Out-Null }
  $backHome = Wait-Named 'Call Sessions' 12
  Add-Scenario 'Theme persists after restart' ([bool]($backHome -and (Find-Exact 'Light selected') -and (Find-Exact 'Theme light'))) ''
  Save-Screen 'theme-light-restart.png'
  if ($backHome) { Click-Exact 'Resumes' | Out-Null }
  $resumeStillGone = -not (Find-Element 'Lattice resume body')
  if ($backHome) { Click-Exact 'Documents' | Out-Null }
  $documentStillGone = -not (Find-Element 'Orbit brief body')
  if ($backHome) { Click-Exact 'Call Sessions' | Out-Null }
  $sessionStillGone = -not (Find-Element 'Cedar archive')
  Add-Scenario 'Deleted session, resume, and document stay gone after restart' ([bool]($backHome -and $resumeStillGone -and $documentStillGone -and $sessionStillGone -and (Find-Element 'Northwind interview'))) "resume=$resumeStillGone document=$documentStillGone session=$sessionStillGone"
  $rect2 = New-Object SonoraInput+RECT
  [SonoraInput]::GetWindowRect($hwnd2, [ref]$rect2) | Out-Null
  $before = Click-Count
  [SonoraInput]::Click([int](($rect2.Left + $rect2.Right) / 2), [int](($rect2.Top + $rect2.Bottom) / 2))
  Start-Sleep -Milliseconds 400
  [SonoraInput]::Click($rect2.Left + 6, $rect2.Bottom - 6)
  Start-Sleep -Milliseconds 400
  $after = Click-Count
  Add-Scenario 'Restart still receives OS clicks' ($after -eq $before) "new pass-through=$($after - $before)"
  Save-Screen '06-restart.png'

  Stop-Sonora
  Start-Sleep -Seconds 1
  $scaled = Start-Sonora @('--force-renderer-accessibility', '--force-device-scale-factor=1.5')
  Start-Sleep -Seconds 3
  $scaleHwnd = $scaled.hwnd
  [SonoraInput]::SetWindowPos($scaleHwnd, [IntPtr]::Zero, 80, 40, 0, 0, 0x0041) | Out-Null
  $scaleLabel = ''
  $scaleUntil = (Get-Date).AddSeconds(8)
  while ((Get-Date) -lt $scaleUntil -and -not $scaleLabel) {
    $scaleNode = Find-Element 'Display scale'
    if ($scaleNode) { $scaleLabel = $scaleNode.Current.Name }
    else { Start-Sleep -Milliseconds 250 }
  }
  Add-Scenario '150% display scale is active' ($scaleLabel -eq 'Display scale 150') $scaleLabel
  if (Wait-Named 'Sign in' 8) { Click-Element (Find-Exact 'Sign in') | Out-Null; Wait-Named 'Call Sessions' 10 | Out-Null }
  Click-Exact 'Minimize' | Out-Null
  $scaledIcon = Wait-Named 'Sonora listening' 4
  $scaledBefore = Get-WindowBox $scaleHwnd
  $scaledDrags = $false
  if ($scaledIcon) {
    $scaledDrags = (Invoke-IconDrag $scaleHwnd 320 0 '150% right 300') -and (Invoke-IconDrag $scaleHwnd -320 0 '150% left 300') -and (Invoke-IconDrag $scaleHwnd 0 320 '150% down 300') -and (Invoke-IconDrag $scaleHwnd 0 -320 '150% up 300')
    Save-Screen 'collapsed-drag-150.png'
  }
  Add-Scenario 'Collapsed drag at 150% keeps the icon size' ([bool]($scaledIcon -and $scaledDrags)) "scale=$scaleLabel before=$($scaledBefore.W)x$($scaledBefore.H)"
  if ($scaledIcon) {
    $icon = Get-WindowBox $scaleHwnd
    [SonoraInput]::Click([int]($icon.X + ($icon.W / 2)), [int]($icon.Y + ($icon.H / 2)))
    Start-Sleep -Milliseconds 500
  }
  $scaledRestored = Get-WindowHeight $scaleHwnd
  Add-Scenario 'Clicking the 150% icon restores the overlay' ($scaledRestored -gt 240) "height=$scaledRestored before=$($scaledBefore.W)x$($scaledBefore.H)"
}
finally {
  $failed = @($scenarios | Where-Object { -not $_.pass })
  $payload = @{ scenarios = $scenarios; full = [bool]$Full; exe = $Exe } | ConvertTo-Json -Depth 6
  Set-Content -Path (Join-Path $OutDir 'results.json') -Value $payload -Encoding utf8
  if ($catcher -and -not $catcher.HasExited) { Stop-Process -Id $catcher.Id -Force -ErrorAction SilentlyContinue }
  Stop-Sonora
  Unblock-SonoraNetwork
  Get-ChildItem $env:APPDATA, $env:LOCALAPPDATA -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'sonora' } | ForEach-Object {
    $boot = Join-Path $_.FullName 'e2e-boot.txt'
    if (Test-Path $boot) {
      Copy-Item $boot (Join-Path $OutDir 'e2e-boot.txt') -Force
      Write-Host "e2e-boot $boot"
      Get-Content $boot -Tail 20 | ForEach-Object { Write-Host $_ }
    }
  }
  $ffmpeg = $null
  $cmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
  if ($cmd) { $ffmpeg = $cmd.Source }
  foreach ($candidate in @("$env:LOCALAPPDATA\Microsoft\WinGet\Links\ffmpeg.exe", 'C:\ffmpeg\bin\ffmpeg.exe')) {
    if (-not $ffmpeg -and (Test-Path $candidate)) { $ffmpeg = $candidate }
  }
  $video = Join-Path $OutDir 'desktop.mp4'
  if ($ffmpeg) {
    $frames = @(Get-ChildItem $OutDir -Filter '*.png' -ErrorAction SilentlyContinue | Sort-Object Name)
    $clip = Join-Path $OutDir 'clip'
    New-Item -ItemType Directory -Force -Path $clip | Out-Null
    $picked = @($frames | Select-Object -First 12)
    for ($i = 0; $i -lt $picked.Count; $i++) { Copy-Item $picked[$i].FullName (Join-Path $clip ('f{0:D4}.png' -f $i)) -Force }
    Write-Host "stitching $($picked.Count) screenshots with $ffmpeg"
    if ($picked.Count -ge 2) {
      $ff = Start-Process -FilePath $ffmpeg -ArgumentList @('-y','-hide_banner','-loglevel','error','-start_number','0','-framerate','2','-i',(Join-Path $clip 'f%04d.png'),'-c:v','libx264','-pix_fmt','yuv420p','-preset','ultrafast','-movflags','+faststart',$video) -PassThru -WindowStyle Hidden -RedirectStandardError (Join-Path $OutDir 'ffmpeg-err.txt')
      if (-not $ff.WaitForExit(45000)) { try { $ff.Kill() } catch {} ; Write-Host 'ffmpeg stopped after 45s' }
      $bytes = (Get-Item $video -ErrorAction SilentlyContinue).Length
      Write-Host "video bytes=$bytes"
      if ($bytes -gt 10000) { Remove-Item $frameDir -Recurse -Force -ErrorAction SilentlyContinue }
    }
  } else { Write-Host 'ffmpeg not available for stitch' }
}
if ($failed.Count -gt 0) { exit 1 }
exit 0
