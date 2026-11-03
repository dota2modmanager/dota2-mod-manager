# What the computer plays, recorded for a while: WASAPI loopback on the default output device,
# written as a 16-bit mono WAV at the device's rate. The bench hears the game with it
# (tools/dota-bench/hear.mjs). Stops after -Seconds, or earlier when -Stop names a file that appears.
param([string]$Out, [double]$Seconds = 60, [string]$Stop = '')
Add-Type @"
using System; using System.IO; using System.Runtime.InteropServices; using System.Threading;
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCo {}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int EnumAudioEndpoints(int flow, int mask, out IntPtr devices); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioClient {
  int Initialize(int share, int flags, long duration, long period, IntPtr format, IntPtr session);
  int GetBufferSize(out uint frames); int GetStreamLatency(out long l); int GetCurrentPadding(out uint p);
  int IsFormatSupported(int m, IntPtr f, out IntPtr c); int GetMixFormat(out IntPtr format);
  int GetDevicePeriod(out long d, out long m); int Start(); int Stop(); int Reset(); int SetEventHandle(IntPtr h);
  int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object o);
}
[Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioCaptureClient {
  int GetBuffer(out IntPtr data, out uint frames, out uint flags, out long devPos, out long qpcPos);
  int ReleaseBuffer(uint frames); int GetNextPacketSize(out uint frames);
}
public static class Loopback {
  static void Ok(int hr, string what) { if (hr != 0) throw new Exception(what + " failed: 0x" + hr.ToString("x8")); }
  public static string Record(string outPath, double seconds, string stop) {
    var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCo();
    IMMDevice dev; Ok(en.GetDefaultAudioEndpoint(0, 0, out dev), "no output device");
    Guid iac = typeof(IAudioClient).GUID; object o; Ok(dev.Activate(ref iac, 23, IntPtr.Zero, out o), "Activate");
    var client = (IAudioClient)o;
    IntPtr fmt; Ok(client.GetMixFormat(out fmt), "GetMixFormat");
    int channels = Marshal.ReadInt16(fmt, 2), rate = Marshal.ReadInt32(fmt, 4), block = Marshal.ReadInt16(fmt, 12), bits = Marshal.ReadInt16(fmt, 14);
    // loopback, shared, one second of buffer
    Ok(client.Initialize(0, 0x00020000, 10000000, 0, fmt, IntPtr.Zero), "Initialize");
    Guid icc = typeof(IAudioCaptureClient).GUID; Ok(client.GetService(ref icc, out o), "GetService");
    var cap = (IAudioCaptureClient)o;
    var mono = new MemoryStream();
    var w = new BinaryWriter(mono);
    long written = 0, first = -1;
    Ok(client.Start(), "Start");
    var end = DateTime.UtcNow.AddSeconds(seconds);
    var start = DateTime.UtcNow;
    while (DateTime.UtcNow < end && (stop == "" || !File.Exists(stop))) {
      Thread.Sleep(10);
      uint size; cap.GetNextPacketSize(out size);
      while (size > 0) {
        IntPtr data; uint frames, flags; long pos, qpc;
        Ok(cap.GetBuffer(out data, out frames, out flags, out pos, out qpc), "GetBuffer");
        // the device's position says where the packet belongs: while nothing plays it hands no
        // packets at all, so the silence is written in to keep the recording in time
        if (first < 0) first = pos - (long)((DateTime.UtcNow - start).TotalSeconds * rate);
        for (long want = pos - first; written < want; written++) w.Write((short)0);
        var buf = new byte[frames * block];
        if ((flags & 2) == 0) Marshal.Copy(data, buf, 0, buf.Length);
        for (int f = 0; f < frames; f++) {
          double sum = 0;
          for (int c = 0; c < channels; c++) {
            int at = f * block + c * (bits / 8);
            sum += bits == 32 ? BitConverter.ToSingle(buf, at) : BitConverter.ToInt16(buf, at) / 32768.0;
          }
          double v = Math.Max(-1, Math.Min(1, sum / channels));
          w.Write((short)(v * 32767));
        }
        written += frames;
        cap.ReleaseBuffer(frames);
        cap.GetNextPacketSize(out size);
      }
    }
    client.Stop();
    var pcm = mono.ToArray();
    using (var f = new BinaryWriter(File.Create(outPath))) {
      f.Write(new[] { (byte)'R', (byte)'I', (byte)'F', (byte)'F' }); f.Write(36 + pcm.Length);
      f.Write(new[] { (byte)'W', (byte)'A', (byte)'V', (byte)'E', (byte)'f', (byte)'m', (byte)'t', (byte)' ' });
      f.Write(16); f.Write((short)1); f.Write((short)1); f.Write(rate); f.Write(rate * 2); f.Write((short)2); f.Write((short)16);
      f.Write(new[] { (byte)'d', (byte)'a', (byte)'t', (byte)'a' }); f.Write(pcm.Length); f.Write(pcm);
    }
    return rate + " Hz, " + (pcm.Length / 2.0 / rate).ToString("0.0") + " s";
  }
}
"@
Write-Output ([Loopback]::Record($Out, $Seconds, $Stop))
