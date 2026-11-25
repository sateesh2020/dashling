#!/bin/bash
# One entry point for everything in this folder (macOS and Linux).   ./host/dashling.sh help
# On Windows use  host\windows\dashling.ps1  instead.
set -euo pipefail
cd "$(dirname "$0")"
DEST="$HOME/.dashling"

case "$(uname -s)" in
  Darwin) OSD=macos ;;
  Linux)  OSD=linux ;;
  *) echo "Unsupported OS for this script. On Windows run:  powershell -ExecutionPolicy Bypass -File host\\windows\\dashling.ps1 setup"; exit 1 ;;
esac

usage() { cat <<U
Dashling host helper ($OSD). Usage: ./host/dashling.sh <command>

  setup        first-time install (SSH key, gate script, helpers, background jobs). Asks before changing anything.
  update       after \`git pull\`: refresh the gate script, helpers and background jobs.
               Does NOT touch your SSH key. Run this whenever host/ changed.
  helpers      $( [ "$OSD" = macos ] && echo "rebuild the small tools (fans, temperatures, power, brightness, calendar) + calendar agent" || echo "check which optional tools are installed (playerctl, brightnessctl, imagemagick ...)" )
  sync         only (re)install the GitHub/GitLab + AI-usage background job
  statusline   add Claude Code's plan-limit status-line hook   (--remove to undo)
  status       show what is installed and whether it is current
  uninstall    remove the SSH key line, background jobs and ~/.dashling (asks first)
U
}

ok()   { printf '  \033[32mok\033[0m   %s\n' "$1"; }
warn() { printf '  \033[33mmiss\033[0m %s\n' "$1"; }

jobs_loaded() {      # is the named background job registered with the OS scheduler?
  if [ "$OSD" = macos ]; then local j; j=$(launchctl list 2>/dev/null || true); [[ "$j" == *"dev.dashling.$1"* ]]
  else
    case "$1" in
      contrib) { systemctl --user is-enabled dashling-sync.timer >/dev/null 2>&1; } || { crontab -l 2>/dev/null | grep -q dashling-sync; } ;;
      *) return 0 ;;
    esac
  fi
}

status() {
  echo "Dashling on this machine ($OSD)"
  [ -x "$DEST/dashling-gate.sh" ] && { cmp -s "$OSD/dashling-gate.sh" "$DEST/dashling-gate.sh" && ok "gate script (up to date)" || warn "gate script is OLD: run ./host/dashling.sh update"; } || warn "gate script not installed: run setup"
  grep -q "dashling-gate" ~/.ssh/authorized_keys 2>/dev/null && ok "SSH key line in authorized_keys" || warn "no SSH key line: run setup"
  if [ "$OSD" = macos ]; then
    for t in smcfan dispctl calevents; do [ -x "$DEST/$t" ] && ok "helper: $t" || warn "helper missing: $t (run helpers)"; done
    for j in contrib calendar; do jobs_loaded "$j" && ok "background job: $j" || warn "background job not loaded: $j"; done
  else
    jobs_loaded contrib && ok "background sync (systemd timer or cron)" || warn "background sync not installed (run sync)"
    for t in playerctl brightnessctl pactl jq; do command -v "$t" >/dev/null 2>&1 && ok "tool: $t" || warn "optional tool missing: $t (run helpers for what it unlocks)"; done
  fi
  [ -f "$HOME/.claude/settings.json" ] && grep -q "claude-statusline" "$HOME/.claude/settings.json" 2>/dev/null && ok "Claude status-line hook" || warn "Claude status-line hook not installed (optional)"
  echo "  files in $DEST/photos: $(ls "$DEST/photos" 2>/dev/null | wc -l | tr -d ' ')   shortcuts: $(ls "$DEST/shortcuts" 2>/dev/null | wc -l | tr -d ' ') files, $(wc -l < "$DEST/shortcuts.allow" 2>/dev/null | tr -d ' ' || echo 0) allowlist lines   apps.allow: $(wc -l < "$DEST/apps.allow" 2>/dev/null | tr -d ' ' || echo 0) lines"
}

update() {
  mkdir -p "$DEST"
  install -m 755 "$OSD/dashling-gate.sh" "$DEST/dashling-gate.sh" && ok "gate script refreshed"
  "./$OSD/install-helpers.sh"
  "./$OSD/install-jobs.sh"
  echo "Done. If the panel's server code changed too, rebuild it:  docker compose build && docker compose up -d"
}

uninstall() {
  echo "This removes: the dashling-container line in ~/.ssh/authorized_keys, the background jobs, and $DEST (including photos/ and your allowlists)."
  read -r -p "Continue? [y/N] " a; [[ "$a" == [yY]* ]] || exit 1
  if [ -f ~/.ssh/authorized_keys ]; then t=$(mktemp); grep -v dashling-gate ~/.ssh/authorized_keys > "$t" || true; cat "$t" > ~/.ssh/authorized_keys; rm -f "$t"; fi
  if [ "$OSD" = macos ]; then
    for j in contrib calendar; do launchctl bootout "gui/$(id -u)/dev.dashling.$j" 2>/dev/null || true; rm -f "$HOME/Library/LaunchAgents/dev.dashling.$j.plist"; done
  else
    systemctl --user disable --now dashling-sync.timer 2>/dev/null || true
    rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/dashling-sync."{service,timer}
    command -v crontab >/dev/null 2>&1 && { crontab -l 2>/dev/null | grep -v dashling-sync | crontab - 2>/dev/null || true; }
  fi
  ./common/install-claude-statusline.sh --remove 2>/dev/null || true
  rm -rf "$DEST"; echo "Removed."
}

case "${1:-help}" in
  setup)      exec "./$OSD/setup.sh" ;;
  update)     update ;;
  helpers)    exec "./$OSD/install-helpers.sh" ;;
  sync)       exec "./$OSD/install-jobs.sh" ;;
  statusline) shift; exec ./common/install-claude-statusline.sh "$@" ;;
  status)     status ;;
  uninstall)  uninstall ;;
  help|-h|--help) usage ;;
  *) usage; exit 1 ;;
esac
