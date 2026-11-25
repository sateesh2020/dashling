# Dashling on Windows (EXPERIMENTAL)

> **Status: written but never run on a real Windows PC.** The scripts were written against the documented Windows,
> OpenSSH and PowerShell interfaces, but the author's machine is a Mac, so none of this has been executed on Windows
> and the PowerShell was not even syntax-checked by a PowerShell parser. Expect to fix something on first run, and
> please report what broke. macOS and Linux are the tested platforms.

## What you need

- Windows 10 or 11, and **Docker Desktop** (the panel runs in Docker; `host.docker.internal` reaches your PC).
- **OpenSSH Server** (an optional Windows feature). In an *elevated* PowerShell:
  ```powershell
  Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
  Start-Service sshd; Set-Service -Name sshd -StartupType Automatic
  ```
- Windows PowerShell 5.1 (built in) is enough.

## Install

From the repo folder, in PowerShell (elevated if your account is an Administrator):

```powershell
powershell -ExecutionPolicy Bypass -File host\windows\dashling.ps1 setup
$env:HOST_SSH = "$env:USERNAME@host.docker.internal"; docker compose up -d
```

Then `host\windows\dashling.ps1 status` shows what is installed. After a `git pull`, run `host\windows\dashling.ps1 update`.
To remove everything: `host\windows\dashling.ps1 uninstall`.

## How it works, and why there are two scripts

Same design as macOS and Linux: the container connects over SSH with a key that can run **only** `dashling-gate.ps1`
(set with `command="…",restrict` in `authorized_keys`). If your account is an Administrator, Windows OpenSSH reads
`C:\ProgramData\ssh\administrators_authorized_keys` instead of `~\.ssh\authorized_keys`; `setup.ps1` picks the right one.

Windows runs SSH sessions in a separate, non-interactive session, so a script started over SSH **cannot press media keys,
change the desktop's volume, lock the screen or read what is playing**. Those go through a second script,
`dashling-session.ps1`, that runs inside *your* logged-in desktop:

1. The gate validates the request (for example `volume-set 40`) and writes it to `%USERPROFILE%\.dashling\session-cmd.txt`.
2. It starts the scheduled task `DashlingSession` (registered by `setup.ps1`, runs only while you are logged in).
3. The task runs `dashling-session.ps1`, which accepts only a short fixed list of commands, and writes the answer to
   `session-out.txt`, which the gate returns.

## What works

CPU, memory, disk, battery, network, uptime, top processes and quitting your own processes; power draw and battery health
(laptops); brightness (laptop panels, through WMI); Docker; the photo frame (put pictures in `%USERPROFILE%\.dashling\photos`);
app launcher (`apps.allow`); your own shortcuts (scripts in `%USERPROFILE%\.dashling\shortcuts`: `.ps1`, `.bat`, `.cmd`, `.exe`);
and, through the desktop-session task, volume, mute, media keys, lock, display off and now playing.

## What doesn't (yet)

- **Fan speed and core temperatures:** Windows exposes neither without a vendor driver or a tool such as LibreHardwareMonitor.
  The widgets say so. (One ACPI thermal zone is shown as a single temperature if your PC reports it.)
- **Load average:** Windows has no equivalent.
- **Calendar events, GitHub/GitLab page, AI-usage page:** the collectors are bash scripts. Those pages say "not supported on Windows yet".
- **Media seek**, and **album art** for now playing.

## Things most likely to need a fix on first run

- The `DashlingSession` task path or the `-LogonType Interactive` principal on a domain-joined or Microsoft-account PC.
- `administrators_authorized_keys` permissions (the script sets them with `icacls`; sshd silently ignores the file if they are wrong; check the event log under *OpenSSH/Operational*).
- WMI classes under `root/wmi` (battery, brightness) that some PCs and desktops don't provide. Those widgets then show empty values rather than failing.
- The inline C# for volume (Core Audio COM interface) in `dashling-session.ps1`.
