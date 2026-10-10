# Clicks and key presses into the Dota window, at coordinates inside it.
# Usage: input.ps1 click X Y | rclick X Y | key K | keys "QWE"
param([string]$Op, [string]$A, [string]$B)
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System; using System.Runtime.InteropServices;
public struct RECT2 { public int Left, Top, Right, Bottom; }
public static class In {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT2 r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
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
$r = New-Object RECT2
[In]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
switch ($Op) {
  'click'  { [In]::SetCursorPos($r.Left + [int]$A, $r.Top + [int]$B) | Out-Null; Start-Sleep -Milliseconds 80; [In]::mouse_event(0x02,0,0,0,[IntPtr]::Zero); Start-Sleep -Milliseconds 60; [In]::mouse_event(0x04,0,0,0,[IntPtr]::Zero) }
  'rclick' { [In]::SetCursorPos($r.Left + [int]$A, $r.Top + [int]$B) | Out-Null; Start-Sleep -Milliseconds 80; [In]::mouse_event(0x08,0,0,0,[IntPtr]::Zero); Start-Sleep -Milliseconds 60; [In]::mouse_event(0x10,0,0,0,[IntPtr]::Zero) }
  'key'    {
    # games read scan codes: press and release by scan code (KEYEVENTF_SCANCODE 0x08, KEYUP 0x02)
    $codes = @{ q = 0x10; w = 0x11; e = 0x12; r = 0x13; a = 0x1E; s = 0x1F; d = 0x20; f = 0x21; space = 0x39; esc = 0x01; f1 = 0x3B }
    $sc = [byte]$codes[$A.ToLower()]
    [In]::keybd_event(0, $sc, 0x08, [IntPtr]::Zero); Start-Sleep -Milliseconds 60; [In]::keybd_event(0, $sc, 0x0A, [IntPtr]::Zero)
  }
}
Write-Output "ok $Op $A $B"
