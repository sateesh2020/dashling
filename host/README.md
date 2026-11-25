# `host/`: everything that runs on your Mac

The Dashling container never runs anything on your Mac directly. It connects over SSH with a key that is locked to **one
script** (`dashling-gate.sh`), and that script only knows the fixed commands listed in it. Everything else in this folder
either installs that script, builds small helpers it calls, or runs in the background to collect data.

**You normally only need one command:**

```bash
./host/dashling.sh setup     # first time
./host/dashling.sh update    # after every `git pull`
./host/dashling.sh status    # what is installed, and is it current?
```

## Why not one big script that runs everything through the gate?

The gate is the security boundary: the SSH key can run *only* it, and it only answers a short list of read or control
commands. If the gate could run installers, rebuild helpers or edit launch agents, anyone who got hold of the container's
key could change what runs on your Mac. So installing stays a manual step you run yourself, and `dashling.sh` is the
single front door for it.

## What each file is

| File | What it is | When it runs |
|---|---|---|
| **`dashling.sh`** | The one entry point: `setup`, `update`, `helpers`, `sync`, `statusline`, `status`, `uninstall`. | You run it. |
| **`dashling-gate.sh`** | The only thing the container's SSH key may run. Stats, fans, temperatures, power, brightness, calendar, Docker, photos, media keys, volume, app launcher, Shortcuts, process quit. Anything not listed is refused. | On every request from the panel. Installed to `~/.dashling/`. |
| `setup-mac.sh` | First-time install: copies the gate, creates a dedicated SSH key (private half goes only into the Docker volume), adds one restricted line to `~/.ssh/authorized_keys`, then runs the installers below. Asks before each change. | Once. |
| `install-fans.sh` | Builds the three helpers below into `~/.dashling/`, creates `shortcuts.allow`, and installs the calendar background agent. No sudo. | By `setup` / `update` / `helpers`. |
| `install-contrib-job.sh` | Installs the 2-minute background job (`dev.dashling.contrib`) that runs the two sync scripts below. | By `setup` / `update` / `sync`. |
| `install-claude-statusline.sh` | Optional. Adds a status-line hook to Claude Code so the AI page can show plan limits. Backs up `~/.claude/settings.json`; `--remove` undoes it. | `./host/dashling.sh statusline`. |
| `smcfan.c` | Tiny read-only C program that reads the Mac's SMC: **fan speed, core temperatures, power draw**. No root needed. | Called by the gate. |
| `dispctl.c` | Gets and sets the **built-in display brightness** (uses a private Apple framework, so best-effort). | Called by the gate. |
| `calevents.swift` + `calevents-Info.plist` | Reads your **upcoming Calendar events**. The plist is what lets macOS show the Calendar permission prompt. | By the calendar agent every 5 minutes. |
| `contrib-sync.sh` | Collects daily GitHub/GitLab contribution counts using the `gh` and `glab` logins already on your Mac. Stores counts only, never tokens. | Background job, every 2 minutes. |
| `ai-usage-sync.sh` | Collects Claude Code and Codex usage (token counts, model names, timestamps) from their local logs. Message text is never kept. | Background job, with the one above. |
| `claude-statusline.sh` | The status-line hook itself; saves the 5-hour and weekly plan percentages. | By Claude Code, if you installed the hook. |

## What gets created on your Mac

Everything lives under `~/.dashling/` except two launch agents and one line in `authorized_keys`.

```
~/.dashling/
  dashling-gate.sh                 the only command the SSH key can run
  smcfan  dispctl  calevents       the compiled helpers
  apps.allow                       apps the panel may open (one name per line, edit freely)
  shortcuts.allow                  Shortcuts the panel may run, e.g. "Dashling DND", "Dashling Lock"
  photos/                          put pictures (or a symlink to a folder) here for the photo frame
  cache/                           data written by the background jobs (calendar, contributions, AI usage)
~/Library/LaunchAgents/dev.dashling.contrib.plist     GitHub/GitLab + AI usage, every 2 minutes
~/Library/LaunchAgents/dev.dashling.calendar.plist    calendar events, every 5 minutes
~/.ssh/authorized_keys           one line: command="~/.dashling/dashling-gate.sh",restrict ...
```

## Optional one-time steps in macOS

- **Do Not Disturb button:** macOS doesn't let scripts toggle Focus. Create a Shortcut named `Dashling DND` (action:
  *Set Focus*) in the Shortcuts app. Its name must be a line in `shortcuts.allow`.
- **Lock button:** it starts the screen saver, which locks the Mac if *Require password* is on in Lock Screen
  settings. For a true lock, make a Shortcut named `Dashling Lock` and the button uses that first.
- **Calendar:** the first run of the calendar agent may show a permission prompt. Click Allow.
- **Remote Login** must be on (System Settings > General > Sharing) so the container can connect.

## Updating and removing

```bash
git pull && ./host/dashling.sh update      # new gate script, rebuilt helpers, reloaded jobs (SSH key untouched)
docker compose build && docker compose up -d   # if server/ or web/ changed too
./host/dashling.sh uninstall               # removes the key line, both background jobs and ~/.dashling (asks first)
```

If you rebuild the container yourself, pass the connection: `HOST_SSH=you@host.docker.internal docker compose up -d`.

## Safety notes

- The gate validates every argument (plain numbers, plain names, allowlists) and has no way to run an arbitrary command.
- Quitting a process works only on **your** processes, never the desktop, `sshd` or the panel's own container.
- Docker start/stop/restart refuses the Dashling container itself.
- Shortcuts and apps run only if their exact name is in your allowlist files, which the container cannot edit.
- The background jobs read local data only and write small files into `~/.dashling/cache/`.
