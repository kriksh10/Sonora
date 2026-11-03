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
$clickFile = Join-Path $OutDir 'catcher-clicks.txt'
$shotDir = $OutDir
if (Test-Path $clickFile) { Remove-Item $clickFile -Force }
Set-Content -Path $clickFile -Value '' -Encoding utf8

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
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
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
}
"@

function Save-Screen([string]$Name) {
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
  $path = Join-Path $shotDir $Name
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Host "screenshot $path"
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
function Get-SonoraAutomation {
  $procId = (Get-Process | Where-Object { $_.ProcessName -like 'Sonora*' } | Select-Object -First 1).Id
  if (-not $procId) { return $null }
  $cond = New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $procId)
  return [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
}
function Add-Scenario([string]$Name, [bool]$Pass, [string]$Detail) {
  $script:scenarios.Add([ordered]@{ name = $Name; pass = $Pass; detail = $Detail }) | Out-Null
  if ($Pass) { Write-Host "PASS $Name" } else { Write-Host "FAIL $Name $Detail" }
}

function Get-SonoraWindow([int]$ProcessId) {
  $found = $null
  Get-Process -Id $ProcessId -ErrorAction SilentlyContinue | Out-Null
  $handles = [System.Diagnostics.Process]::GetProcessById($ProcessId).MainWindowHandle
  if ($handles -ne [IntPtr]::Zero -and [SonoraInput]::IsWindowVisible($handles)) { return $handles }
  $procs = Get-Process | Where-Object { $_.ProcessName -like 'Sonora*' -and $_.MainWindowHandle -ne [IntPtr]::Zero }
  foreach ($proc in $procs) {
    if ([SonoraInput]::IsWindowVisible($proc.MainWindowHandle)) { return $proc.MainWindowHandle }
  }
  return [IntPtr]::Zero
}

function Click-Count { return @(Get-Content $clickFile | Where-Object { $_ -match '^click ' }).Count }
function Invoke-ClickProbe([string]$Label, [IntPtr]$Window) {
  $rect = New-Object SonoraInput+RECT
  [SonoraInput]::GetWindowRect($Window, [ref]$rect) | Out-Null
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  Write-Host "$Label hwnd=$Window rect=$($rect.Left),$($rect.Top) ${width}x${height}"
  $outsideX = [Math]::Max(8, $rect.Left - 30)
  $outsideY = [Math]::Min([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height - 20, $rect.Bottom + 40)
  if ($outsideY -le $rect.Bottom -and $outsideY -ge $rect.Top) { $outsideY = [Math]::Max(8, $rect.Top - 20) }
  $beforeCal = Click-Count
  [SonoraInput]::Click($outsideX, $outsideY)
  Start-Sleep -Milliseconds 400
  $cal = (Click-Count) - $beforeCal
  Write-Host "$Label calibration clicks=$cal at $outsideX,$outsideY"
  $points = @(
    @{ x = [int](($rect.Left + $rect.Right) / 2); y = [int](($rect.Top + $rect.Bottom) / 2) },
    @{ x = $rect.Left + 70; y = $rect.Top + 70 },
    @{ x = $rect.Right - 70; y = $rect.Top + 80 },
    @{ x = $rect.Left + 90; y = $rect.Bottom - 70 },
    @{ x = $rect.Right - 90; y = $rect.Bottom - 80 }
  )
  $before = Click-Count
  foreach ($point in $points) {
    [SonoraInput]::Click($point.x, $point.y)
    Start-Sleep -Milliseconds 250
  }
  Start-Sleep -Milliseconds 500
  $inside = (Click-Count) - $before
  $fg = [SonoraInput]::GetForegroundWindow()
  $fgPid = 0
  [SonoraInput]::GetWindowThreadProcessId($fg, [ref]$fgPid) | Out-Null
  $fgName = ''
  try { $fgName = (Get-Process -Id $fgPid -ErrorAction Stop).ProcessName } catch { $fgName = "pid $fgPid" }
  return [ordered]@{ label = $Label; calibration = $cal; inside = $inside; foreground = $fgName; width = $width; height = $height }
}

try {
  if (-not (Test-Path $Exe)) { throw "Installed executable not found: $Exe" }
  $prefDir = Join-Path $env:APPDATA 'Sonora AI'
  New-Item -ItemType Directory -Force -Path $prefDir | Out-Null
  Set-Content -Path (Join-Path $prefDir 'window-preferences.json') -Value '{"backgroundOpacity":0.15,"opacityVersion":2,"clickThrough":false}' -Encoding utf8
  $proc = Start-Process -FilePath $Exe -ArgumentList '--force-renderer-accessibility' -PassThru
  $hwnd = [IntPtr]::Zero
  $deadline = (Get-Date).AddSeconds(90)
  while ((Get-Date) -lt $deadline) {
    $hwnd = Get-SonoraWindow $proc.Id
    if ($hwnd -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 400
  }
  if ($hwnd -eq [IntPtr]::Zero) { throw 'Sonora window did not appear.' }
  Start-Sleep -Seconds 8
  try {
    $uiRoot = Get-SonoraAutomation
    if ($uiRoot) {
      $all = $uiRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
      $names = @()
      for ($i = 0; $i -lt [Math]::Min(25, $all.Count); $i++) {
        $n = $all.Item($i).Current.Name
        if ($n) { $names += $n }
      }
      Write-Host ("UI names: " + ($names -join ' | '))
    }
  } catch { Write-Host "UI dump failed: $_" }
  Save-Screen '00-before-click.png'
  $probe = Invoke-ClickProbe 'default' $hwnd
  Save-Screen '01-after-os-clicks.png'
  Write-Host ("probe " + ($probe | ConvertTo-Json -Compress))
  $passedThrough = $probe.inside -gt 0
  if (-not $passedThrough -and -not $Full) {
    Get-Process -Name 'Sonora*' -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 1
    $proc2 = Start-Process -FilePath $Exe -ArgumentList '--disable-gpu','--force-renderer-accessibility' -PassThru
    $hwnd2 = [IntPtr]::Zero
    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline) {
      $hwnd2 = Get-SonoraWindow $proc2.Id
      if ($hwnd2 -ne [IntPtr]::Zero) { break }
      Start-Sleep -Milliseconds 400
    }
    if ($hwnd2 -ne [IntPtr]::Zero) {
      Start-Sleep -Seconds 6
      $probe2 = Invoke-ClickProbe 'disable-gpu' $hwnd2
      Save-Screen '01b-disable-gpu.png'
      Write-Host ("probe " + ($probe2 | ConvertTo-Json -Compress))
      if ($probe2.inside -gt 0) { $passedThrough = $true; $probe = $probe2 }
    }
  }
  $detail = "inside=$($probe.inside) calibration=$($probe.calibration) foreground=$($probe.foreground) mode=$($probe.label) window=$($probe.width)x$($probe.height)"
  if ($probe.calibration -lt 1) { Add-Scenario 'OS clicks on the installed window do not reach the app behind' $false "SendInput missed the catcher. $detail" }
  else { Add-Scenario 'OS clicks on the installed window do not reach the app behind' (-not $passedThrough) $detail }

  if (-not $Full) {
    if ($passedThrough) { throw "Reproduced: real OS clicks passed through the installed window. $detail" }
    if ($probe.calibration -lt 1) { throw "SendInput did not reach the catcher, so this run does not prove click handling. $detail" }
    return
  }
  if ($passedThrough -or $probe.calibration -lt 1) { throw "Glass is still click-through or the click probe is invalid. $detail" }

  function Find-All([string]$Name) {
    $root = Get-SonoraAutomation
    if (-not $root) { return @() }
    $cond = New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::NameProperty, $Name)
    $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
    $items = @()
    for ($i = 0; $i -lt $all.Count; $i++) { $items += $all.Item($i) }
    return $items
  }
  function Find-Element([string]$Name) {
    $items = @(Find-All $Name)
    if ($items.Count -eq 0) { return $null }
    return $items[0]
  }
  function Click-Element($el) {
    if (-not $el) { throw 'No UI element to click' }
    $r = $el.Current.BoundingRectangle
    if ($r.Width -lt 1 -or $r.Height -lt 1) { throw 'Element has no on-screen box' }
    [SonoraInput]::Click([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2))
    Start-Sleep -Milliseconds 400
  }
  function Click-Name([string]$Name, [switch]$Last) {
    $items = @(Find-All $Name)
    if ($items.Count -eq 0) { throw "No UI element named $Name" }
    $el = if ($Last) { $items[$items.Count - 1] } else { $items[0] }
    Click-Element $el
    return $el
  }

  $signIn = $null
  $waitUntil = (Get-Date).AddSeconds(25)
  while ((Get-Date) -lt $waitUntil -and -not $signIn) {
    $signIn = Find-Element 'Sign in'
    if (-not $signIn) { Start-Sleep -Milliseconds 500 }
  }
  if (-not $signIn) {
    $root = Get-SonoraAutomation
    $names = @()
    if ($root) {
      $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
      for ($i = 0; $i -lt [Math]::Min(40, $all.Count); $i++) { if ($all.Item($i).Current.Name) { $names += $all.Item($i).Current.Name } }
    }
    Add-Scenario 'Sign in with an OS click' $false ("UI: " + ($names -join ' | '))
    throw "Installed window has no Sign in control. UI: $($names -join ' | ')"
  }
  if (Find-Element 'Hide from screen sharing (best effort)') { Click-Name 'Hide from screen sharing (best effort)' | Out-Null }
  Click-Element $signIn
  Start-Sleep -Milliseconds 500
  $signed = Find-Element 'Call Sessions'
  Add-Scenario 'Sign in with an OS click' ([bool]$signed) ''
  Save-Screen '02-signed-in.png'

  $names = @('Create session','Resumes','Documents','Call Sessions','Mock Interview','Dark','Light','Upgrade')
  $missing = @()
  foreach ($name in $names) {
    if (-not (Find-Element $name)) { $missing += $name }
    else { Click-Name $name | Out-Null }
  }
  Add-Scenario 'Every home and sidebar control receives an OS click' ($missing.Count -eq 0) ($(if ($missing) { "missing $($missing -join ', ')" } else { 'all clicked' }))

  Click-Name 'Create session' | Out-Null
  Start-Sleep -Milliseconds 300
  Click-Name 'Cancel' | Out-Null
  $dialogGone = -not (Find-Element 'Company')
  Add-Scenario 'Create Session cancel' $dialogGone ''
  Click-Name 'Create session' | Out-Null
  $company = Find-Element 'Company'
  if (-not $company) { Add-Scenario 'Create Session valid input' $false 'company field missing' }
  else {
    $company.SetFocus()
    [System.Windows.Forms.SendKeys]::SendWait('Northwind')
    Click-Name 'Create session' -Last | Out-Null
    Start-Sleep -Milliseconds 400
    Add-Scenario 'Create Session valid input' ([bool](Find-Element 'Northwind interview')) ''
  }
  Save-Screen '03-session.png'

  function Set-Slider([double]$Ratio) {
    $el = Find-Element 'Overlay opacity'
    if (-not $el) { throw 'Overlay opacity slider missing' }
    $r = $el.Current.BoundingRectangle
    $x = [int]($r.X + [Math]::Max(4, ($r.Width - 8) * $Ratio))
    $y = [int]($r.Y + $r.Height / 2)
    [SonoraInput]::Click($x, $y)
    Start-Sleep -Milliseconds 300
  }
  function Click-Panel {
    $el = Find-Element 'Call Sessions'
    if (-not $el) { $el = Find-Element 'Sign in' }
    if (-not $el) { throw 'No panel to click' }
    $r = $el.Current.BoundingRectangle
    [SonoraInput]::Click([int]($r.X + 30), [int]($r.Y + $r.Height / 2))
    Start-Sleep -Milliseconds 250
  }

  foreach ($pin in @($true, $false)) {
    $keep = Find-Element 'Keep on top'
    if (-not $keep) { throw 'Keep on top missing' }
    $pressed = $keep.Current.Name
    # Toggle by clicking until the desired pin state is reflected by the button's help text is not available.
    # The button name stays "Keep on top"; aria-pressed is the toggle state.
    $pattern = $keep.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
    $want = $(if ($pin) { [System.Windows.Automation.ToggleState]::On } else { [System.Windows.Automation.ToggleState]::Off })
    if ($pattern.Current.ToggleState -ne $want) { Click-Name 'Keep on top' | Out-Null; Start-Sleep -Milliseconds 200 }
    foreach ($focus in @($true, $false)) {
      if ($focus) { [SonoraInput]::SetForegroundWindow($hwnd) | Out-Null }
      else {
        $catcherHwnd = (Get-Process -Id $catcher.Id -ErrorAction SilentlyContinue).MainWindowHandle
        if ($catcherHwnd -and $catcherHwnd -ne [IntPtr]::Zero) { [SonoraInput]::SetForegroundWindow($catcherHwnd) | Out-Null }
      }
      Start-Sleep -Milliseconds 200
      foreach ($ratio in @(0.0, 0.5, 1.0)) {
        $before = (Get-Content $clickFile | Where-Object { $_ -match '^click ' }).Count
        Set-Slider $ratio
        Click-Panel
        $after = (Get-Content $clickFile | Where-Object { $_ -match '^click ' }).Count
        $fg2 = [SonoraInput]::GetForegroundWindow()
        $fg2Pid = 0
        [SonoraInput]::GetWindowThreadProcessId($fg2, [ref]$fg2Pid) | Out-Null
        $fg2Name = (Get-Process -Id $fg2Pid -ErrorAction SilentlyContinue).ProcessName
        $label = "slider $([int]($ratio * 100)) $(if ($focus) {'focused'} else {'unfocused'}) $(if ($pin) {'pinned'} else {'unpinned'})"
        $ok = ($after -eq $before) -and ($fg2Name -like 'Sonora*')
        Add-Scenario $label $ok "pass-through=$($after - $before) foreground=$fg2Name"
      }
    }
  }
  Save-Screen '04-slider-matrix.png'

  if (Find-Element 'Start') { Click-Name 'Start' | Out-Null; Start-Sleep -Milliseconds 400 }
  Click-Name 'Listen' | Out-Null
  Start-Sleep -Milliseconds 400
  Click-Name 'Answer Ctrl+Enter' | Out-Null
  Start-Sleep -Milliseconds 800
  $heard = Find-Element 'Heard: How does caching work?'
  Add-Scenario 'Live session mocked transcript produces an answer' ([bool]$heard) ''
  foreach ($name in @('Screenshot Ctrl+Shift+Enter','Chat','Previous answer','Next answer','Clear','End')) {
    if (Find-Element $name) { Click-Name $name | Out-Null } else { Add-Scenario "OS click $name" $false 'missing' }
  }
  Save-Screen '05-live.png'

  Get-Process -Name 'Sonora*' -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 1
  $again = Start-Process -FilePath $Exe -ArgumentList '--force-renderer-accessibility' -PassThru
  $hwnd2 = [IntPtr]::Zero
  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline) {
    $hwnd2 = Get-SonoraWindow $again.Id
    if ($hwnd2 -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 400
  }
  if ($hwnd2 -eq [IntPtr]::Zero) { Add-Scenario 'Restart still receives OS clicks' $false 'window did not return' }
  else {
    $rect2 = New-Object SonoraInput+RECT
    [SonoraInput]::GetWindowRect($hwnd2, [ref]$rect2) | Out-Null
    $before = (Get-Content $clickFile | Where-Object { $_ -match '^click ' }).Count
    [SonoraInput]::Click([int](($rect2.Left + $rect2.Right) / 2), [int](($rect2.Top + $rect2.Bottom) / 2))
    Start-Sleep -Milliseconds 400
    $after = (Get-Content $clickFile | Where-Object { $_ -match '^click ' }).Count
    Add-Scenario 'Restart still receives OS clicks' ($after -eq $before) "new pass-through=$($after - $before)"
    Save-Screen '06-restart.png'
  }
}
finally {
  $failed = @($scenarios | Where-Object { -not $_.pass })
  $payload = @{ scenarios = $scenarios; full = [bool]$Full; exe = $Exe } | ConvertTo-Json -Depth 5
  Set-Content -Path (Join-Path $OutDir 'results.json') -Value $payload -Encoding utf8
  if ($catcher -and -not $catcher.HasExited) { Stop-Process -Id $catcher.Id -Force -ErrorAction SilentlyContinue }
  Get-Process -Name 'Sonora*' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
if ($failed.Count -gt 0) { exit 1 }
exit 0
