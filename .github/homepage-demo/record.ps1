# Records the installed Sonora overlay against the local mock for the homepage hero.
# The mock supplies the transcript and the suggested answer. No microphone, Gemini, or Speechmatics.
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [string]$OutDir = 'generated-artifacts/homepage-demo',
  [string]$Ffmpeg = 'ffmpeg',
  [string]$Ffprobe = 'ffprobe'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DemoWin {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int cb);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int n);
  public static readonly IntPtr TopMost = new IntPtr(-1);
  public const uint SWP_SHOWWINDOW = 0x0040;
  public const uint MOUSEEVENTF_MOVE = 0x0001;
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
  public const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
    public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra;
  }
  [StructLayout(LayoutKind.Explicit)] public struct INPUT {
    [FieldOffset(0)] public int type;
    [FieldOffset(8)] public MOUSEINPUT mi;
  }
  public static void Click(int x, int y) { Drag(x, y, x, y, 1); }
  public static void Drag(int x1, int y1, int x2, int y2, int steps) {
    if (steps < 1) steps = 1;
    int ax, ay;
    Point(x1, y1, out ax, out ay);
    INPUT[] down = new INPUT[2];
    down[0].type = 0; down[0].mi.dx = ax; down[0].mi.dy = ay; down[0].mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE;
    down[1].type = 0; down[1].mi.dx = ax; down[1].mi.dy = ay; down[1].mi.dwFlags = MOUSEEVENTF_LEFTDOWN | MOUSEEVENTF_ABSOLUTE;
    if (SendInput(2, down, Marshal.SizeOf(typeof(INPUT))) != 2) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    for (int i = 1; i <= steps; i++) {
      int x = x1 + ((x2 - x1) * i / steps);
      int y = y1 + ((y2 - y1) * i / steps);
      Point(x, y, out ax, out ay);
      INPUT[] move = new INPUT[1];
      move[0].type = 0; move[0].mi.dx = ax; move[0].mi.dy = ay; move[0].mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE;
      if (SendInput(1, move, Marshal.SizeOf(typeof(INPUT))) != 1) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      System.Threading.Thread.Sleep(45);
    }
    Point(x2, y2, out ax, out ay);
    INPUT[] up = new INPUT[1];
    up[0].type = 0; up[0].mi.dx = ax; up[0].mi.dy = ay; up[0].mi.dwFlags = MOUSEEVENTF_LEFTUP | MOUSEEVENTF_ABSOLUTE;
    if (SendInput(1, up, Marshal.SizeOf(typeof(INPUT))) != 1) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  }
  static void Point(int x, int y, out int ax, out int ay) {
    int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77);
    int vw = Math.Max(1, GetSystemMetrics(78)), vh = Math.Max(1, GetSystemMetrics(79));
    ax = (int)Math.Round((x - vx) * 65535.0 / Math.Max(1, vw - 1));
    ay = (int)Math.Round((y - vy) * 65535.0 / Math.Max(1, vh - 1));
  }
}
public class DemoKeys {
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  public static void Chord(byte[] keys) {
    for (int i = 0; i < keys.Length; i++) keybd_event(keys[i], 0, 0, UIntPtr.Zero);
    for (int i = keys.Length - 1; i >= 0; i--) keybd_event(keys[i], 0, 2, UIntPtr.Zero);
  }
}
"@
[DemoWin]::SetProcessDPIAware() | Out-Null

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
$question = 'If the work runs one extra month, what budget should we set aside?'
$lines = @(
  'Client: Before we wrap, can we pin down the project timeline?',
  'Client: The steering group wants a date they can plan around.',
  $question.Replace('If the work', 'Client: If the work')
)
# The third line is the question the client asks. The chat box holds the same question without the speaker label.
$lines[2] = 'Client: If the work runs one extra month, what budget should we set aside?'

function Sleep-Pump([int]$Milliseconds) {
  $until = [DateTime]::UtcNow.AddMilliseconds($Milliseconds)
  while ([DateTime]::UtcNow -lt $until) {
    if ($global:backdrop -and -not $global:backdrop.IsDisposed) { $global:backdrop.Invalidate() }
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 30
  }
}

function Show-Backdrop([int]$X, [int]$Y, [int]$Width, [int]$Height) {
  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'Client sync'
  $form.FormBorderStyle = 'None'
  $form.StartPosition = 'Manual'
  $form.Location = New-Object System.Drawing.Point $X, $Y
  $form.Size = New-Object System.Drawing.Size $Width, $Height
  $form.BackColor = [System.Drawing.Color]::FromArgb(26, 29, 34)
  $form.TopMost = $false
  $form.ShowInTaskbar = $true
  $form.KeyPreview = $true
  $global:callClock = [Diagnostics.Stopwatch]::StartNew()
  $form.Add_Paint({
    param($sender, $event)
    $g = $event.Graphics
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $w = $sender.ClientSize.Width
    $h = $sender.ClientSize.Height
    $stage = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(26, 29, 34))
    $g.FillRectangle($stage, 0, 0, $w, $h)
    $stage.Dispose()
    $bar = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(44, 49, 58))
    $g.FillRectangle($bar, 0, 0, 420, 64)
    $g.FillRectangle($bar, 0, ($h - 84), 420, 84)
    $bar.Dispose()
    $tile = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(58, 64, 74))
    $g.FillRectangle($tile, 24, 88, 372, ($h - 196))
    $tile.Dispose()
    $avatar = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(92, 101, 115))
    $g.FillEllipse($avatar, 150, 250, 120, 120)
    $avatar.Dispose()
    $ink = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(230, 232, 238))
    $muted = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(183, 189, 199))
    $titleFont = New-Object System.Drawing.Font('Segoe UI', 18, [System.Drawing.FontStyle]::Bold)
    $labelFont = New-Object System.Drawing.Font('Segoe UI', 16, [System.Drawing.FontStyle]::Regular)
    $smallFont = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Regular)
    $g.DrawString('Client sync', $titleFont, $ink, 56, 16)
    $elapsed = if ($global:callClock) { [int]$global:callClock.Elapsed.TotalSeconds } else { 0 }
    $g.DrawString(('{0:00}:{1:00}' -f [int]($elapsed / 60), ($elapsed % 60)), $smallFont, $muted, 320, 22)
    $live = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(60, 154, 98))
    $g.FillEllipse($live, 24, 24, 16, 16)
    $live.Dispose()
    $g.DrawString('Client', $labelFont, $ink, 174, 390)
    $g.DrawString('Camera off', $smallFont, $muted, 156, 424)
    $dot = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(196, 202, 210))
    $g.FillEllipse($dot, 92, ($h - 62), 36, 36)
    $g.FillEllipse($dot, 176, ($h - 62), 36, 36)
    $dot.Dispose()
    $leave = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(176, 72, 64))
    $g.FillEllipse($leave, 260, ($h - 62), 36, 36)
    $leave.Dispose()
    $hint = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Regular)
    $g.DrawString('Mic', $hint, $muted, 98, ($h - 22))
    $g.DrawString('Camera', $hint, $muted, 168, ($h - 22))
    $g.DrawString('Leave', $hint, $muted, 258, ($h - 22))
    $titleFont.Dispose(); $labelFont.Dispose(); $smallFont.Dispose(); $hint.Dispose(); $ink.Dispose(); $muted.Dispose()
  })
  $global:backdrop = $form
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

function Get-SonoraHwnd {
  $root = Get-SonoraRoot
  if ($root) {
    $handle = [IntPtr]$root.Current.NativeWindowHandle
    if ($handle -ne [IntPtr]::Zero) { return $handle }
  }
  $proc = Get-Process | Where-Object { $_.ProcessName -like 'Sonora*' -and $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
  if ($proc) { return $proc.MainWindowHandle }
  return [IntPtr]::Zero
}

function Find-AllNamed([string]$Name) {
  $root = Get-SonoraRoot
  $items = @()
  if (-not $root) { return $items }
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  for ($i = 0; $i -lt $all.Count; $i++) {
    $n = $all.Item($i).Current.Name
    if ($n -and ($n -eq $Name -or $n.StartsWith("$Name") -or $n.Contains($Name))) { $items += $all.Item($i) }
  }
  return $items
}

function Find-Exact([string]$Name) {
  foreach ($el in @(Find-AllNamed $Name)) { if ($el.Current.Name -eq $Name) { return $el } }
  return $null
}

function Wait-Named([string]$Name, [int]$Seconds = 12) {
  $until = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $until) {
    $found = Find-Exact $Name
    if ($found) { return $found }
    Sleep-Pump 200
  }
  return $null
}

function Find-Button([string]$Name) {
  foreach ($el in @(Find-AllNamed $Name)) {
    if ($el.Current.Name -ne $Name) { continue }
    if ($el.Current.ControlType.ProgrammaticName -notmatch 'Button') { continue }
    $rect = $el.Current.BoundingRectangle
    if ($rect.Width -ge 8 -and $rect.Height -ge 8 -and -not $el.Current.IsOffscreen) { return $el }
  }
  return $null
}

function Write-UiNames([string]$Label) {
  $root = Get-SonoraRoot
  if (-not $root) { Write-Host "$Label UI: no Sonora window"; return }
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $names = @()
  for ($i = 0; $i -lt [Math]::Min(40, $all.Count); $i++) {
    $n = $all.Item($i).Current.Name
    if ($n) { $names += $n }
  }
  Write-Host "$Label UI: $($names -join ' | ')"
}

function Click-Ui($el) {
  if (-not $el) { throw 'Missing UI element' }
  try { $el.GetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern).ScrollIntoView() } catch {}
  Sleep-Pump 120
  $rect = $el.Current.BoundingRectangle
  if ($rect.Width -lt 1 -or $rect.Height -lt 1) { throw "No box for $($el.Current.Name)" }
  $x = [int]($rect.X + $rect.Width / 2)
  $y = [int]($rect.Y + $rect.Height / 2)
  [DemoWin]::Click($x, $y)
  Sleep-Pump 350
}

function Send-Chord([byte[]]$Keys) {
  [DemoKeys]::Chord($Keys)
  Sleep-Pump 400
}

function Move-Sonora([IntPtr]$Hwnd, [int]$X, [int]$Y, [int]$Width, [int]$Height) {
  if ($Hwnd -eq [IntPtr]::Zero) { throw 'Sonora window handle missing' }
  [DemoWin]::SetWindowPos($Hwnd, [DemoWin]::TopMost, $X, $Y, $Width, $Height, [DemoWin]::SWP_SHOWWINDOW) | Out-Null
  Sleep-Pump 300
  $rect = New-Object DemoWin+RECT
  [DemoWin]::GetWindowRect($Hwnd, [ref]$rect) | Out-Null
  Write-Host "Sonora window $($rect.Left),$($rect.Top) $($rect.Right - $rect.Left)x$($rect.Bottom - $rect.Top)"
  return $rect
}

function Save-Grab([string]$Name, [int]$X, [int]$Y, [int]$Width, [int]$Height) {
  $path = Join-Path $OutDir $Name
  & $Ffmpeg -y -f gdigrab -framerate 5 -draw_mouse 0 -offset_x $X -offset_y $Y -video_size "${Width}x${Height}" -i desktop -frames:v 1 $path
  if ($LASTEXITCODE -ne 0) { throw "gdigrab probe failed for $Name" }
  return $path
}

function Test-Bright([string]$Path, [int]$X, [int]$Y, [int]$Width, [int]$Height) {
  $bmp = [System.Drawing.Bitmap]::FromFile($Path)
  $bright = 0
  try {
    for ($py = [Math]::Max(0, $Y); $py -lt [Math]::Min($bmp.Height, $Y + $Height); $py += 8) {
      for ($px = [Math]::Max(0, $X); $px -lt [Math]::Min($bmp.Width, $X + $Width); $px += 8) {
        $color = $bmp.GetPixel($px, $py)
        if ($color.R -gt 175 -or $color.G -gt 175 -or $color.B -gt 190) { $bright++ }
      }
    }
  } finally { $bmp.Dispose() }
  Write-Host "bright pixels in $Path overlay scan: $bright"
  return $bright -gt 8
}

function Post-Json([string]$Url, [string]$Json) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($Json)
  $req = [Net.HttpWebRequest]::Create($Url)
  $req.Method = 'POST'
  $req.ContentType = 'application/json'
  $req.Timeout = 15000
  $req.Proxy = $null
  $stream = $req.GetRequestStream()
  $stream.Write($bytes, 0, $bytes.Length)
  $stream.Close()
  $resp = $req.GetResponse()
  $reader = New-Object IO.StreamReader($resp.GetResponseStream())
  $text = $reader.ReadToEnd()
  $reader.Close(); $resp.Close()
  Write-Host "POST $Url $text"
  return $text
}

function Start-Mock {
  $env:SONORA_DEMO_VIDEO = '1'
  $env:SONORA_MOCK_LOG = Join-Path (Get-Location) 'generated-artifacts/mock-requests.log'
  New-Item -ItemType Directory -Force -Path generated-artifacts | Out-Null
  $up = $false
  try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4173/api/e2e/health -TimeoutSec 3 | Out-Null; $up = $true } catch { $up = $false }
  if ($up) { Write-Host 'Mock already listening'; return }
  $outLog = Join-Path (Get-Location) 'generated-artifacts/mock.log'
  $errLog = Join-Path (Get-Location) 'generated-artifacts/mock.err'
  Start-Process -FilePath node -ArgumentList @('artifacts/sonora-ai/e2e/server.mjs', 'artifacts/sonora-ai/dist/public') -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden
  foreach ($i in 1..40) {
    try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4173/api/e2e/health -TimeoutSec 2 | Out-Null; $up = $true; break } catch { Start-Sleep -Milliseconds 300 }
  }
  if (-not $up) {
    Get-Content $outLog, $errLog -ErrorAction SilentlyContinue | Write-Host
    throw 'Mock server did not start'
  }
}

function Seed-WindowPreferences([int]$X, [int]$Y, [int]$Width, [int]$Height) {
  $payload = @{
    backgroundOpacity = 0.85
    opacityVersion = 3
    clickThrough = $false
    alwaysOnTop = $true
    bounds = @{ x = $X; y = $Y; width = $Width; height = $Height }
  } | ConvertTo-Json -Compress
  foreach ($root in @($env:APPDATA, $env:LOCALAPPDATA)) {
    foreach ($name in @('Sonora AI', 'sonora-desktop', 'sonora-ai', 'Sonora', 'sonora')) {
      $dir = Join-Path $root $name
      New-Item -ItemType Directory -Force -Path $dir | Out-Null
      Set-Content -Path (Join-Path $dir 'window-preferences.json') -Value $payload -Encoding utf8
    }
  }
}

function Start-FramePump([string]$Dir, [string]$StopFile) {
  $worker = {
    param($Dir, $StopFile)
    $index = 0
    while (-not (Test-Path $StopFile)) {
      $index++
      $out = Join-Path $Dir ('{0:D4}.png' -f $index)
      try {
        $req = [Net.HttpWebRequest]::Create('http://127.0.0.1:4181/window')
        $req.Timeout = 8000
        $req.Proxy = $null
        $resp = $req.GetResponse()
        if (-not (Test-Path (Join-Path $Dir 'place.txt'))) {
          $place = '{0} {1} {2} {3} {4}' -f $resp.Headers['X-Win-X'], $resp.Headers['X-Win-Y'], $resp.Headers['X-Win-W'], $resp.Headers['X-Win-H'], $resp.Headers['X-Center-Alpha']
          Set-Content -Path (Join-Path $Dir 'place.txt') -Value $place
        }
        $fs = [IO.File]::Create("$out.part")
        $resp.GetResponseStream().CopyTo($fs)
        $fs.Close(); $resp.Close()
        Move-Item "$out.part" $out -Force
      } catch {}
      Start-Sleep -Milliseconds 140
    }
  }
  return Start-Job -ScriptBlock $worker -ArgumentList $Dir, $StopFile
}

$grab = $null
$frameJob = $null
$stopFile = Join-Path $OutDir 'stop-capture.txt'
try {
  $screen = [System.Windows.Forms.Screen]::PrimaryScreen
  Write-Host "screen bounds $($screen.Bounds) work $($screen.WorkingArea)"
  $originX = [int]$screen.WorkingArea.X
  $originY = [int]$screen.WorkingArea.Y
  $capW = [Math]::Min(1280, [int]$screen.WorkingArea.Width)
  $capH = [Math]::Min(800, [int]$screen.WorkingArea.Height)
  $capW -= ($capW % 2)
  $capH -= ($capH % 2)
  if ($capW -lt 1100 -or $capH -lt 700) { throw "Capture area ${capW}x${capH} is too small for the hero" }
  $overlayW = [Math]::Min(820, $capW - 460)
  $overlayH = [Math]::Min(700, $capH - 56)
  $overlayX = $originX + $capW - $overlayW - 20
  $overlayY = $originY + 28
  $setupW = [Math]::Min(1040, $capW - 40)
  $setupH = [Math]::Min(720, $capH - 50)
  $setupX = $originX + 24
  $setupY = $originY + 24
  Write-Host "capture $originX,$originY ${capW}x${capH} overlay $overlayX,$overlayY ${overlayW}x${overlayH}"

  $script:backdrop = Show-Backdrop $originX $originY $capW $capH
  Sleep-Pump 400
  Start-Mock
  Seed-WindowPreferences $setupX $setupY $setupW $setupH

  if (-not (Test-Path $Exe)) { throw "Installed executable not found: $Exe" }
  $proc = Start-Process -FilePath $Exe -ArgumentList @('--force-renderer-accessibility', '--visual-proof', '--force-device-scale-factor=1') -PassThru
  $hwnd = [IntPtr]::Zero
  $deadline = (Get-Date).AddSeconds(90)
  while ((Get-Date) -lt $deadline) {
    $hwnd = Get-SonoraHwnd
    if ($hwnd -ne [IntPtr]::Zero -and (Wait-Named 'Sign in' 1)) { break }
    Sleep-Pump 300
  }
  if (-not (Find-Exact 'Sign in')) { Write-UiNames 'sign-in'; throw 'Sign in did not appear' }
  $hwnd = Get-SonoraHwnd
  Move-Sonora $hwnd $setupX $setupY $setupW $setupH | Out-Null
  Click-Ui (Find-Exact 'Sign in')
  if (-not (Wait-Named 'Call Sessions' 15)) { Write-UiNames 'sessions'; throw 'Sign-in did not open Call Sessions' }
  $seed = Post-Json 'http://127.0.0.1:4173/api/e2e/seed' '{"title":"Client sync","company":"","sessionType":"call","status":"ready"}'
  if (-not (Wait-Named 'Client sync' 10)) { Write-UiNames 'seed'; throw "Seeded session did not appear: $seed" }
  $start = $null
  $startUntil = (Get-Date).AddSeconds(8)
  while ((Get-Date) -lt $startUntil -and -not $start) {
    $start = Find-Button 'Start'
    if (-not $start) { Sleep-Pump 200 }
  }
  if (-not $start) { Write-UiNames 'start'; throw 'Start button missing' }
  Click-Ui $start
  if (-not (Wait-Named 'End session' 10)) {
    $again = Find-Button 'Start'
    if ($again) { Click-Ui $again }
  }
  if (-not (Wait-Named 'Answer' 10)) { Write-UiNames 'overlay'; throw 'Live overlay did not open' }
  $hwnd = Get-SonoraHwnd
  Move-Sonora $hwnd $overlayX $overlayY $overlayW $overlayH | Out-Null

  $chat = Find-Button 'Chat'
  if (-not $chat) { throw 'Chat button missing' }
  Click-Ui $chat
  $box = $null
  $boxUntil = (Get-Date).AddSeconds(6)
  while ((Get-Date) -lt $boxUntil -and -not $box) {
    foreach ($el in @(Find-AllNamed 'Question')) {
      if ($el.Current.Name -eq 'Question' -and $el.Current.ControlType.ProgrammaticName -match 'Edit') { $box = $el; break }
    }
    if (-not $box) { Sleep-Pump 200 }
  }
  if (-not $box) { Write-UiNames 'chat'; throw 'Question box missing' }
  Click-Ui $box
  try { $box.SetFocus() } catch { Write-Host 'question focus skipped' }
  [System.Windows.Forms.Clipboard]::SetText($question)
  Sleep-Pump 150
  [System.Windows.Forms.SendKeys]::SendWait('^a^v')
  Sleep-Pump 400
  $typed = ''
  try {
    $valuePattern = $box.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    $typed = [string]$valuePattern.Current.Value
  } catch { Write-Host "question value unread: $($_.Exception.Message)" }
  if ($typed -notmatch 'extra month') {
    Click-Ui $box
    [System.Windows.Forms.SendKeys]::SendWait('^a')
    Sleep-Pump 100
    [System.Windows.Forms.SendKeys]::SendWait($question)
    Sleep-Pump 500
  }
  Click-Ui (Find-Button 'Chat')
  Sleep-Pump 300
  $listen = Find-Button 'Listen'
  if (-not $listen) { throw 'Listen button missing' }
  Click-Ui $listen
  if (-not (Wait-Named 'Listening. Speechmatics is connected.' 8)) { Write-UiNames 'listen'; throw 'Listening did not start' }
  $expand = Find-Button 'Expand transcript'
  if ($expand) { Click-Ui $expand; Wait-Named 'Collapse transcript' 4 | Out-Null }
  $hwnd = Get-SonoraHwnd
  $placed = Move-Sonora $hwnd $overlayX $overlayY $overlayW $overlayH
  Sleep-Pump 500

  $probe = Save-Grab 'probe.png' $originX $originY $capW $capH
  $localX = [int]$placed.Left - $originX
  $localY = [int]$placed.Top - $originY
  $localW = [int]($placed.Right - $placed.Left)
  $localH = [int]($placed.Bottom - $placed.Top)
  $gdigrabSeesOverlay = Test-Bright $probe $localX $localY $localW $localH
  Write-Host "gdigrab sees overlay: $gdigrabSeesOverlay"
  Set-Content -Path (Join-Path $OutDir 'capture-mode.txt') -Value $(if ($gdigrabSeesOverlay) { 'gdigrab' } else { 'gdigrab-plus-window-composite' })

  $frameDir = Join-Path $OutDir 'frames'
  New-Item -ItemType Directory -Force -Path $frameDir | Out-Null
  if (-not $gdigrabSeesOverlay) { $frameJob = Start-FramePump $frameDir $stopFile }

  $grabPath = Join-Path $OutDir 'grab.mkv'
  $grabInfo = New-Object System.Diagnostics.ProcessStartInfo
  $grabInfo.FileName = $Ffmpeg
  $grabInfo.Arguments = "-y -f gdigrab -framerate 30 -draw_mouse 1 -offset_x $originX -offset_y $originY -video_size ${capW}x${capH} -i desktop -an -c:v libx264 -pix_fmt yuv420p -preset ultrafast `"$grabPath`""
  $grabInfo.UseShellExecute = $false
  $grabInfo.RedirectStandardInput = $true
  $grab = [Diagnostics.Process]::Start($grabInfo)
  $clock = [Diagnostics.Stopwatch]::StartNew()
  Sleep-Pump 700
  foreach ($line in $lines) {
    Post-Json 'http://127.0.0.1:4173/api/e2e/demo-line' (@{ text = $line } | ConvertTo-Json -Compress) | Out-Null
    if (-not (Wait-Named $line 6)) { Write-UiNames 'line'; throw "Transcript line did not appear: $line" }
    Sleep-Pump 900
  }
  Sleep-Pump 500
  $hwnd = Get-SonoraHwnd
  if ($hwnd -ne [IntPtr]::Zero) { [DemoWin]::SetForegroundWindow($hwnd) | Out-Null }
  Sleep-Pump 200
  Send-Chord ([byte[]](0x11, 0x0D))
  $answer = Wait-Named 'written split' 12
  if (-not $answer) {
    Send-Chord ([byte[]](0x11, 0x0D))
    $answer = Wait-Named 'written split' 8
  }
  if (-not $answer) { Write-UiNames 'answer'; throw 'Suggested answer did not appear after Ctrl+Enter' }
  if (@(Find-AllNamed 'Heard:').Count -gt 0) { throw 'Mock returned the generic Heard answer instead of the demo answer' }
  $posterAt = [Math]::Round($clock.Elapsed.TotalSeconds + 0.7, 2)
  Set-Content -Path (Join-Path $OutDir 'poster-at.txt') -Value $posterAt
  Write-Host "answer visible at $($clock.Elapsed.TotalSeconds)s poster $posterAt"
  Sleep-Pump 1600
  $slider = $null
  foreach ($el in @(Find-AllNamed 'Overlay opacity')) {
    if ($el.Current.ControlType.ProgrammaticName -match 'Slider') { $slider = $el; break }
  }
  if ($slider) {
    $rect = $slider.Current.BoundingRectangle
    $y = [int]($rect.Y + $rect.Height / 2)
    $from = [int]($rect.X + 8 + (($rect.Width - 16) * ((85 - 15) / 80.0)))
    $to = [int]($rect.X + 8 + (($rect.Width - 16) * ((45 - 15) / 80.0)))
    [DemoWin]::Drag($from, $y, $to, $y, 14)
    Sleep-Pump 400
  } else { Write-Host 'opacity slider not found; continuing' }
  $remain = 15200 - $clock.Elapsed.TotalMilliseconds
  if ($remain -gt 0) { Sleep-Pump ([int]$remain) }
  $durationHint = [Math]::Round($clock.Elapsed.TotalSeconds, 2)
  Write-Host "scripted duration ${durationHint}s"
  Set-Content -Path (Join-Path $OutDir 'duration-hint.txt') -Value $durationHint
} finally {
  if ($grab -and -not $grab.HasExited) {
    try { $grab.StandardInput.WriteLine('q'); $grab.StandardInput.Close() } catch {}
    if (-not $grab.WaitForExit(20000)) { try { $grab.Kill() } catch {} }
  }
  if ($frameJob) {
    Set-Content -Path $stopFile -Value 'stop'
    Wait-Job $frameJob -Timeout 15 | Out-Null
    Stop-Job $frameJob -ErrorAction SilentlyContinue
    Receive-Job $frameJob -ErrorAction SilentlyContinue | Out-String | Write-Host
  }
  Get-Process | Where-Object { $_.ProcessName -like 'Sonora*' } | Stop-Process -Force -ErrorAction SilentlyContinue
  if ($global:backdrop -and -not $global:backdrop.IsDisposed) { $global:backdrop.Close() }
}

if (-not (Test-Path (Join-Path $OutDir 'grab.mkv'))) { throw 'gdigrab did not write a recording' }
$mode = Get-Content (Join-Path $OutDir 'capture-mode.txt') -ErrorAction SilentlyContinue
$source = Join-Path $OutDir 'grab.mkv'
if ($mode -eq 'gdigrab-plus-window-composite') {
  $placePath = Join-Path $OutDir 'frames/place.txt'
  $frames = @(Get-ChildItem (Join-Path $OutDir 'frames') -Filter '*.png' | Sort-Object Name)
  if ($frames.Count -lt 8 -or -not (Test-Path $placePath)) { throw 'Window composite frames were not captured' }
  $place = (Get-Content $placePath).Split(' ')
  $fx = [int]$place[0] - $originX
  $fy = [int]$place[1] - $originY
  $fw = [int]$place[2]
  $fh = [int]$place[3]
  Write-Host "compositing $($frames.Count) window frames at $fx,$fy ${fw}x${fh} alpha=$($place[4])"
  $probeSeconds = (& $Ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 $source).Trim()
  $fps = [Math]::Max(1, [Math]::Round($frames.Count / [double]$probeSeconds, 3))
  $composite = Join-Path $OutDir 'composite.mkv'
  & $Ffmpeg -y -i $source -framerate $fps -i (Join-Path $OutDir 'frames/%04d.png') -filter_complex "[1:v]format=rgba,scale=${fw}:${fh}[fg];[0:v][fg]overlay=${fx}:${fy}:format=auto" -an -c:v libx264 -pix_fmt yuv420p -preset veryfast $composite
  if ($LASTEXITCODE -ne 0) { throw 'Composite encode failed' }
  $source = $composite
}

$posterAt = 8
if (Test-Path (Join-Path $OutDir 'poster-at.txt')) { $posterAt = [double](Get-Content (Join-Path $OutDir 'poster-at.txt')) }
$media = Join-Path $OutDir 'media'
New-Item -ItemType Directory -Force -Path $media | Out-Null
$mp4 = Join-Path $media 'homepage-demo.mp4'
$webm = Join-Path $media 'homepage-demo.webm'
$poster = Join-Path $media 'homepage-demo-poster.jpg'
& $Ffmpeg -y -i $source -an -c:v libx264 -profile:v high -pix_fmt yuv420p -movflags +faststart -crf 26 -preset slow $mp4
if ($LASTEXITCODE -ne 0) { throw 'H.264 encode failed' }
$mp4Size = (Get-Item $mp4).Length
if ($mp4Size -gt 4MB) {
  & $Ffmpeg -y -i $source -an -c:v libx264 -profile:v high -pix_fmt yuv420p -movflags +faststart -crf 32 -preset slow $mp4
  if ($LASTEXITCODE -ne 0) { throw 'H.264 recompress failed' }
}
& $Ffmpeg -y -i $mp4 -an -c:v libvpx-vp9 -pix_fmt yuv420p -b:v 0 -crf 38 -deadline good -cpu-used 2 $webm
if ($LASTEXITCODE -ne 0) { throw 'VP9 encode failed' }
$webmSize = (Get-Item $webm).Length
if ($webmSize -gt 4MB) {
  & $Ffmpeg -y -i $mp4 -an -c:v libvpx-vp9 -pix_fmt yuv420p -b:v 0 -crf 46 -deadline good -cpu-used 2 $webm
  if ($LASTEXITCODE -ne 0) { throw 'VP9 recompress failed' }
}
& $Ffmpeg -y -ss $posterAt -i $mp4 -frames:v 1 -q:v 2 $poster
if ($LASTEXITCODE -ne 0) { throw 'Poster frame failed' }
$duration = (& $Ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 $mp4).Trim()
Set-Content -Path (Join-Path $media 'homepage-demo-info.txt') -Value @(
  "duration=$duration",
  "mp4=$((Get-Item $mp4).Length)",
  "webm=$((Get-Item $webm).Length)",
  "poster=$((Get-Item $poster).Length)",
  "posterAt=$posterAt",
  "mode=$mode",
  'mocked=true'
)
Write-Host "encoded duration=$duration mp4=$((Get-Item $mp4).Length) webm=$((Get-Item $webm).Length)"
if ([double]$duration -lt 11 -or [double]$duration -gt 21) { throw "Recording duration $duration is outside 12-20 seconds" }
if ((Get-Item $mp4).Length -gt 4MB -or (Get-Item $webm).Length -gt 4MB) { throw 'Encoded video is over 4 MB' }
