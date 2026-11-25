# Dashling gate for WINDOWS (EXPERIMENTAL, untested on real hardware): the ONLY thing the container's SSH key may run.
# Installed via authorized_keys as:  command="powershell -NoProfile -ExecutionPolicy Bypass -File <this file>",restrict ...
# Same fixed commands and the same key=value output as the macOS/Linux gates, so the server is unchanged.
# Read it, it is short on purpose. Anything not listed below is refused.
#
# Things that need your DESKTOP session (media keys, volume, lock, display off, now playing) can't run from an SSH
# session on Windows. They are handed to the "DashlingSession" scheduled task, which runs dashling-session.ps1 inside
# your logged-in desktop. See host/windows/README.md.
$ErrorActionPreference = 'SilentlyContinue'
$cmd = "$env:SSH_ORIGINAL_COMMAND".Trim()
$D = Join-Path $env:USERPROFILE '.dashling'
function KV($k, $v) { Write-Output "$k=$v" }
function Refuse($msg, $code = 126) { [Console]::Error.WriteLine($msg); exit $code }

# hand a validated command to the desktop-session task and return what it printed
function Session($line) {
  $in = Join-Path $D 'session-cmd.txt'; $out = Join-Path $D 'session-out.txt'
  Remove-Item $out -Force
  Set-Content -Path $in -Value $line -Encoding ascii
  schtasks /run /tn DashlingSession | Out-Null
  for ($i = 0; $i -lt 40; $i++) { Start-Sleep -Milliseconds 100; if (Test-Path $out) { Start-Sleep -Milliseconds 50; Get-Content $out; return } }
  Refuse 'desktop session did not answer (is DashlingSession registered and are you logged in?)' 1
}
function Allowed($file, $name) { (Test-Path $file) -and ((Get-Content $file) -contains $name) }

switch -Regex ($cmd) {
  '^stats$' {
    $cs = Get-CimInstance Win32_ComputerSystem; $os = Get-CimInstance Win32_OperatingSystem
    KV name $env:COMPUTERNAME; KV cores $cs.NumberOfLogicalProcessors
    $c = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'"
    KV cpu_user $c.PercentUserTime; KV cpu_sys $c.PercentPrivilegedTime; KV cpu_idle $c.PercentIdleTime
    $tot = [double]$os.TotalVisibleMemorySize * 1024; KV mem_total ([int64]$tot); KV mem_used ([int64]($tot - [double]$os.FreePhysicalMemory * 1024))
    $drv = Get-PSDrive -Name ($env:SystemDrive.TrimEnd(':')); if ($drv) { KV disk_total ([int64]($drv.Used + $drv.Free)); KV disk_used ([int64]$drv.Used) }
    $b = Get-CimInstance Win32_Battery | Select-Object -First 1
    if ($b) {
      KV batt_pct $b.EstimatedChargeRemaining
      $st = switch ($b.BatteryStatus) { 1 { 'discharging' } 4 { 'discharging' } 5 { 'discharging' } 6 { 'charging' } 7 { 'charging' } 8 { 'charging' } 9 { 'charging' } default { 'charged' } }
      KV batt_state $st
      if ($st -eq 'discharging' -and $b.EstimatedRunTime -lt 71582788) { KV batt_time ('{0}:{1:00}' -f [math]::Floor($b.EstimatedRunTime / 60), ($b.EstimatedRunTime % 60)) }
    }
    # top processes: cpu|mem|pid|mine(1 = yours, can be quit from the panel)|name
    $me = $env:USERNAME; $n = 0
    Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $_.Name -notin '_Total', 'Idle', 'System' -and $_.IDProcess -ne $PID } |
      Sort-Object PercentProcessorTime -Descending | Select-Object -First 6 | ForEach-Object {
        $n++; $owner = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.IDProcess)" | Invoke-CimMethod -MethodName GetOwner).User
        $nm = $_.Name -replace '#\d+$', ''
        KV "proc$n" ('{0}|{1:N1}|{2}|{3}|{4}' -f $_.PercentProcessorTime, ($_.WorkingSetPrivate / $tot * 100), $_.IDProcess, [int]($owner -eq $me), $nm)
      }
    KV boot ([int64]([DateTimeOffset]$os.LastBootUpTime).ToUnixTimeSeconds())
    $rx = 0; $tx = 0; Get-NetAdapter -Physical | Where-Object Status -eq 'Up' | Get-NetAdapterStatistics | ForEach-Object { $rx += $_.ReceivedBytes; $tx += $_.SentBytes }
    KV net_rx $rx; KV net_tx $tx
  }
  '^fans$'  { KV fan_none 1 }                      # Windows exposes no fan RPM without a vendor driver
  '^temps$' {
    $z = Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature | Select-Object -First 1   # one ACPI thermal zone (needs admin on some PCs)
    if ($z) { KV pcore1 ([math]::Round($z.CurrentTemperature / 10 - 273.15)) } else { KV temp_none 1 }
  }
  '^power$' {
    $b = Get-CimInstance Win32_Battery | Select-Object -First 1
    $ac = (Get-CimInstance -Namespace root/wmi -ClassName BatteryStatus | Select-Object -First 1)
    KV ac ([int](-not $b -or $ac.PowerOnline))
    if ($ac) { if ($ac.Discharging) { KV batt_w ([math]::Round($ac.DischargeRate / 1000, 1)); KV sys_w ([math]::Round($ac.DischargeRate / 1000, 1)) } elseif ($ac.Charging) { KV batt_w ([math]::Round(-$ac.ChargeRate / 1000, 1)) } }
    $full = (Get-CimInstance -Namespace root/wmi -ClassName BatteryFullChargedCapacity | Select-Object -First 1).FullChargedCapacity
    $design = (Get-CimInstance -Namespace root/wmi -ClassName BatteryStaticData | Select-Object -First 1).DesignedCapacity
    if ($full) { KV nominalchargecapacity $full }; if ($design) { KV designcapacity $design }
    $cyc = (Get-CimInstance -Namespace root/wmi -ClassName BatteryCycleCount | Select-Object -First 1).CycleCount; if ($cyc) { KV cyclecount $cyc }
  }
  '^display-get$' {
    $br = Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightness | Select-Object -First 1
    if ($br) { KV brightness $br.CurrentBrightness } else { KV brightness_none 1 }
  }
  '^display-set (\d|\d\d|100)$' {
    $n = [math]::Max(1, [int]$Matches[1])
    Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightnessMethods | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = [byte]$n } | Out-Null
    Write-Output ok
  }
  # ---- desktop-session actions (media, volume, lock, display off, now playing)
  '^(lock|sleep-display|mute|nowplaying|artwork)$' { Session $cmd }
  '^media (playpause|next|prev)$' { Session $cmd }
  '^volume-set (\d|\d\d|100)$' { Session $cmd }
  '^media-seek \d{1,5}$' { Refuse 'seeking is not supported on Windows yet' 1 }
  '^calendar$' { KV cal_unsupported 1 }

  '^apps$' { if (Test-Path "$D\apps.allow") { Get-Content "$D\apps.allow" } }
  '^open-app (.+)$' {
    $name = $Matches[1]
    if ($name -match '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,60}$' -and (Allowed "$D\apps.allow" $name)) { Start-Process -FilePath $name; Write-Output ok } else { Refuse 'app not in allowlist' }
  }
  '^shortcuts$' { Get-ChildItem "$D\shortcuts" -File | Where-Object { $_.Extension -in '.ps1', '.bat', '.cmd', '.exe' } | ForEach-Object { $_.BaseName } }
  '^shortcut (.+)$' {
    $name = $Matches[1]
    $f = if ($name -match '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,60}$') { Get-ChildItem "$D\shortcuts" -File | Where-Object { $_.BaseName -eq $name -and $_.Extension -in '.ps1', '.bat', '.cmd', '.exe' } | Select-Object -First 1 }
    if (-not $f) { Refuse 'shortcut not found' }
    if ($f.Extension -eq '.ps1') { & powershell -NoProfile -ExecutionPolicy Bypass -File $f.FullName | Out-Null } else { & $f.FullName | Out-Null }
    Write-Output ok
  }

  '^docker-ps$' { $o = docker ps -a --format '{{.Names}}|{{.State}}|{{.Status}}|{{.Image}}' 2>$null; if ($LASTEXITCODE -eq 0) { $o } else { KV docker_down 1 } }
  '^docker-act (start|stop|restart) ([A-Za-z0-9][A-Za-z0-9_.-]{0,62})$' {
    if ($Matches[2] -like '*dashling*') { Refuse "refusing to touch the panel's own container" }
    docker $Matches[1] $Matches[2] | Out-Null; if ($LASTEXITCODE -eq 0) { Write-Output ok } else { Refuse 'docker failed' 1 }
  }

  '^photo-list$' { Get-ChildItem "$D\photos" -File | Where-Object { $_.Extension -match '^\.(jpe?g|png|webp|bmp|gif)$' } | Select-Object -First 300 | ForEach-Object { $_.Name } }
  '^photo-get (.+)$' {
    $name = $Matches[1]
    if ($name -notmatch '^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,100}\.(jpe?g|png|webp|bmp|gif)$' -or -not (Test-Path "$D\photos\$name")) { Refuse 'no such photo' 1 }
    Add-Type -AssemblyName System.Drawing
    $img = [System.Drawing.Image]::FromFile("$D\photos\$name")
    $scale = [math]::Min(1, 1600 / [math]::Max($img.Width, $img.Height)); $w = [int]($img.Width * $scale); $h = [int]($img.Height * $scale)
    $bmp = New-Object System.Drawing.Bitmap $w, $h; $g = [System.Drawing.Graphics]::FromImage($bmp); $g.InterpolationMode = 'HighQualityBicubic'; $g.DrawImage($img, 0, 0, $w, $h)
    $ms = New-Object System.IO.MemoryStream; $enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
    $p = New-Object System.Drawing.Imaging.EncoderParameters 1; $p.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 72L
    $bmp.Save($ms, $enc, $p); $img.Dispose(); $bmp.Dispose()
    $o = [Console]::OpenStandardOutput(); $b = $ms.ToArray(); $o.Write($b, 0, $b.Length); $o.Flush()
  }

  '^proc-kill(9)? (\d{2,7})$' {
    # only YOUR processes, never the desktop or the SSH session. Plain quit asks the window to close; "9" forces it.
    $force = [bool]$Matches[1]; $id = [int]$Matches[2]
    $p = Get-Process -Id $id; if (-not $p) { Refuse 'no such process' 1 }
    $owner = (Get-CimInstance Win32_Process -Filter "ProcessId=$id" | Invoke-CimMethod -MethodName GetOwner).User
    if ($owner -ne $env:USERNAME) { Refuse 'not your process' }
    if ($p.ProcessName -in 'explorer', 'winlogon', 'csrss', 'wininit', 'services', 'lsass', 'svchost', 'dwm', 'sshd', 'sshd-session', 'powershell', 'pwsh', 'conhost') { Refuse 'protected process' }
    if ($force) { Stop-Process -Id $id -Force } else { if (-not $p.CloseMainWindow()) { Stop-Process -Id $id } }
    Write-Output ok
  }

  '^(ai-usage|gh-contrib|gl-contrib|gh-reviews|gl-reviews)$' { Refuse 'this page is not supported on Windows yet' 1 }
  default { Refuse 'refused' }
}
