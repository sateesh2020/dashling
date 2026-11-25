#!/bin/bash
# Dashling gate: the ONLY thing the container's SSH key may run on this Mac.
# Installed via authorized_keys as: command="~/.dashling/dashling-gate.sh",restrict ...
# Read it, it is short on purpose. Anything not listed below is refused.
set -u
export PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin
cmd="${SSH_ORIGINAL_COMMAND:-}"

# Which app owns playback right now. Spotify/Music are driven directly (accurate position);
# anything else (Chrome/Safari tabs, VLC, ...) returns "" and goes through system Now Playing.
active_app() {
  b=$(nowplaying-cli get clientBundleIdentifier 2>/dev/null)
  case "$b" in
    com.spotify.client) echo Spotify ;;
    com.apple.Music)    echo Music ;;
    ""|null)            pick_player ;;
    *)                  echo "" ;;
  esac
}

# The app to control: whichever of Spotify/Music is playing, else the first one running.
# (pgrep first, because AppleScript `tell application` would otherwise launch it.)
pick_player() {
  first=""
  for a in Spotify Music; do
    pgrep -xq "$a" || continue
    [ -z "$first" ] && first="$a"
    [ "$(osascript -e "tell application \"$a\" to player state as text" 2>/dev/null)" = "playing" ] && { echo "$a"; return; }
  done
  echo "$first"
}

case "$cmd" in
  stats)
    name=$(scutil --get ComputerName 2>/dev/null)
    echo "name=${name:-Mac}"
    echo "cores=$(sysctl -n hw.ncpu)"
    # live CPU split over a 1 s window. iostat costs ~0 CPU (top -l 2 burned ~1.3 s of CPU per call)
    iostat -n0 -c 2 -w 1 | awk 'END { printf "cpu_user=%s\ncpu_sys=%s\ncpu_idle=%s\n", $1, $2, $3 }'
    memtotal=$(sysctl -n hw.memsize)
    vm_stat | awk -v total="$memtotal" '
      /page size of/ {ps=$8}
      /Pages active/ {a=$3+0} /Pages wired down/ {w=$4+0}
      /occupied by compressor/ {c=$5+0}
      END { printf "mem_total=%d\nmem_used=%d\n", total, (a+w+c)*ps }'
    df -k /System/Volumes/Data 2>/dev/null | awk 'NR==2 {printf "disk_total=%d\ndisk_used=%d\n", $2*1024, $3*1024}'
    pmset -g batt 2>/dev/null | awk '/InternalBattery/ {
      for(i=1;i<=NF;i++){ if($i ~ /%;?$/){gsub(/[%;]/,"",$i); print "batt_pct=" $i}
      if($i ~ /charging;?|charged;?|discharging;?/){gsub(/;/,"",$i); print "batt_state=" $i}
      if($i ~ /^[0-9]+:[0-9][0-9]$/){print "batt_time=" $i} } }'
    # cumulative bytes on physical interfaces (en*); the server turns this into a rate
    netstat -ib 2>/dev/null | awk '$1 ~ /^en[0-9]+$/ && $3 ~ /^<Link/ && NF>=10 {rx+=$(NF-4); tx+=$(NF-1)} END {printf "net_rx=%d\nnet_tx=%d\n", rx, tx}'
    echo "load=$(sysctl -n vm.loadavg | tr -d '{}' | awk '{print $1" "$2" "$3}')"
    # top processes: cpu|mem|pid|mine(1 = yours, can be quit from the panel)|name
    ps -Aceo pcpu=,pmem=,pid=,user=,comm= -r 2>/dev/null | awk -v me="$(id -un)" '$5!="ps" && $5!="top" && $5!="sed" && $5!="awk" && $5!="sshd-session" {c=$1; m=$2; p=$3; u=$4; $1=$2=$3=$4=""; sub(/^ +/,""); n++; if(n<=6) printf "proc%d=%s|%s|%s|%d|%s\n", n, c, m, p, (u==me), $0}'
    echo "boot=$(sysctl -n kern.boottime | awk -F'[= ,]+' '{print $3}')"
    osascript -e 'output volume of (get volume settings)' 2>/dev/null | sed 's/^/volume=/'
    ;;
  fans)
    # fan RPM straight from the SMC, read-only, no root. ~/.dashling/smcfan is built from host/smcfan.c by host/install-fans.sh
    if [ -x "$HOME/.dashling/smcfan" ]; then "$HOME/.dashling/smcfan"; else echo "fan_setup=1"; fi
    ;;
  temps)
    if [ -x "$HOME/.dashling/smcfan" ]; then "$HOME/.dashling/smcfan" temps; else echo "temp_setup=1"; fi
    ;;
  power)
    # watts from the SMC + battery health from the battery's own registry entry (all read-only)
    [ -x "$HOME/.dashling/smcfan" ] && "$HOME/.dashling/smcfan" power
    ioreg -rn AppleSmartBattery 2>/dev/null | awk '
      /^      "(CycleCount|DesignCapacity|NominalChargeCapacity|Temperature)" = [0-9]+$/ { k=$1; gsub(/"/,"",k); print tolower(k) "=" $3 }
      /^      "ExternalConnected" = / { print "ac=" ($3=="Yes" ? 1 : 0) }
      /^      "AdapterDetails" = / { if (match($0, /"Watts"=[0-9]+/)) print "adapter_rated_w=" substr($0, RSTART+8, RLENGTH-8) }'
    ;;
  display-get)
    [ -x "$HOME/.dashling/dispctl" ] && "$HOME/.dashling/dispctl" get || echo "brightness_none=1"
    ;;
  display-set\ [0-9]|display-set\ [0-9][0-9]|display-set\ 100)
    "$HOME/.dashling/dispctl" set "${cmd#display-set }" && echo ok
    ;;
  lock)
    # starts the screen saver; the Mac locks if "Require password" is on in System Settings > Lock Screen
    open -a ScreenSaverEngine && echo ok
    ;;
  shortcut\ *)
    # run a Shortcut you chose: its exact name must be a line in ~/.dashling/shortcuts.allow
    name="${cmd#shortcut }"
    if [[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9\ ._-]{0,60}$ ]] && grep -Fxq -- "$name" "$HOME/.dashling/shortcuts.allow" 2>/dev/null; then
      shortcuts run "$name" </dev/null >/dev/null 2>&1 && echo ok || { echo "shortcut failed or missing" >&2; exit 1; }
    else echo "shortcut not in allowlist" >&2; exit 126; fi
    ;;
  shortcuts)
    cat "$HOME/.dashling/shortcuts.allow" 2>/dev/null
    ;;
  calendar)
    # written every 5 min by the dev.dashling.calendar login-session agent (calendar permission can't be granted over SSH)
    cat "$HOME/.dashling/cache/calendar.txt" 2>/dev/null || echo "cal_setup=1"
    ;;
  docker-ps)
    docker ps -a --format '{{.Names}}|{{.State}}|{{.Status}}|{{.Image}}' 2>/dev/null || echo "docker_down=1"
    ;;
  docker-act\ *)
    # only start/stop/restart of a plain container name; never the Dashling container itself
    if [[ "$cmd" =~ ^docker-act\ (start|stop|restart)\ ([A-Za-z0-9][A-Za-z0-9_.-]{0,62})$ ]]; then
      case "${BASH_REMATCH[2]}" in *dashling*) echo "refusing to touch the panel's own container" >&2; exit 126 ;; esac
      docker "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" >/dev/null && echo ok
    else echo "bad docker command" >&2; exit 126; fi
    ;;
  photo-list)
    # photos you put (or symlink) in ~/.dashling/photos; names only
    for f in "$HOME/.dashling/photos"/*; do case "${f##*/}" in *.[jJ][pP][gG]|*.[jJ][pP][eE][gG]|*.[pP][nN][gG]|*.[wW][eE][bB][pP]|*.[hH][eE][iI][cC]) [ -f "$f" ] && printf '%s\n' "${f##*/}" ;; esac; done | head -300
    ;;
  photo-get\ *)
    # one photo from that folder, shrunk to max 1600px JPEG so it is light on the phone. Plain file names only: no paths.
    shopt -s nocasematch
    name="${cmd#photo-get }"
    if [[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9\ ._\(\)-]{0,100}\.(jpe?g|png|webp|heic)$ ]] && [ -f "$HOME/.dashling/photos/$name" ]; then
      tmp=$(mktemp "${TMPDIR:-/tmp}/dashphoto.XXXXXX"); sips -s format jpeg -s formatOptions 72 -Z 1600 "$HOME/.dashling/photos/$name" --out "$tmp.jpg" >/dev/null 2>&1 && cat "$tmp.jpg"
      rm -f "$tmp" "$tmp.jpg"
    else echo "no such photo" >&2; exit 1; fi
    ;;
  proc-kill\ *|proc-kill9\ *)
    # only YOUR processes, never the desktop or the SSH session; plain quit (TERM) or force (KILL)
    if [[ "$cmd" =~ ^proc-kill(9)?\ ([0-9]{2,7})$ ]]; then
      pid="${BASH_REMATCH[2]}"; sig=TERM; [ -n "${BASH_REMATCH[1]}" ] && sig=KILL
      owner=$(ps -o user= -p "$pid" 2>/dev/null | tr -d ' ')
      pname=$(ps -o comm= -p "$pid" 2>/dev/null); pname=${pname##*/}
      [ -n "$owner" ] && [ "$owner" = "$(id -un)" ] || { echo "not your process" >&2; exit 126; }
      case "$pname" in launchd|WindowServer|loginwindow|Dock|Finder|SystemUIServer|sshd|sshd-session|kernel_task|dashling*) echo "protected process" >&2; exit 126 ;; esac
      kill -"$sig" "$pid" && echo ok
    else echo "bad pid" >&2; exit 126; fi
    ;;
  volume-set\ [0-9]|volume-set\ [0-9][0-9]|volume-set\ 100)
    osascript -e "set volume output volume ${cmd#volume-set }" && echo ok
    ;;
  media\ playpause|media\ next|media\ prev)
    app=$(active_app)
    if [ -n "$app" ]; then
      case "${cmd#media }" in
        playpause) osascript -e "tell application \"$app\" to playpause" ;;
        next)      osascript -e "tell application \"$app\" to next track" ;;
        prev)      osascript -e "tell application \"$app\" to previous track" ;;
      esac && echo ok
    else
      # no Spotify/Music running: system Now Playing (may be blocked on newer macOS)
      case "${cmd#media }" in
        playpause) nowplaying-cli togglePlayPause ;;
        next)      nowplaying-cli next ;;
        prev)      nowplaying-cli previous ;;
      esac && echo ok
    fi
    ;;
  media-seek\ [0-9]|media-seek\ [0-9][0-9]|media-seek\ [0-9][0-9][0-9]|media-seek\ [0-9][0-9][0-9][0-9]|media-seek\ [0-9][0-9][0-9][0-9][0-9])
    app=$(active_app)
    if [ -n "$app" ]; then osascript -e "tell application \"$app\" to set player position to ${cmd#media-seek }" && echo ok
    else nowplaying-cli seek "${cmd#media-seek }" && echo ok; fi
    ;;
  nowplaying)
    # Spotify / Music are asked directly (accurate position and play state). Anything else
    # falls back to the system Now Playing info, which macOS 15.4+ may block.
    app=$(active_app)
    out=""
    if [ -n "$app" ]; then
      [ "$app" = "Spotify" ] && extra='& linefeed & (artwork url of t)' || extra='& linefeed & ""'
      out=$(osascript 2>/dev/null <<AS
tell application "$app"
  if player state is stopped then return ""
  set t to current track
  set d to duration of t
  if "$app" is "Spotify" then set d to d / 1000
  return (name of t) & linefeed & (artist of t) & linefeed & (album of t) & linefeed & d & linefeed & player position & linefeed & (player state as text) $extra
end tell
AS
)
    fi
    if [ -n "$out" ]; then
      [ "$app" = "Spotify" ] && echo "src=com.spotify.client" || echo "src=com.apple.Music"
      sed -n 1p <<<"$out" | sed 's/^/title=/'; sed -n 2p <<<"$out" | sed 's/^/artist=/'; sed -n 3p <<<"$out" | sed 's/^/album=/'
      sed -n 4p <<<"$out" | sed 's/^/duration=/'; sed -n 5p <<<"$out" | sed 's/^/elapsed=/'
      st=$(sed -n 6p <<<"$out"); [ "$st" = "playing" ] && echo "rate=1" || echo "rate=0"
      sed -n 7p <<<"$out" | sed 's/^/arturl=/'
    else
      np=$(nowplaying-cli get title artist album duration elapsedTime playbackRate 2>/dev/null)
      nv() { v=$(sed -n "${1}p" <<<"$np"); [ "$v" = "null" ] && v=""; printf '%s' "$v"; }
      if [ -n "$(nv 1)" ]; then
        echo "src=$(nowplaying-cli get clientBundleIdentifier 2>/dev/null)"; echo "title=$(nv 1)"; echo "artist=$(nv 2)"; echo "album=$(nv 3)"
        echo "duration=$(nv 4)"; echo "elapsed=$(nv 5)"; echo "rate=$(nv 6)"
      fi
    fi
    ;;
  artwork)
    nowplaying-cli get artworkData 2>/dev/null | head -c 6000000
    ;;
  mute)
    osascript -e 'set volume output muted (not (output muted of (get volume settings)))' && echo ok
    ;;
  sleep-display)
    pmset displaysleepnow && echo ok
    ;;
  apps)
    # the list of apps YOU allow, one per line. Edit ~/.dashling/apps.allow on this Mac.
    cat "$HOME/.dashling/apps.allow" 2>/dev/null
    ;;
  open-app\ *)
    name="${cmd#open-app }"
    # must be a plain app name AND exactly match a line in your allowlist
    if [[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9\ ._-]{0,40}$ ]] && grep -Fxq -- "$name" "$HOME/.dashling/apps.allow" 2>/dev/null; then
      open -a "$name" && echo ok
    else
      echo "app not in allowlist" >&2; exit 126
    fi
    ;;
  ai-usage)
    # AI coding tool usage (token counts only) from ai-usage-sync.sh, plus live plan limits saved by the Claude status-line hook
    d="$HOME/.dashling/cache"
    base=$(cat "$d/ai.json" 2>/dev/null); [ -n "$base" ] || base='{}'
    lim=$(cat "$d/claude-limits.json" 2>/dev/null); [ -n "$lim" ] || lim=null
    if [ "$base" = '{}' ] && [ "$lim" = null ]; then
      { cat "$d/ai.err" 2>/dev/null | tr '\n' ' '; echo "(no usage data yet; the first scan can take a few minutes)"; } >&2; exit 1
    fi
    printf '%s' "$base" | jq -c --argjson l "$lim" --argjson now "$(date +%s)" \
      '.claude = ((.claude // {}) + {limits: ($l | if . == null then null else with_entries(select(.key == "updated" or (.value != null and .value.reset > $now))) end)})
       | with_entries(.value |= (if type == "object" and ((.limits // null) | type) == "object" then .limits |= with_entries(select(.key == "updated" or (.value != null and .value.reset > $now))) else . end))'
    ;;
  gh-contrib|gl-contrib|gh-reviews|gl-reviews)
    # served from ~/.dashling/cache, written by the contrib-sync background job that runs in your desktop session
    # (gh/glab keep their logins in the macOS keychain, which is locked over SSH)
    case "$cmd" in gh-contrib) f=gh.json; e=gh.err ;; gl-contrib) f=gl.txt; e=gl.err ;; gh-reviews) f=gh-reviews.json; e=gh-reviews.err ;; *) f=gl-reviews.json; e=gl-reviews.err ;; esac
    d="$HOME/.dashling/cache"
    if [ -s "$d/$f" ]; then
      cat "$d/$f"
    else
      { cat "$d/$e" 2>/dev/null | tr '\n' ' '; echo "(no cached data yet; the sync job runs every 15 minutes)"; } >&2; exit 1
    fi
    ;;
  *)
    echo "refused" >&2
    exit 126
    ;;
esac
