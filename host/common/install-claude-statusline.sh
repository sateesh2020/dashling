#!/bin/bash
# Adds Dashling's status-line hook to Claude Code so the AI page can show your 5-hour and weekly plan limits.
# What it does: copies claude-statusline.sh to ~/.dashling/, backs up ~/.claude/settings.json, and sets its "statusLine".
# If you already have a status line, it is kept and wrapped (same output as before). Nothing else in settings changes.
# Undo: ./install-claude-statusline.sh --remove   (restores your previous status line, or removes the key)
set -euo pipefail
cd "$(dirname "$0")"
S="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"; DEST="$HOME/.dashling"; OURS="$DEST/claude-statusline.sh"; PREV="$DEST/claude-statusline.prev.json"
command -v jq >/dev/null || { echo "jq is required (macOS 15+ has it; otherwise: brew install jq)"; exit 1; }
write() { local t; t=$(mktemp); cat > "$t"; jq -e . "$t" >/dev/null && cat "$t" > "$S"; rm -f "$t"; }   # validate, then write in place (keeps permissions)

if [ "${1:-}" = "--remove" ]; then
  [ -f "$S" ] || { echo "no settings file"; exit 0; }
  prev=$(cat "$PREV" 2>/dev/null || echo null)
  cp -p "$S" "$S.bak-dashling-remove"
  jq --argjson p "$prev" 'if $p == null then del(.statusLine) else .statusLine = $p end' "$S" | write
  echo "Status-line hook removed (settings backup: $S.bak-dashling-remove)."; exit 0
fi

mkdir -p "$DEST/cache"; install -m 755 claude-statusline.sh "$OURS"
[ -f "$S" ] || { mkdir -p "$(dirname "$S")"; echo '{}' > "$S"; }
jq -e . "$S" >/dev/null || { echo "$S is not valid JSON; not touching it."; exit 1; }
cur=$(jq -c '.statusLine // null' "$S")
if printf '%s' "$cur" | grep -q "claude-statusline.sh"; then echo "Hook already installed (script refreshed)."; exit 0; fi
cp -p "$S" "$S.bak-dashling"; printf '%s\n' "$cur" > "$PREV"
cmd="$OURS"
old=$(printf '%s' "$cur" | jq -r 'if type=="object" then (.command // empty) else empty end')
[ -n "$old" ] && cmd="$OURS --wrap $(printf '%q' "$old")"
jq --arg c "$cmd" '.statusLine = ((.statusLine // {}) + {type: "command", command: $c})' "$S" | write
echo "Status-line hook installed. Settings backup: $S.bak-dashling"
echo "Limits appear after your next Claude Code message (Pro/Max/Ultra plans only)."
