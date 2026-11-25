# Windows entry point (EXPERIMENTAL):  host\windows\dashling.ps1 setup | update | status | uninstall
param([Parameter(Position = 0)][string]$Command = 'help')
$here = Split-Path -Parent $MyInvocation.MyCommand.Path; $dest = Join-Path $env:USERPROFILE '.dashling'
function Ok($m) { Write-Host "  ok   $m" -ForegroundColor Green }; function Miss($m) { Write-Host "  miss $m" -ForegroundColor Yellow }
switch ($Command) {
  'setup'     { & "$here\setup.ps1" }
  'uninstall' { & "$here\setup.ps1" -Uninstall }
  'update'    { Copy-Item "$here\dashling-gate.ps1", "$here\dashling-session.ps1" $dest -Force; Ok 'gate and session scripts refreshed. If server/ or web/ changed: docker compose build; docker compose up -d' }
  'status'    {
    Write-Host 'Dashling on this PC'
    foreach ($f in 'dashling-gate.ps1', 'dashling-session.ps1') {
      if (Test-Path "$dest\$f") { if ((Get-FileHash "$dest\$f").Hash -eq (Get-FileHash "$here\$f").Hash) { Ok "$f (up to date)" } else { Miss "$f is OLD: run dashling.ps1 update" } } else { Miss "$f not installed: run setup" }
    }
    if ((Get-Service sshd -ErrorAction SilentlyContinue).Status -eq 'Running') { Ok 'OpenSSH Server running' } else { Miss 'OpenSSH Server not running' }
    if (Get-ScheduledTask -TaskName DashlingSession -ErrorAction SilentlyContinue) { Ok 'DashlingSession task registered' } else { Miss 'DashlingSession task missing' }
    Write-Host "  photos: $((Get-ChildItem "$dest\photos" -ErrorAction SilentlyContinue | Measure-Object).Count) files"
  }
  default { Write-Host "Usage: dashling.ps1 setup | update | status | uninstall" }
}
