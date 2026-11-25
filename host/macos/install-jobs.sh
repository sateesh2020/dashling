#!/bin/bash
# Installs the background job (every 2 min) that keeps GitHub/GitLab data and AI-tool usage fresh.
# What it does: copies contrib-sync.sh and ai-usage-sync.sh to ~/.dashling/, writes ~/Library/LaunchAgents/dev.dashling.contrib.plist,
# loads it with launchctl and runs it once. It stores no tokens.
# Undo: launchctl bootout gui/$(id -u)/dev.dashling.contrib; rm ~/Library/LaunchAgents/dev.dashling.contrib.plist
set -euo pipefail
cd "$(dirname "$0")"
DEST="$HOME/.dashling"; LABEL="dev.dashling.contrib"; PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$DEST/cache" "$HOME/Library/LaunchAgents"
install -m 755 ../common/contrib-sync.sh "$DEST/contrib-sync.sh"
install -m 755 ../common/ai-usage-sync.sh "$DEST/ai-usage-sync.sh"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$DEST/contrib-sync.sh</string></array>
  <key>StartInterval</key><integer>120</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardErrorPath</key><string>$DEST/cache/sync.log</string>
</dict></plist>
PL
chmod 644 "$PLIST"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true      # replace an older copy
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Background sync installed (runs now, then every 2 minutes; the first AI-usage scan of large logs can take a few minutes)."
