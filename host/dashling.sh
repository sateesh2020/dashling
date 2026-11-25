#!/bin/bash
# One entry point for everything in this folder.   ./host/dashling.sh help
set -euo pipefail
cd "$(dirname "$0")"
DEST="$HOME/.dashling"; UID_=$(id -u)

usage() { cat <<'U'
Dashling Mac helper. Usage: ./host/dashling.sh <command>

  setup        first-time install (SSH key, gate script, helpers, background jobs). Asks before changing anything.
  update       after `git pull`: refresh the gate script, rebuild the helpers, reload the background jobs.
               Does NOT touch your SSH key. Run this whenever host/ changed.
  helpers      only rebuild the small tools (fans, temperatures, power, brightness, calendar) + calendar agent
  sync         only (re)install the GitHub/GitLab + AI-usage background job
  statusline   add Claude Code's plan-limit status-line hook   (--remove to undo)
  status       show what is installed and whether it is current
  uninstall    remove the SSH key line, background jobs and ~/.dashling (asks first)
U
}

ok()   { printf '  \033[32mok\033[0m   %s\n' "$1"; }
warn() { printf '  \033[33mmiss\033[0m %s\n' "$1"; }

status() {
  echo "Dashling on this Mac"
  [ -x "$DEST/dashling-gate.sh" ] && { cmp -s dashling-gate.sh "$DEST/dashling-gate.sh" && ok "gate script (up to date)" || warn "gate script is OLD: run ./host/dashling.sh update"; } || warn "gate script not installed: run setup"
  grep -q "dashling-gate" ~/.ssh/authorized_keys 2>/dev/null && ok "SSH key line in authorized_keys" || warn "no SSH key line: run setup"
  for t in smcfan dispctl calevents; do [ -x "$DEST/$t" ] && ok "helper: $t" || warn "helper missing: $t (run helpers)"; done
  jobs=$(launchctl list 2>/dev/null || true)       # captured first: grep -q closing the pipe early would trip pipefail
  for j in contrib calendar; do [[ "$jobs" == *"dev.dashling.$j"* ]] && ok "background job: $j" || warn "background job not loaded: $j"; done
  [ -f "$HOME/.claude/settings.json" ] && grep -q "claude-statusline" "$HOME/.claude/settings.json" 2>/dev/null && ok "Claude status-line hook" || warn "Claude status-line hook not installed (optional)"
  echo "  files in $DEST/photos: $(ls "$DEST/photos" 2>/dev/null | wc -l | tr -d ' ')   shortcuts.allow: $(wc -l < "$DEST/shortcuts.allow" 2>/dev/null | tr -d ' ' || echo 0) lines   apps.allow: $(wc -l < "$DEST/apps.allow" 2>/dev/null | tr -d ' ' || echo 0) lines"
}

update() {
  mkdir -p "$DEST"
  install -m 755 dashling-gate.sh "$DEST/dashling-gate.sh" && ok "gate script refreshed"
  ./install-fans.sh
  ./install-contrib-job.sh
  echo "Done. If the panel's server code changed too, rebuild it:  docker compose build && docker compose up -d"
}

uninstall() {
  echo "This removes: the dashling-container line in ~/.ssh/authorized_keys, both background jobs, and $DEST (including photos/ and your allowlists)."
  read -r -p "Continue? [y/N] " a; [[ "$a" == [yY]* ]] || exit 1
  sed -i '' -e '/dashling-gate/d' ~/.ssh/authorized_keys 2>/dev/null || true
  for j in contrib calendar; do launchctl bootout "gui/$UID_/dev.dashling.$j" 2>/dev/null || true; rm -f "$HOME/Library/LaunchAgents/dev.dashling.$j.plist"; done
  ./install-claude-statusline.sh --remove 2>/dev/null || true
  rm -rf "$DEST"; echo "Removed."
}

case "${1:-help}" in
  setup)      exec ./setup-mac.sh ;;
  update)     update ;;
  helpers)    exec ./install-fans.sh ;;
  sync)       exec ./install-contrib-job.sh ;;
  statusline) shift; exec ./install-claude-statusline.sh "$@" ;;
  status)     status ;;
  uninstall)  uninstall ;;
  help|-h|--help) usage ;;
  *) usage; exit 1 ;;
esac
