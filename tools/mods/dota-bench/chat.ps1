# Messages into the match's chat, one at a time: Enter opens the chat, the text is typed as
# characters and Enter sends it. The chat's cheats (-lvlup, -item, -createhero, -wtf) are read by
# the server from chat alone: the console's `say` reached the server as text, and nothing happened.
# Usage: chat.ps1 "-lvlup 29" "-wtf" ...
param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Messages)
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class Chat {
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit, Size = 40)] public struct INPUT { [FieldOffset(0)] public uint type; [FieldOffset(8)] public KEYBDINPUT ki; }
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
  static void Send(ushort scan, uint flags) {
    var i = new INPUT[1]; i[0].type = 1; i[0].ki.wScan = scan; i[0].ki.dwFlags = flags;
    SendInput(1, i, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void Enter() { Send(0x1C, 0x08); System.Threading.Thread.Sleep(40); Send(0x1C, 0x0A); }
  public static void Text(string s) { foreach (char c in s) { Send(c, 0x04); Send(c, 0x06); System.Threading.Thread.Sleep(8); } }
}
"@
$p = Get-Process dota2 -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { Write-Output "no dota"; exit 1 }
if ([Chat]::GetForegroundWindow() -ne $p.MainWindowHandle) { [Chat]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [Chat]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero) }
[Chat]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 150
# never type into another window: somebody may be using the computer
if ([Chat]::GetForegroundWindow() -ne $p.MainWindowHandle) { Write-Output "dota is not in front"; exit 3 }
foreach ($m in $Messages) {
  [Chat]::Enter()
  Start-Sleep -Milliseconds 400
  [Chat]::Text($m)
  Start-Sleep -Milliseconds 100
  [Chat]::Enter()
  Start-Sleep -Milliseconds 700
}
Write-Output "ok $($Messages.Count)"
