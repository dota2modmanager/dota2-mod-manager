# Clicks and key presses into the Dota window, at coordinates inside it.
# Usage: input.ps1 click X Y | rclick X Y | hover X Y | key K | drag "X1,Y1,X2,Y2" [left|right]
# (drag holds the button and moves in small steps: the in-world inspect turns its camera that way)
param([string]$Op, [string]$A, [string]$B)
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System; using System.Runtime.InteropServices;
public struct RECT2 { public int Left, Top, Right, Bottom; }
public static class In {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT2 r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
}
"@
[In]::SetProcessDPIAware() | Out-Null
$p = Get-Process dota2 -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { Write-Output "no dota"; exit 1 }
[In]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 150
# never click, press or take a picture into another window: somebody may be using the computer
if ([In]::GetForegroundWindow() -ne $p.MainWindowHandle) { Write-Output "dota is not in front"; exit 3 }
$r = New-Object RECT2
[In]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
switch ($Op) {
  'click'  { [In]::SetCursorPos($r.Left + [int]$A, $r.Top + [int]$B) | Out-Null; Start-Sleep -Milliseconds 80; [In]::mouse_event(0x02,0,0,0,[IntPtr]::Zero); Start-Sleep -Milliseconds 60; [In]::mouse_event(0x04,0,0,0,[IntPtr]::Zero) }
  'rclick' { [In]::SetCursorPos($r.Left + [int]$A, $r.Top + [int]$B) | Out-Null; Start-Sleep -Milliseconds 80; [In]::mouse_event(0x08,0,0,0,[IntPtr]::Zero); Start-Sleep -Milliseconds 60; [In]::mouse_event(0x10,0,0,0,[IntPtr]::Zero) }
  'hover'  { [In]::SetCursorPos($r.Left + [int]$A, $r.Top + [int]$B) | Out-Null }
  'drag'   {
    $v = $A.Split(',') | ForEach-Object { [int]$_ }
    $down, $up = if ($B -eq 'right') { 0x08, 0x10 } else { 0x02, 0x04 }
    [In]::SetCursorPos($r.Left + $v[0], $r.Top + $v[1]) | Out-Null; Start-Sleep -Milliseconds 80
    [In]::mouse_event($down,0,0,0,[IntPtr]::Zero)
    for ($k = 1; $k -le 30; $k++) {
      [In]::SetCursorPos($r.Left + $v[0] + [int](($v[2] - $v[0]) * $k / 30), $r.Top + $v[1] + [int](($v[3] - $v[1]) * $k / 30)) | Out-Null
      Start-Sleep -Milliseconds 25
    }
    [In]::mouse_event($up,0,0,0,[IntPtr]::Zero)
  }
  'key'    {
    # games read scan codes: press and release by scan code (KEYEVENTF_SCANCODE 0x08, KEYUP 0x02)
    $codes = @{ q = 0x10; w = 0x11; e = 0x12; r = 0x13; t = 0x14; i = 0x17; a = 0x1E; s = 0x1F; d = 0x20; f = 0x21; g = 0x22; z = 0x2C; x = 0x2D; c = 0x2E; v = 0x2F; b = 0x30; space = 0x39; esc = 0x01; f1 = 0x3B }
    if (-not $codes.ContainsKey($A.ToLower())) { Write-Output "no scan code for $A"; exit 2 }
    $sc = [byte]$codes[$A.ToLower()]
    [In]::keybd_event(0, $sc, 0x08, [IntPtr]::Zero); Start-Sleep -Milliseconds 60; [In]::keybd_event(0, $sc, 0x0A, [IntPtr]::Zero)
  }
}
Write-Output "ok $Op $A $B"
