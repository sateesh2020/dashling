# Runs INSIDE your logged-in Windows desktop (started by the "DashlingSession" scheduled task, never by SSH directly).
# Reads ONE validated command from ~/.dashling/session-cmd.txt and writes the result to ~/.dashling/session-out.txt.
# It accepts only the fixed commands below, so nothing else can reach your desktop through it.
$ErrorActionPreference = 'SilentlyContinue'
$D = Join-Path $env:USERPROFILE '.dashling'; $out = Join-Path $D 'session-out.txt'
$cmd = (Get-Content (Join-Path $D 'session-cmd.txt') -Raw).Trim()

Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class DashWin {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, int flags, int extra);
  [DllImport("user32.dll")] public static extern bool LockWorkStation();
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
  public static void Key(byte vk) { keybd_event(vk, 0, 0, 0); keybd_event(vk, 0, 2, 0); }
}
'@
function Result($t) { Set-Content -Path $out -Value $t -Encoding utf8 }

# Core Audio (default speakers) for volume: small COM wrapper
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i(); int SetMasterVolumeLevelScalar(float level, Guid ctx); int j(); int GetMasterVolumeLevelScalar(out float level); int k(); int l(); int m(); int n(); int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid ctx); int GetMute(out bool mute); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMMDevice { int Activate(ref Guid id, int clsCtx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice d); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }
public static class DashAudio {
  static IAudioEndpointVolume Vol() { var e = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator; IMMDevice d; e.GetDefaultAudioEndpoint(0, 1, out d); var iid = typeof(IAudioEndpointVolume).GUID; object o; d.Activate(ref iid, 23, IntPtr.Zero, out o); return (IAudioEndpointVolume)o; }
  public static void Set(int pct) { Vol().SetMasterVolumeLevelScalar(pct / 100f, Guid.Empty); }
  public static void ToggleMute() { var v = Vol(); bool m; v.GetMute(out m); v.SetMute(!m, Guid.Empty); }
}
'@

switch -Regex ($cmd) {
  '^media playpause$' { [DashWin]::Key(0xB3); Result 'ok' }
  '^media next$'      { [DashWin]::Key(0xB0); Result 'ok' }
  '^media prev$'      { [DashWin]::Key(0xB1); Result 'ok' }
  '^mute$'            { [DashAudio]::ToggleMute(); Result 'ok' }
  '^volume-set (\d|\d\d|100)$' { [DashAudio]::Set([int]$Matches[1]); Result 'ok' }
  '^lock$'            { [void][DashWin]::LockWorkStation(); Result 'ok' }
  '^sleep-display$'   { [void][DashWin]::SendMessage([IntPtr]0xFFFF, 0x0112, [IntPtr]0xF170, [IntPtr]2); Result 'ok' }   # WM_SYSCOMMAND, SC_MONITORPOWER = off
  '^nowplaying$' {
    # Windows' own media session (Spotify, browsers, Groove, VLC ...) through the WinRT API
    try {
      Add-Type -AssemblyName System.Runtime.WindowsRuntime
      $t = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
      function Await($op, $type) { $task = $t.MakeGenericMethod($type).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
      [void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
      $mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
      $s = $mgr.GetCurrentSession(); if (-not $s) { Result ''; break }
      $m = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $tl = $s.GetTimelineProperties(); $pb = $s.GetPlaybackInfo()
      Result ("src=$($s.SourceAppUserModelId)`ntitle=$($m.Title)`nartist=$($m.Artist)`nalbum=$($m.AlbumTitle)`nduration=$([int]$tl.EndTime.TotalSeconds)`nelapsed=$([int]$tl.Position.TotalSeconds)`nrate=$([int]($pb.PlaybackStatus -eq 'Playing'))")
    } catch { Result '' }
  }
  '^artwork$' { Result '' }
  default { Result 'refused' }
}
