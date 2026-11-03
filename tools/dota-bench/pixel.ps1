# The colour of one pixel of a picture, as "r g b": the bench reads a checkbox by it
param([string]$In, [int]$X, [int]$Y)
Add-Type -AssemblyName System.Drawing
$bmp = [System.Drawing.Bitmap]::FromFile($In)
$c = $bmp.GetPixel($X, $Y)
$bmp.Dispose()
Write-Output "$($c.R) $($c.G) $($c.B)"
