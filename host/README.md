# `host/`: everything that runs on the computer you monitor

The Dashling container never runs anything on your computer directly. It connects over SSH with a key that is locked to
**one script** (the *gate*), and that script only knows the fixed commands listed in it. There is one gate per operating
system. They answer the same commands and print the same `key=value` data, so the server and web app are identical
everywhere.

```
host/
  dashling.sh        entry point for macOS and Linux  (Windows: windows\dashling.ps1)
  macos/             gate + installers + small compiled helpers for macOS        (tested)
  linux/             gate + installers for Linux                                  (tested)
  windows/           gate + installers for Windows                                (experimental, see windows/README.md)
  common/            scripts shared by macOS and Linux: GitHub/GitLab sync, AI-usage sync, Claude status-line hook
```

**You normally only need one command** (macOS and Linux):

```bash
./host/dashling.sh setup     # first time
./host/dashling.sh update    # after every `git pull`
./host/dashling.sh status    # what is installed, and is it current?
```

On Windows: `powershell -ExecutionPolicy Bypass -File host\windows\dashling.ps1 setup`.

## Why not one big script that runs everything through the gate?

The gate is the security boundary: the SSH key can run *only* it, and it only answers a short list of read or control
commands. If the gate could run installers, rebuild helpers or edit scheduled jobs, anyone who got hold of the container's
key could change what runs on your computer. So installing stays a manual step you run yourself, and `dashling.sh` is the
single front door for it.

## What works on which OS

| | macOS | Linux | Windows (experimental) |
|---|---|---|---|
| CPU, memory, disk, battery, network, uptime, top processes, quit a process | yes | yes | yes |
| Load average | yes | yes | no |
| Fans, core temperatures | yes (`smcfan`) | yes (kernel `hwmon`) | no |
| Power draw, battery health | yes | yes | yes |
| Brightness | yes (`dispctl`) | yes (`brightnessctl`) | yes (WMI) |
| Volume, mute | yes | yes (`pactl`/`amixer`) | yes (desktop-session task) |
| Media keys, now playing, seek | yes | yes (`playerctl`) | keys and now playing; no seek |
| Lock, display off | yes | yes | yes (desktop-session task) |
| Docker, photo frame, app launcher | yes | yes | yes |
| Your own shortcuts | Shortcuts app | executable scripts in `~/.dashling/shortcuts` | scripts in `%USERPROFILE%\.dashling\shortcuts` |
| Calendar events | yes (`calevents`) | no | no |
| GitHub/GitLab + AI-usage pages | yes | yes | no |

## What each file is

### Entry points
| File | What it is |
|---|---|
| `dashling.sh` | `setup`, `update`, `helpers`, `sync`, `statusline`, `status`, `uninstall`. Picks `macos/` or `linux/` by itself. |
| `windows/dashling.ps1` | The same idea for Windows: `setup`, `update`, `status`, `uninstall`. |

### macOS (`macos/`)
| File | What it is | When it runs |
|---|---|---|
| `dashling-gate.sh` | The only thing the container's SSH key may run. | On every request. Installed to `~/.dashling/`. |
| `setup.sh` | First-time install: gate, dedicated SSH key (private half goes only into the Docker volume), one restricted line in `~/.ssh/authorized_keys`, then the installers below. | Once. |
| `install-helpers.sh` | Builds the three helpers into `~/.dashling/`, creates `shortcuts.allow`, installs the calendar agent. No sudo. | `setup` / `update` / `helpers`. |
| `install-jobs.sh` | Installs the 2-minute background job (`dev.dashling.contrib`) that runs the two sync scripts in `common/`. | `setup` / `update` / `sync`. |
| `smcfan.c` | Read-only SMC reader: **fan speed, core temperatures, power draw**. No root. | Called by the gate. |
| `dispctl.c` | Gets and sets the **built-in display brightness** (private Apple framework, best-effort). | Called by the gate. |
| `calevents.swift` + `calevents-Info.plist` | Reads **upcoming Calendar events** (the plist lets macOS show the permission prompt). | Calendar agent, every 5 min. |

### Linux (`linux/`)
| File | What it is | When it runs |
|---|---|---|
| `dashling-gate.sh` | The only thing the container's SSH key may run. Reads `/proc` and `/sys` directly, so there is nothing to compile. | On every request. Installed to `~/.dashling/`. |
| `setup.sh` | First-time install: checks an SSH server is running, installs the gate, creates the SSH key, adds the restricted `authorized_keys` line, installs the timer. | Once. |
| `install-jobs.sh` | Installs the 2-minute sync as a **systemd user timer** (or one cron line if systemd isn't available). | `setup` / `update` / `sync`. |
| `install-helpers.sh` | Installs nothing. Checks for optional tools (`playerctl`, `brightnessctl`, `pactl`, ImageMagick, `jq`, `gh`, `docker`) and sensors, and tells you what is missing. | `helpers`. |

### Windows (`windows/`), see [windows/README.md](windows/README.md)
| File | What it is |
|---|---|
| `dashling-gate.ps1` | The only thing the container's SSH key may run (PowerShell). |
| `dashling-session.ps1` | Runs inside your logged-in desktop (started by a scheduled task) for media keys, volume, lock, display off and now playing. |
| `setup.ps1` | Installs both, creates the SSH key, edits the right `authorized_keys`, registers the `DashlingSession` task. |
| `dashling.ps1` | Entry point. |

### Shared (`common/`, macOS and Linux)
| File | What it is | When it runs |
|---|---|---|
| `contrib-sync.sh` | Daily GitHub/GitLab contribution counts using the `gh`/`glab` logins already on the machine. Counts only, never tokens. | Background job, every 2 minutes. |
| `ai-usage-sync.sh` | Claude Code and Codex usage (token counts, model names, timestamps) from their local logs. Message text is never kept. | Background job, with the one above. |
| `claude-statusline.sh` + `install-claude-statusline.sh` | Optional Claude Code status-line hook so the AI page can show plan limits. Backs up `~/.claude/settings.json`; `--remove` undoes it. | `./host/dashling.sh statusline`. |

## What gets created on your machine

Everything lives under `~/.dashling/` (Windows: `%USERPROFILE%\.dashling\`) except the scheduled jobs and one line in `authorized_keys`.

```
~/.dashling/
  dashling-gate.sh            the only command the SSH key can run
  apps.allow                  apps the panel may open (one name per line, edit freely)
  shortcuts/  (Linux/Windows) your own scripts, one button each      shortcuts.allow (macOS) names of Shortcuts the panel may run
  photos/                     put pictures (or a symlink to a folder) here for the photo frame
  cache/                      data written by the background jobs
  smcfan  dispctl  calevents  (macOS only) the compiled helpers
```

| | Scheduled jobs |
|---|---|
| macOS | `~/Library/LaunchAgents/dev.dashling.contrib.plist` (every 2 min), `dev.dashling.calendar.plist` (every 5 min) |
| Linux | systemd user timer `dashling-sync.timer` (every 2 min), or one crontab line |
| Windows | scheduled task `DashlingSession` (runs only while you are logged in) |

`authorized_keys` gets one line: `command="…dashling-gate…",restrict ssh-ed25519 …`.

## Optional one-time steps

**macOS**
- *Do Not Disturb button:* macOS doesn't let scripts toggle Focus. Create a Shortcut named `Dashling DND` (action: *Set Focus*); its name must be a line in `shortcuts.allow`.
- *Lock button:* starts the screen saver, which locks the Mac if *Require password* is on. For a true lock, make a Shortcut named `Dashling Lock`.
- *Calendar:* the first run of the calendar agent may show a permission prompt. Click Allow.
- *Remote Login* must be on (System Settings > General > Sharing).

**Linux**
- An SSH server must be running: `sudo apt install openssh-server && sudo systemctl enable --now ssh` (Fedora: `dnf install openssh-server`, Arch: `pacman -S openssh`). `setup` tells you if it isn't.
- Run `./host/dashling.sh helpers` to see which optional tools to install. Fan and temperature numbers need the sensor drivers for your hardware (`sudo apt install lm-sensors && sudo sensors-detect`).
- Docker widget: your user must be in the `docker` group.
- Wayland note: lock and now-playing talk to your login session through its D-Bus socket, which the gate finds automatically. If you use a very unusual session setup and a control does nothing, tell us which desktop you use.

**Windows**: see [windows/README.md](windows/README.md).

## Updating and removing

```bash
git pull && ./host/dashling.sh update          # new gate script, helpers, jobs (SSH key untouched)
docker compose build && docker compose up -d   # if server/ or web/ changed too
./host/dashling.sh uninstall                   # removes the key line, background jobs and ~/.dashling (asks first)
```

If you rebuild the container yourself, pass the connection: `HOST_SSH=you@host.docker.internal docker compose up -d`.
(On Linux, `host.docker.internal` works because `docker-compose.yml` maps it to the host gateway.)

## Safety notes

- Each gate validates every argument (plain numbers, plain names, allowlists) and has no way to run an arbitrary command.
- Quitting a process works only on **your** processes, never the desktop session, `sshd` or the panel's own container.
- Docker start/stop/restart refuses the Dashling container itself.
- Apps and shortcuts run only if they exactly match your allowlist (macOS) or exist in your shortcuts folder (Linux, Windows), which the container cannot edit.
- The background jobs read local data only and write small files into `~/.dashling/cache/`.
