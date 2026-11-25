#!/bin/bash
# Installs the background job (every 2 min) that keeps GitHub/GitLab data and AI-tool usage fresh.
# Uses a systemd USER timer when available, otherwise one crontab line. It stores no tokens.
# Undo: ./host/dashling.sh uninstall
set -euo pipefail
cd "$(dirname "$0")"
DEST="$HOME/.dashling"; mkdir -p "$DEST/cache"
install -m 755 ../common/contrib-sync.sh "$DEST/contrib-sync.sh"
install -m 755 ../common/ai-usage-sync.sh "$DEST/ai-usage-sync.sh"

if command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1; then
  U="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"; mkdir -p "$U"
  cat > "$U/dashling-sync.service" <<UNIT
[Unit]
Description=Dashling data sync (GitHub/GitLab contributions, AI usage)
[Service]
Type=oneshot
ExecStart=/bin/bash $DEST/contrib-sync.sh
StandardError=append:$DEST/cache/sync.log
UNIT
  cat > "$U/dashling-sync.timer" <<UNIT
[Unit]
Description=Run the Dashling data sync every 2 minutes
[Timer]
OnBootSec=1min
OnUnitActiveSec=2min
[Install]
WantedBy=timers.target
UNIT
  systemctl --user daemon-reload && systemctl --user enable --now dashling-sync.timer
  echo "Background sync installed as a systemd user timer (dashling-sync.timer)."
elif command -v crontab >/dev/null; then
  ( crontab -l 2>/dev/null | grep -v dashling-sync ; echo "*/2 * * * * /bin/bash $DEST/contrib-sync.sh >> $DEST/cache/sync.log 2>&1 # dashling-sync" ) | crontab -
  echo "Background sync installed as a cron job."
else
  echo "Neither systemd --user nor cron is available; run $DEST/contrib-sync.sh yourself if you want the Code/AI pages."
fi
