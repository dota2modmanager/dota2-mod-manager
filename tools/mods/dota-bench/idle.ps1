# Seconds since anybody last touched the mouse or the keyboard of this computer.
Add-Type @"
using System; using System.Runtime.InteropServices;
public struct LASTINPUT { public uint cbSize; public uint dwTime; }
public static class Idle { [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUT p); }
"@
$li = New-Object LASTINPUT
$li.cbSize = [uint32][Runtime.InteropServices.Marshal]::SizeOf($li)
[Idle]::GetLastInputInfo([ref]$li) | Out-Null
Write-Output ([math]::Floor(([Environment]::TickCount - $li.dwTime) / 1000))
