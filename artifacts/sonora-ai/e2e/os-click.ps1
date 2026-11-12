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
    return "0x" + style.ToString("X") + " " + string.Join(",", parts);
  }
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
  public static void RaiseWithoutFocus(IntPtr hWnd) {
    SetWindowPos(hWnd, new IntPtr(-1), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
  }
}
"@

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
    if ($hoverName -match 'cursor pointer' -and $hoverName -notmatch 'Hover idle') { break }
  }
  $hoverOk = $hoverName -match 'Hover ' -and $hoverName -notmatch 'Hover idle' -and $hoverName -match 'cursor pointer'
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
  Click-Exact 'Light' | Out-Null
  Start-Sleep -Milliseconds 250
  Add-Scenario 'Control: Light theme toggle' ([bool](Find-Element 'Theme light')) ''
  Click-Exact 'Dark' | Out-Null
  Start-Sleep -Milliseconds 250
  Add-Scenario 'Control: Dark theme toggle' ([bool](Find-Element 'Theme dark')) ''

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
        $ok = ($panelPassed -eq 0) -and ($marginPassed -eq 0) -and ($fg2Name -like 'Sonora*')
        Add-Scenario $label $ok "panel=$panelPassed margin=$marginPassed foreground=$fg2Name total=$($after - $before)"
      }
    }
  }
  Save-Screen '04-slider-matrix.png'
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
  Add-Scenario 'Control: Listen starts transcription' ([bool]$listening) ''
  Click-Exact 'Pause' | Out-Null
  $pausedNote = Wait-Named 'Listening paused' 4
  $sessionStillOpen = [bool](Find-Exact 'End session')
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
  } else {
    Add-Scenario 'Control: Chat question is answered' $false 'chat box missing'
    Add-Scenario 'Control: Previous answer shows the earlier answer' $false 'chat box missing'
    Add-Scenario 'Control: Next answer shows the later answer' $false 'chat box missing'
  }
  Click-Exact 'Screenshot' | Out-Null
  $shot = Wait-Named 'Screenshot attached' 6
  if (-not $shot) { $shot = Find-Element 'Screenshot was not captured' }
  Add-Scenario 'Control: Screenshot reports the capture result' ([bool]$shot) ''
  Click-Exact 'Copy question' | Out-Null
  Start-Sleep -Milliseconds 300
  $copied = ''
  try { $copied = [System.Windows.Forms.Clipboard]::GetText() } catch { $copied = '' }
  Add-Scenario 'Control: Copy question copies the question text' ($copied -match 'index|caching') $copied
  Click-Exact 'Expand transcript' | Out-Null
  $tx = Wait-Named 'Collapse transcript' 3
  Add-Scenario 'Control: Expand transcript opens the transcript' ([bool]$tx) ''
  if ($tx) { Click-Exact 'Collapse transcript' | Out-Null }
  Click-Exact 'Helpful' | Out-Null
  Start-Sleep -Milliseconds 200
  Add-Scenario 'Control: Helpful marks the answer' ((Get-Toggle (Find-Exact 'Helpful')) -eq 'On') ''
  Click-Exact 'Not helpful' | Out-Null
  Start-Sleep -Milliseconds 200
  Add-Scenario 'Control: Not helpful marks the answer' ((Get-Toggle (Find-Exact 'Not helpful')) -eq 'On') ''
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
  Add-Scenario 'Control: Back to sessions leaves without ending' ([bool]($returned -and (Find-Element 'Start') -and -not (Find-Exact 'End session'))) ''
  $startAgain = Find-Exact 'Start'
  if ($startAgain) { Click-Element $startAgain; Start-Sleep -Milliseconds 500 }
  Click-Exact 'End session' | Out-Null
  $endedChip = Wait-Named 'Ended' 8
  $endPosted = $false
  $endUntil = (Get-Date).AddSeconds(4)
  while ((Get-Date) -lt $endUntil -and -not $endPosted) {
    if ($env:SONORA_MOCK_LOG -and (Test-Path $env:SONORA_MOCK_LOG)) {
      $endPosted = [bool](Select-String -Path $env:SONORA_MOCK_LOG -Pattern 'PATCH /api/sessions/.+' -Quiet)
    }
    if (-not $endPosted) { Start-Sleep -Milliseconds 200 }
  }
  Add-Scenario 'Control: End stops the session and returns to the list' ([bool]($endedChip -and (Find-Element 'Call Sessions') -and -not (Find-Exact 'End session') -and $endPosted)) "saved=$endPosted"
  Save-Screen '05a-ended.png'
  Save-Screen '05-live.png'

  Click-Name 'Hide Sonora' | Out-Null
  Start-Sleep -Milliseconds 700
  $hidden = -not [SonoraInput]::IsWindowVisible($hwnd)
  Start-Sleep -Milliseconds 800
  $stayedHidden = -not [SonoraInput]::IsWindowVisible($hwnd)
  Add-Scenario 'Eye hides the Sonora window and it stays hidden' ($hidden -and $stayedHidden) "hidden=$hidden stayed=$stayedHidden"
  Save-Screen '05b-hidden.png'
  Start-Process -FilePath $Exe -ArgumentList '--force-renderer-accessibility' | Out-Null
  $shown = $false
  $showUntil = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $showUntil) {
    if ([SonoraInput]::IsWindowVisible($hwnd)) { $shown = $true; break }
    Start-Sleep -Milliseconds 300
  }
  Add-Scenario 'Opening Sonora again shows the hidden window' $shown ''
  Save-Screen '05c-shown.png'

  Stop-Sonora
  Start-Sleep -Seconds 1
  $again = Start-Sonora @('--force-renderer-accessibility')
  Start-Sleep -Seconds 4
  $hwnd2 = $again.hwnd
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
  if (Find-Exact 'Log out') {
    Click-Exact 'Log out' | Out-Null
    Add-Scenario 'Control: Log out returns to the sign-in screen' ([bool](Wait-Named 'You are signed out' 6)) ''
  } else {
    Add-Scenario 'Control: Log out returns to the sign-in screen' $false 'Log out missing after restart'
  }
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
