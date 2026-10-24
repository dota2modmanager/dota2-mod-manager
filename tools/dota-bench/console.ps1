# Commands into the game's console: the console key opens it, each command is typed as text
# (Unicode input, which no hotkey reads) with Enter after it, and the key closes it again.
# Whether the console took them the bench checks in console.log (-condebug), by a made-up command it
# sends first, which the game logs as unknown: had the console not opened, Enter would have
# opened the chat instead.
# Usage: console.ps1 -Key 0x2B "d2mm_bench_mark" "dota_camera_yaw 90" ...
param([string]$Key = '0x2B', [Parameter(ValueFromRemainingArguments=$true)][string[]]$Commands)
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class Con {
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit, Size = 40)] public struct INPUT { [FieldOffset(0)] public uint type; [FieldOffset(8)] public KEYBDINPUT ki; }
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  static void Send(ushort scan, uint flags) {
    var i = new INPUT[1]; i[0].type = 1; i[0].ki.wScan = scan; i[0].ki.dwFlags = flags;
    SendInput(1, i, Marshal.SizeOf(typeof(INPUT)));
  }
  // a key by scan code (KEYEVENTF_SCANCODE 0x08, KEYUP 0x02), as the game reads keys
  public static void Key(ushort scan) { Send(scan, 0x08); System.Threading.Thread.Sleep(40); Send(scan, 0x0A); }
  // text as characters (KEYEVENTF_UNICODE 0x04): what a text field takes and a hotkey does not
  public static void Text(string s) { foreach (char c in s) { Send(c, 0x04); Send(c, 0x06); System.Threading.Thread.Sleep(8); } }
}
"@
$p = Get-Process dota2 -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { Write-Output "no dota"; exit 1 }
[Con]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 150
# never type into another window: somebody may be using the computer
if ([Con]::GetForegroundWindow() -ne $p.MainWindowHandle) { Write-Output "dota is not in front"; exit 3 }
$scan = [uint16][Convert]::ToInt32($Key, 16)
[Con]::Key($scan)
Start-Sleep -Milliseconds 400
foreach ($c in $Commands) {
  [Con]::Text($c)
  Start-Sleep -Milliseconds 60
  [Con]::Key(0x1C)
  Start-Sleep -Milliseconds 150
}
[Con]::Key($scan)
Write-Output "ok $($Commands.Count)"
