# Visual proof for the installed NSIS build and a static opacity reference.
# The mock at 127.0.0.1:4173 supplies the answers. No live Gemini or microphone.
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [string]$OutDir = 'generated-artifacts/visual-proof',
  [string]$ReferenceHtml = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
if (-not $ReferenceHtml) {
  $ReferenceHtml = Join-Path (Split-Path -Parent $PSCommandPath) 'reference-opacity.html'
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ProofInput {
  public const uint MOUSEEVENTF_MOVE = 0x0001;
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
  public const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int n);
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int cb);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
    public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra;
  }
  [StructLayout(LayoutKind.Explicit)] public struct INPUT {
    [FieldOffset(0)] public int type;
    [FieldOffset(8)] public MOUSEINPUT mi;
  }
  public static void Click(int x, int y) {
    int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77);
    int vw = Math.Max(1, GetSystemMetrics(78)), vh = Math.Max(1, GetSystemMetrics(79));
    int ax = (int)Math.Round((x - vx) * 65535.0 / Math.Max(1, vw - 1));
    int ay = (int)Math.Round((y - vy) * 65535.0 / Math.Max(1, vh - 1));
    INPUT[] inputs = new INPUT[3];
    inputs[0].type = 0; inputs[0].mi.dx = ax; inputs[0].mi.dy = ay; inputs[0].mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE;
    inputs[1].type = 0; inputs[1].mi.dx = ax; inputs[1].mi.dy = ay; inputs[1].mi.dwFlags = MOUSEEVENTF_LEFTDOWN | MOUSEEVENTF_ABSOLUTE;
    inputs[2].type = 0; inputs[2].mi.dx = ax; inputs[2].mi.dy = ay; inputs[2].mi.dwFlags = MOUSEEVENTF_LEFTUP | MOUSEEVENTF_ABSOLUTE;
    if (SendInput(3, inputs, Marshal.SizeOf(typeof(INPUT))) != 3) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  }
}
"@

function Save-Screen([string]$Name) {
  $path = Join-Path $OutDir $Name
  if ($script:UseComposedCapture) {
    try {
      Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:4181/shot' -OutFile $path -TimeoutSec 15
      Write-Host "screenshot $Name composed"
      return
    } catch {
      Write-Host "composed capture failed: $($_.Exception.Message)"
    }
  }
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Host "screenshot $Name"
}

function Show-BusyDesktop {
  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'Sonora proof background'
  $form.FormBorderStyle = 'None'
  $form.WindowState = 'Maximized'
  $form.TopMost = $false
  $form.ShowInTaskbar = $true
  $form.Add_Paint({
    param($sender, $event)
    $g = $event.Graphics
    $w = $sender.ClientSize.Width
    $h = $sender.ClientSize.Height
    $colors = @(
      [System.Drawing.Color]::FromArgb(255, 45, 45),
      [System.Drawing.Color]::FromArgb(255, 225, 74),
      [System.Drawing.Color]::FromArgb(45, 107, 255),
      [System.Drawing.Color]::FromArgb(25, 195, 125),
      [System.Drawing.Color]::FromArgb(255, 122, 24),
      [System.Drawing.Color]::FromArgb(122, 60, 255)
    )
    $band = [Math]::Max(1, [int]($w / $colors.Count))
    for ($i = 0; $i -lt $colors.Count; $i++) {
      $brush = New-Object System.Drawing.SolidBrush $colors[$i]
      $g.FillRectangle($brush, ($i * $band), 0, $band + 2, $h)
      $brush.Dispose()
    }
    $font = New-Object System.Drawing.Font('Segoe UI', 22, [System.Drawing.FontStyle]::Bold)
    $dark = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::Black)
    $light = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    for ($y = 20; $y -lt $h; $y += 46) {
      $g.DrawString('HIGH CONTRAST 111111 YELLOW BAND', $font, $dark, 12, $y)
      $g.DrawString('WHITE ON BLUE 222222 REFERENCE', $font, $light, 220, ($y + 4))
    }
    $font.Dispose(); $dark.Dispose(); $light.Dispose()
  })
  $form.Show()
  $form.Activate()
  return $form
}

function Get-SonoraRoot {
  $ids = @(Get-Process | Where-Object { $_.ProcessName -like 'Sonora*' } | Select-Object -ExpandProperty Id)
  $best = $null
  $bestCount = -1
  foreach ($procId in $ids) {
    $cond = New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$procId)
    $wins = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
    for ($i = 0; $i -lt $wins.Count; $i++) {
      $desc = $wins.Item($i).FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
      if ($desc.Count -gt $bestCount) { $bestCount = $desc.Count; $best = $wins.Item($i) }
    }
  }
  return $best
}

function Find-AllNamed([string]$Name) {
  $root = Get-SonoraRoot
  $items = @()
  if (-not $root) { return $items }
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  for ($i = 0; $i -lt $all.Count; $i++) {
    $n = $all.Item($i).Current.Name
    if ($n -and ($n -eq $Name -or $n.StartsWith("$Name ") -or $n.Contains($Name))) { $items += $all.Item($i) }
  }
  return $items
}

function Find-Named([string]$Name) {
  $items = @(Find-AllNamed $Name)
  if ($items.Count -eq 0) { return $null }
  return $items[0]
}

function Find-StartButton {
  $root = Get-SonoraRoot
  if (-not $root) { return $null }
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  for ($i = 0; $i -lt $all.Count; $i++) {
    $item = $all.Item($i)
    if ($item.Current.Name -ne 'Start') { continue }
    if ($item.Current.ControlType.ProgrammaticName -notmatch 'Button') { continue }
    $rect = $item.Current.BoundingRectangle
    if ($rect.Width -ge 8 -and $rect.Height -ge 8 -and -not $item.Current.IsOffscreen) { return $item }
  }
  return $null
}

function Write-SonoraNames {
  $root = Get-SonoraRoot
  if (-not $root) { Write-Host 'UI: no Sonora window'; return }
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $names = @()
  for ($i = 0; $i -lt [Math]::Min(30, $all.Count); $i++) {
    $n = $all.Item($i).Current.Name
    if ($n) { $names += $n }
  }
  Write-Host ("UI: " + ($names -join ' | '))
}

function Find-Exact([string]$Name) {
  $root = Get-SonoraRoot
  if (-not $root) { return $null }
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  for ($i = 0; $i -lt $all.Count; $i++) {
    if ($all.Item($i).Current.Name -eq $Name) { return $all.Item($i) }
  }
  return $null
}

function Wait-Exact([string]$Name, [int]$Seconds = 8) {
  $until = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $until) {
    $found = Find-Exact $Name
    if ($found) { return $found }
    Start-Sleep -Milliseconds 250
  }
  return $null
}

function Wait-Named([string]$Name, [int]$Seconds = 8) {
  $until = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $until) {
    $found = Find-Named $Name
    if ($found) { return $found }
    Start-Sleep -Milliseconds 250
  }
  return $null
}

function Click-Ui($el) {
  if (-not $el) { throw 'Missing UI element' }
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  $scroll = $null
  if ($el.TryGetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern, [ref]$scroll)) {
    $scroll.ScrollIntoView()
  }
  $ErrorActionPreference = $prev
  Start-Sleep -Milliseconds 150
  $r = $el.Current.BoundingRectangle
  if ($r.Width -lt 1) { throw "No box for $($el.Current.Name)" }
  [ProofInput]::Click([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2))
  Start-Sleep -Milliseconds 400
}

function Find-Slider([string]$Name) {
  $root = Get-SonoraRoot
  if (-not $root) { return $null }
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  for ($i = 0; $i -lt $all.Count; $i++) {
    $item = $all.Item($i)
    if ($item.Current.Name -ne $Name) { continue }
    if ($item.Current.ControlType.ProgrammaticName -match 'Slider') { return $item }
  }
  return $null
}

function Set-Opacity([int]$Percent) {
  $slider = Find-Slider 'Overlay opacity'
  if (-not $slider) { throw 'Overlay opacity slider missing' }
  $r = $slider.Current.BoundingRectangle
  $ratio = ($Percent - 15) / 80.0
  $x = [int]($r.X + 4 + (($r.Width - 8) * $ratio))
  $y = [int]($r.Y + $r.Height / 2)
  [ProofInput]::Click($x, $y)
  Start-Sleep -Milliseconds 400
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  $pattern = $null
  if (-not $slider.TryGetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern, [ref]$pattern)) {
    $ErrorActionPreference = $prev
    return $Percent
  }
  $value = [double]$pattern.Current.Value
  if ([math]::Abs($value - $Percent) -gt 7) {
    $pattern.SetValue($Percent)
    Start-Sleep -Milliseconds 300
    $value = [double]$pattern.Current.Value
  }
  $ErrorActionPreference = $prev
  return $value
}

function Ask-Proof([string]$Question, [string]$Expect) {
  $box = $null
  $until = (Get-Date).AddSeconds(4)
  while ((Get-Date) -lt $until -and -not $box) {
    $candidate = Find-Exact 'Question'
    if ($candidate -and $candidate.Current.ControlType.ProgrammaticName -match 'Edit') { $box = $candidate }
    else { Start-Sleep -Milliseconds 200 }
  }
  if (-not $box) {
    $chat = Find-Exact 'Chat'
    if ($chat) { Click-Ui $chat }
    $box = Find-Exact 'Question'
  }
  if (-not $box -or $box.Current.ControlType.ProgrammaticName -notmatch 'Edit') { throw 'Question box missing' }
  Click-Ui $box
  [System.Windows.Forms.SendKeys]::SendWait('^a' + $Question)
  Start-Sleep -Milliseconds 700
  Click-Ui (Find-Exact 'Answer')
  $metric = Wait-Named $Expect 25
  if (-not $metric) { Write-SonoraNames; throw "Did not see $Expect" }
  return $metric.Current.Name
}

$busy = $null
$sonora = $null
$edge = $null
try {
  $busy = Show-BusyDesktop
  Start-Sleep -Milliseconds 600
  Save-Screen 'background-only.png'

  $edgePath = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
  if (-not (Test-Path $edgePath)) { $edgePath = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe" }
  # Edge --app refuses file:// and opens a blank tab. Serve the page over HTTP so the query selects 15/45/95.
  $serverJs = Join-Path $env:TEMP 'sonora-reference-server.js'
  @(
    "const http = require('http');"
    "const fs = require('fs');"
    "const file = process.argv[2];"
    "http.createServer((req, res) => {"
    "  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });"
    "  res.end(fs.readFileSync(file));"
    "}).listen(4179, '127.0.0.1');"
  ) | Set-Content -Path $serverJs -Encoding ascii
  $htmlPath = (Resolve-Path $ReferenceHtml).Path
  Start-Process -FilePath node -ArgumentList @($serverJs, $htmlPath) -WindowStyle Hidden
  $ready = $false
  foreach ($i in 1..20) {
    try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4179/ -TimeoutSec 2 | Out-Null; $ready = $true; break } catch { Start-Sleep -Milliseconds 200 }
  }
  if (-not $ready) { throw 'Reference page server did not start' }
  foreach ($percent in @(15, 45, 95)) {
    Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 400
    $profile = Join-Path $env:TEMP "sonora-edge-profile-$percent"
    $edge = Start-Process -FilePath $edgePath -ArgumentList @(
      "--user-data-dir=$profile", '--no-first-run', '--no-default-browser-check', '--disable-sync',
      "--app=http://127.0.0.1:4179/?opacity=$percent", '--window-size=900,760', '--window-position=140,40'
    ) -PassThru
    $title = ''
    $until = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $until) {
      $proc = Get-Process msedge -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -match 'Reference opacity' } | Select-Object -First 1
      if ($proc) { $title = $proc.MainWindowTitle; break }
      Start-Sleep -Milliseconds 300
    }
    if (-not $title) {
      Save-Screen ("reference-failed-{0}.png" -f $percent)
      throw "Reference page did not open for $percent. Last edge titles: $((Get-Process msedge -ErrorAction SilentlyContinue | Select-Object -ExpandProperty MainWindowTitle) -join ' | ')"
    }
    Start-Sleep -Milliseconds 1500
    Save-Screen ("reference-opacity-{0}.png" -f $percent)
  }
  if ($edge) { Stop-Process -Id $edge.Id -Force -ErrorAction SilentlyContinue }
  Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

  Get-Process | Where-Object { $_.ProcessName -like 'Sonora*' } | Stop-Process -Force -ErrorAction SilentlyContinue
  $prefs = '{"backgroundOpacity":0.45,"opacityVersion":3,"clickThrough":false,"bounds":{"x":180,"y":40,"width":820,"height":760}}'
  foreach ($root in @($env:APPDATA, $env:LOCALAPPDATA)) {
    foreach ($name in @('Sonora AI', 'sonora-ai', 'Sonora', 'sonora')) {
      $dir = Join-Path $root $name
      New-Item -ItemType Directory -Force -Path $dir | Out-Null
      Set-Content -Path (Join-Path $dir 'window-preferences.json') -Value $prefs -Encoding utf8
    }
  }
  $sonora = Start-Process -FilePath $Exe -ArgumentList @('--force-renderer-accessibility', '--visual-proof') -PassThru
  if (-not (Wait-Named 'Sign in' 25)) { throw 'Sign in did not appear' }
  $sonoraWindow = (Get-Process -Id $sonora.Id).MainWindowHandle
  if ($sonoraWindow -ne [IntPtr]::Zero) { [ProofInput]::SetForegroundWindow($sonoraWindow) | Out-Null }
  Click-Ui (Find-Named 'Sign in')
  if (-not (Wait-Named 'Create session' 10)) { throw 'Session list did not appear' }
  Click-Ui (Find-Named 'Create session')
  $company = Wait-Named 'Company' 6
  Click-Ui $company
  [System.Windows.Forms.SendKeys]::SendWait('Northwind')
  Start-Sleep -Milliseconds 200
  $createButtons = @(Find-AllNamed 'Create session')
  if ($createButtons.Count -eq 0) { throw 'Create session missing' }
  Click-Ui $createButtons[$createButtons.Count - 1]
  $start = $null
  $startUntil = (Get-Date).AddSeconds(12)
  while ((Get-Date) -lt $startUntil -and -not $start) {
    $start = Find-StartButton
    if (-not $start) { Start-Sleep -Milliseconds 250 }
  }
  if (-not $start) { Write-SonoraNames; throw 'Start missing' }
  $sonoraRoot = Get-SonoraRoot
  if ($sonoraRoot) {
    $handle = [IntPtr]$sonoraRoot.Current.NativeWindowHandle
    if ($handle -ne [IntPtr]::Zero) { [ProofInput]::SetForegroundWindow($handle) | Out-Null }
  }
  Click-Ui $start
  if (-not (Wait-Named 'End session' 8)) {
    $again = Find-StartButton
    if ($again) {
      $invoke = $null
      if ($again.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) { $invoke.Invoke() }
      else { Click-Ui $again }
    }
  }
  if (-not (Wait-Named 'End session' 8)) { Write-SonoraNames; throw 'Live overlay did not open' }
  $script:UseComposedCapture = $true

  $opacityReadings = @{}
  foreach ($percent in @(15, 45, 95)) {
    $opacityReadings[$percent] = Set-Opacity $percent
    Start-Sleep -Milliseconds 400
    Save-Screen ("sonora-opacity-{0}.png" -f $percent)
  }
  [void](Set-Opacity 45)

  $measurements = @()
  foreach ($pair in @(
    @{ q = 'sixty words'; expect = 'of 60'; words = 60; file = 'sonora-answer-60.png' },
    @{ q = 'two hundred words'; expect = 'of 200'; words = 200; file = 'sonora-answer-200.png' },
    @{ q = 'six hundred words'; expect = 'of 600'; words = 600; file = 'sonora-answer-600.png' }
  )) {
    $label = Ask-Proof $pair.q $pair.expect
    Save-Screen $pair.file
    $pane = Find-Named 'Answer scrollable'
    if (-not $pane) { $pane = Find-Named 'Answer end visible' }
    $height = 0
    if ($pane) { $height = [int]$pane.Current.BoundingRectangle.Height }
    $visible = 0
    $total = 0
    if ($label -match 'height=(\d+)px visible=(\d+) of (\d+)') {
      $measurements += [ordered]@{
        words = [int]$Matches[3]
        paneClientHeight = [int]$Matches[1]
        visibleWithoutScrolling = [int]$Matches[2]
        uiaPaneHeight = $height
        file = $pair.file
      }
    } else {
      throw "Could not parse metrics from $label"
    }
  }
  $report = [ordered]@{
    mocked = 'Answers come from the local mock at 127.0.0.1:4173, not Gemini. No microphone or Speechmatics stream was used.'
    opacity = $opacityReadings
    defaultOverlay = 'The installed window uses its saved default size, about 820 by 760, which the shell clamps to the work area.'
    answers = $measurements
  }
  $report | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $OutDir 'measurements.json') -Encoding utf8
  Write-Host ($report | ConvertTo-Json -Depth 5)
}
finally {
  if ($sonora) { Stop-Process -Id $sonora.Id -Force -ErrorAction SilentlyContinue }
  Get-Process | Where-Object { $_.ProcessName -like 'Sonora*' -or $_.ProcessName -eq 'msedge' } | Stop-Process -Force -ErrorAction SilentlyContinue
  if ($busy) { $busy.Close() }
}
