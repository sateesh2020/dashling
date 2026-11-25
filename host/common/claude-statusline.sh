#!/bin/bash
# Dashling hook for Claude Code's status line. Claude Code runs this after each assistant message and pipes a JSON
# description of the session to stdin. On Claude.ai Pro/Max/Ultra plans that JSON includes `rate_limits` (5-hour and
# 7-day usage %, with reset times). We save just those numbers to ~/.dashling/cache/claude-limits.json and print a
# short status line. If you already had a status line, the installer wraps it: it receives the same stdin and its
# output is printed instead, so your status line looks exactly as before.
#   claude-statusline.sh [--wrap "<previous status line command>"]
# Always exits 0 (a non-zero exit would blank the status line).
export PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin
OUT="$HOME/.dashling/cache/claude-limits.json"
raw=$(cat)
line=""
if command -v jq >/dev/null 2>&1; then
  mkdir -p "$(dirname "$OUT")" 2>/dev/null
  tmp="$OUT.tmp.$$"
  if printf '%s' "$raw" | jq -c --argjson now "$(date +%s)" '
      select(.rate_limits != null)
      | def w($k): (.rate_limits[$k] // null) | if . == null then null else {pct: .used_percentage, reset: .resets_at} end;
        {updated: $now, five_hour: w("five_hour"), seven_day: w("seven_day")}' > "$tmp" 2>/dev/null && [ -s "$tmp" ]; then
    mv "$tmp" "$OUT"
  else rm -f "$tmp"; fi
  line=$(printf '%s' "$raw" | jq -r '[ (.model.display_name // empty),
      (if .rate_limits.five_hour.used_percentage != null then "5h \(.rate_limits.five_hour.used_percentage | floor)%" else empty end),
      (if .rate_limits.seven_day.used_percentage != null then "7d \(.rate_limits.seven_day.used_percentage | floor)%" else empty end) ] | join(" · ")' 2>/dev/null)
fi
if [ "${1:-}" = "--wrap" ] && [ -n "${2:-}" ]; then
  printf '%s' "$raw" | /bin/sh -c "$2" 2>/dev/null
else
  printf '%s\n' "$line"
fi
exit 0
