# One-time setup so the Dashling container can read stats from THIS Windows PC. EXPERIMENTAL: not yet tested on real hardware.
# Run in an ELEVATED PowerShell if your account is an Administrator (needed to edit sshd's administrators_authorized_keys):
#     powershell -ExecutionPolicy Bypass -File host\windows\setup.ps1
# What it does (and nothing else):
#   1. copies dashling-gate.ps1 and dashling-session.ps1 to %USERPROFILE%\.dashling\
#   2. creates a dedicated SSH keypair; the private key goes only into the Docker volume
#   3. adds ONE line to the right authorized_keys file, locked to the gate script
#   4. registers the "DashlingSession" scheduled task (runs only while you are logged in) for media keys, volume, lock
# Undo: host\windows\setup.ps1 -Uninstall
param([switch]$Uninstall, [string]$Volume = 'dashling_dashling-data')
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $env:USERPROFILE '.dashling'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$akFile = if ($isAdmin) { "$env:ProgramData\ssh\administrators_authorized_keys" } else { Join-Path $env:USERPROFILE '.ssh\authorized_keys' }

if ($Uninstall) {
  if (Test-Path $akFile) { (Get-Content $akFile) | Where-Object { $_ -notmatch 'dashling-gate' } | Set-Content $akFile }
  schtasks /delete /tn DashlingSession /f 2>$null | Out-Null
  Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue; Write-Host 'Removed.'; exit 0
}

Write-Host "This will install the gate to $dest, add one restricted key to $akFile, store the private key in Docker volume '$Volume',"
Write-Host "and register the DashlingSession scheduled task."
if ((Read-Host 'Continue? [y/N]') -notmatch '^[yY]') { exit 1 }

$sshd = Get-Service sshd -ErrorAction SilentlyContinue
if (-not $sshd -or $sshd.Status -ne 'Running') {
  Write-Host "`nThe OpenSSH Server is not running. In an elevated PowerShell run:"
  Write-Host "  Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0"
  Write-Host "  Start-Service sshd; Set-Service -Name sshd -StartupType Automatic"
  Write-Host "then re-run this script."; exit 1
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Write-Host 'docker is not installed or not in PATH'; exit 1 }

New-Item -ItemType Directory -Force -Path $dest, "$dest\shortcuts", "$dest\photos" | Out-Null
Copy-Item "$here\dashling-gate.ps1", "$here\dashling-session.ps1" $dest -Force
if (-not (Test-Path "$dest\apps.allow")) { Set-Content "$dest\apps.allow" "notepad" }

$tmp = Join-Path $env:TEMP ("dashling-" + [guid]::NewGuid()); New-Item -ItemType Directory $tmp | Out-Null
try {
  ssh-keygen -q -t ed25519 -N '""' -C dashling-container -f "$tmp\id_ed25519"
  docker volume create $Volume | Out-Null
  docker run --rm -v "${Volume}:/data" -v "${tmp}:/in:ro" alpine sh -c 'mkdir -p /data/ssh && cp /in/id_ed25519 /data/ssh/id_ed25519 && chown -R 1000:1000 /data && chmod 700 /data/ssh && chmod 600 /data/ssh/id_ed25519'
  New-Item -ItemType Directory -Force -Path (Split-Path $akFile) | Out-Null
  if (Test-Path $akFile) { (Get-Content $akFile) | Where-Object { $_ -notmatch 'dashling-container|phonebox-container' } | Set-Content $akFile }
  $gate = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File $dest\dashling-gate.ps1"
  Add-Content $akFile ("command=`"$gate`",restrict " + (Get-Content "$tmp\id_ed25519.pub"))
  if ($isAdmin) { icacls $akFile /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F' | Out-Null }     # sshd ignores the file otherwise
} finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$dest\dashling-session.ps1`""
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
Register-ScheduledTask -TaskName DashlingSession -Action $action -Principal $principal -Force | Out-Null

Write-Host "`nDone. Now run (in the repo folder):"
Write-Host "  `$env:HOST_SSH='$env:USERNAME@host.docker.internal'; docker compose up -d"
