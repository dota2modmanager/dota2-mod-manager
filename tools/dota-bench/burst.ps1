# A burst of pictures of one region of the Dota window, Count of them EveryMs apart, saved once
# all are taken (saving in between would space them out). One picture a second catches an attack
# at the same point of its swing every time and makes a moving hero look still.
# It also says how much each picture differs from the next: the mean difference in brightness,
# 0 to 255, over the whole region. The last line is "diffs: d1 d2 ...".
# Usage: burst.ps1 -Out <folder> -Prefix name -X x -Y y -W w -H h [-Count 16] [-EveryMs 80]
param([string]$Out, [string]$Prefix, [int]$X, [int]$Y, [int]$W, [int]$H, [int]$Count = 16, [int]$EveryMs = 80)
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing @"
using System; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices;
public struct RECT3 { public int Left, Top, Right, Bottom; }
public static class W3 {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT3 r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  // brightness of every pixel, the way Pillow's "L" mode weighs the channels
  public static float[] Luma(Bitmap b) {
    var d = b.LockBits(new Rectangle(0, 0, b.Width, b.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    var px = new byte[d.Stride * b.Height]; Marshal.Copy(d.Scan0, px, 0, px.Length); b.UnlockBits(d);
    var l = new float[b.Width * b.Height];
    for (int y = 0; y < b.Height; y++) for (int x = 0; x < b.Width; x++) {
      int i = y * d.Stride + x * 4; l[y * b.Width + x] = 0.114f * px[i] + 0.587f * px[i + 1] + 0.299f * px[i + 2];
    }
    return l;
  }
  public static double Diff(float[] a, float[] b) { double s = 0; for (int i = 0; i < a.Length; i++) s += Math.Abs(a[i] - b[i]); return s / a.Length; }
}
"@
[W3]::SetProcessDPIAware() | Out-Null
$p = Get-Process dota2 -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { Write-Output "no dota"; exit 1 }
[W3]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 200
# never click, press or take a picture into another window: somebody may be using the computer
if ([W3]::GetForegroundWindow() -ne $p.MainWindowHandle) { Write-Output "dota is not in front"; exit 3 }
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
$took = $clock.ElapsedMilliseconds
$lumas = $frames | ForEach-Object { ,[W3]::Luma($_) }
# with a dot whatever the Windows locale, for the bench to read
$inv = [Globalization.CultureInfo]::InvariantCulture
$diffs = for ($i = 1; $i -lt $lumas.Count; $i++) { [string]::Format($inv, '{0:F2}', [W3]::Diff($lumas[$i - 1], $lumas[$i])) }
for ($i = 0; $i -lt $frames.Count; $i++) {
  $frames[$i].Save((Join-Path $Out ('{0}-{1:D2}.png' -f $Prefix, $i)), [System.Drawing.Imaging.ImageFormat]::Png)
  $frames[$i].Dispose()
}
Write-Output "$Count in $took ms"
Write-Output ("diffs: " + ($diffs -join ' '))
