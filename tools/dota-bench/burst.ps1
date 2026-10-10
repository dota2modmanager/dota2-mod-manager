# A burst of pictures of one region of the Dota window, Count of them EveryMs apart, saved once
# all are taken (saving in between would space them out). One picture a second catches an attack
# at the same point of its swing every time and makes a moving hero look still.
# Usage: burst.ps1 -Out <folder> -Prefix name -X x -Y y -W w -H h [-Count 16] [-EveryMs 80]
param([string]$Out, [string]$Prefix, [int]$X, [int]$Y, [int]$W, [int]$H, [int]$Count = 16, [int]$EveryMs = 80)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public struct RECT3 { public int Left, Top, Right, Bottom; }
public static class W3 { [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT3 r); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }
"@
[W3]::SetProcessDPIAware() | Out-Null
$p = Get-Process dota2 -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { Write-Output "no dota"; exit 1 }
[W3]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 200
$r = New-Object RECT3
[W3]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
$size = New-Object System.Drawing.Size $W, $H
$frames = @()
$clock = [System.Diagnostics.Stopwatch]::StartNew()
for ($i = 0; $i -lt $Count; $i++) {
  $bmp = New-Object System.Drawing.Bitmap $W, $H
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.Left + $X, $r.Top + $Y, 0, 0, $size)
  $g.Dispose()
  $frames += $bmp
  $next = ($i + 1) * $EveryMs
  $wait = $next - $clock.ElapsedMilliseconds
  if ($wait -gt 0) { Start-Sleep -Milliseconds $wait }
}
for ($i = 0; $i -lt $frames.Count; $i++) {
  $frames[$i].Save((Join-Path $Out ('{0}-{1:D2}.png' -f $Prefix, $i)), [System.Drawing.Imaging.ImageFormat]::Png)
  $frames[$i].Dispose()
}
Write-Output "$Count in $($clock.ElapsedMilliseconds) ms"
