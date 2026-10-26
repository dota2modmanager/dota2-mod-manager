# The health bars over the units in a picture of the Dota window, so the bench can find the hero,
# the dummy and the enemy it spawned wherever they stand. A unit's bar is its health row (green for
# the hero, red for an enemy) right above a blue mana row; that pair is what is looked for, since
# red alone is everywhere in a blood-red mod. One bar per line: "colour x0 x1 y", y of the mana row.
# Usage: bars.ps1 -In picture.png [-Top 60] [-Bottom 900] [-Left 290]
param([string]$In, [int]$Top = 60, [int]$Bottom = 900, [int]$Left = 290)
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing @"
using System; using System.Collections.Generic; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices;
public static class Bars {
  static bool Mana(int r, int g, int b) { return b > 220 && r < 110 && g > 95 && g < 150; }
  public static List<string> Find(Bitmap bmp, int top, int bottom, int left) {
    var d = bmp.LockBits(new Rectangle(0, 0, bmp.Width, bmp.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    var px = new byte[d.Stride * bmp.Height]; Marshal.Copy(d.Scan0, px, 0, px.Length); bmp.UnlockBits(d);
    Func<int, int, int[]> at = (x, y) => { int i = y * d.Stride + x * 4; return new int[] { px[i + 2], px[i + 1], px[i] }; };
    var found = new List<int[]>();
    for (int y = Math.Max(top, 8); y < Math.Min(bottom, bmp.Height); y++) {
      int start = -1, gap = 0;
      for (int x = left; x <= bmp.Width; x++) {
        var c = x < bmp.Width ? at(x, y) : new int[] { 0, 0, 0 };
        if (x < bmp.Width && Mana(c[0], c[1], c[2])) { if (start < 0) start = x; gap = 0; continue; }
        if (start >= 0 && ++gap > 2) {
          int end = x - gap;
          if (end - start >= 30 && !found.Exists(f => Math.Abs(f[2] - y) <= 4 && f[0] < end && start < f[1])) found.Add(new[] { start, end, y });
          start = -1; gap = 0;
        }
      }
    }
    var lines = new List<string>();
    foreach (var f in found) {
      // the health row: a few pixels above the mana row, past the black line between them
      int red = 0, green = 0, n = 0;
      for (int y = f[2] - 9; y <= f[2] - 3; y++) for (int x = f[0]; x < f[1]; x += 2) {
        var c = at(x, y); n++;
        if (c[0] > 130 && c[1] < 75 && c[2] < 40) red++;
        else if (c[1] > 170 && c[0] < 200 && c[2] < 130) green++;
      }
      string kind = red > n / 6 ? "red" : green > n / 6 ? "green" : "other";
      lines.Add(kind + " " + f[0] + " " + f[1] + " " + f[2]);
    }
    return lines;
  }
}
"@
$bmp = [System.Drawing.Bitmap]::FromFile($In)
[Bars]::Find($bmp, $Top, $Bottom, $Left) | ForEach-Object { Write-Output $_ }
$bmp.Dispose()
