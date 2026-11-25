#!/bin/bash
# Optional: builds the small read-only Mac helpers into ~/.dashling (no sudo):
#   smcfan    fan speed, core temperatures, power draw   (host/smcfan.c)
#   dispctl   display brightness get/set                  (host/dispctl.c, private DisplayServices API)
#   calevents upcoming Calendar events                    (host/calevents.swift; macOS asks for Calendar access once)
# Needs the Xcode command line tools. Undo: rm ~/.dashling/{smcfan,dispctl,calevents}
set -euo pipefail
cd "$(dirname "$0")"; mkdir -p "$HOME/.dashling"
clang -O2 -o "$HOME/.dashling/smcfan" smcfan.c -framework IOKit && echo "built smcfan"
clang -O2 -o "$HOME/.dashling/dispctl" dispctl.c -framework CoreGraphics -framework CoreFoundation && echo "built dispctl"
swiftc -O -o "$HOME/.dashling/calevents" calevents.swift -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker calevents-Info.plist && codesign -s - --force --identifier dev.dashling.calevents "$HOME/.dashling/calevents" 2>/dev/null && echo "built calevents"
# Shortcuts the panel may run (one exact name per line). Create these in the Shortcuts app, e.g. "Dashling DND" = Set Focus > Do Not Disturb.
[ -f "$HOME/.dashling/shortcuts.allow" ] || printf 'Dashling DND\nDashling Lock\n' > "$HOME/.dashling/shortcuts.allow"
"$HOME/.dashling/smcfan" | head -2

# Calendar: macOS only lets a login-session process read it, so a small agent refreshes ~/.dashling/cache/calendar.txt every 5 min.
# The first run makes macOS ask "calevents would like to access your calendar": click Allow.
# Undo: launchctl bootout gui/$(id -u)/dev.dashling.calendar; rm ~/Library/LaunchAgents/dev.dashling.calendar.plist
LABEL=dev.dashling.calendar; PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"; mkdir -p "$HOME/.dashling/cache" "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>-c</string><string>$HOME/.dashling/calevents > $HOME/.dashling/cache/calendar.tmp &amp;&amp; mv $HOME/.dashling/cache/calendar.tmp $HOME/.dashling/cache/calendar.txt</string></array>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST" && echo "calendar agent installed"
