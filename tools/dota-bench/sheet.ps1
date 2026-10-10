# Pictures on one sheet, in rows of Columns, each at Scale: sheet.ps1 -Out o.png [-Columns 4] [-Scale 0.5] In1 In2 ...
param([string]$Out, [int]$Columns = 4, [double]$Scale = 0.5, [Parameter(ValueFromRemainingArguments=$true)][string[]]$In)
Add-Type -AssemblyName System.Drawing
$imgs = $In | ForEach-Object { [System.Drawing.Image]::FromFile($_) }
$cw = [int](($imgs | Measure-Object -Property Width -Maximum).Maximum * $Scale)
$ch = [int](($imgs | Measure-Object -Property Height -Maximum).Maximum * $Scale)
$cols = [Math]::Min($Columns, $imgs.Count); $rows = [Math]::Ceiling($imgs.Count / $cols)
$dst = New-Object System.Drawing.Bitmap ($cw * $cols), ($ch * $rows)
$g = [System.Drawing.Graphics]::FromImage($dst)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
for ($k = 0; $k -lt $imgs.Count; $k++) {
  $i = $imgs[$k]
  $g.DrawImage($i, ($k % $cols) * $cw, [Math]::Floor($k / $cols) * $ch, [int]($i.Width * $Scale), [int]($i.Height * $Scale))
  $i.Dispose()
}
$dst.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png); Write-Output "$($dst.Width)x$($dst.Height)"
