#!/bin/bash
# Dashling gate for LINUX: the ONLY thing the container's SSH key may run on this machine.
# Installed via authorized_keys as: command="~/.dashling/dashling-gate.sh",restrict ...
# It answers the same fixed commands as the macOS gate and prints the same key=value format, so the server is unchanged.
# Read it, it is short on purpose. Anything not listed below is refused.
set -u
export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/snap/bin
cmd="${SSH_ORIGINAL_COMMAND:-}"
SYS="${DASHLING_SYSFS:-/sys}"            # overridable only so the sensor code can be tested against a fake tree
D="$HOME/.dashling"

# An SSH session has no desktop environment of its own: borrow the logged-in user's session bus, audio and display.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
export DISPLAY="${DISPLAY:-:0}"
[ -z "${WAYLAND_DISPLAY:-}" ] && [ -S "$XDG_RUNTIME_DIR/wayland-0" ] && export WAYLAND_DISPLAY=wayland-0

have() { command -v "$1" >/dev/null 2>&1; }
batt() { for b in "$SYS"/class/power_supply/BAT*; do [ -d "$b" ] && { echo "$b"; return; }; done; }
rd() { cat "$1" 2>/dev/null; }

# default audio sink volume in percent
volume_get() {
  if have pactl; then pactl get-sink-volume @DEFAULT_SINK@ 2>/dev/null | grep -oE '[0-9]+%' | head -1 | tr -d %
  elif have amixer; then amixer sget Master 2>/dev/null | grep -oE '[0-9]+%' | head -1 | tr -d %; fi
}

case "$cmd" in
  stats)
    echo "name=$(hostname)"
    echo "cores=$(nproc)"
    # CPU split over a 1 s window from /proc/stat (user+nice, system+irq+softirq, idle+iowait)
    read -r _ u1 n1 s1 i1 w1 q1 sq1 _ < /proc/stat; sleep 1; read -r _ u2 n2 s2 i2 w2 q2 sq2 _ < /proc/stat
    awk -v u=$((u2+n2-u1-n1)) -v s=$((s2+q2+sq2-s1-q1-sq1)) -v i=$((i2+w2-i1-w1)) 'BEGIN { t=u+s+i; if (t<=0) t=1;
      printf "cpu_user=%.1f\ncpu_sys=%.1f\ncpu_idle=%.1f\n", u*100/t, s*100/t, i*100/t }'
    awk '/^MemTotal/ {t=$2} /^MemAvailable/ {a=$2} END { printf "mem_total=%.0f\nmem_used=%.0f\n", t*1024, (t-a)*1024 }' /proc/meminfo
    df -kP / 2>/dev/null | awk 'NR==2 {printf "disk_total=%.0f\ndisk_used=%.0f\n", $2*1024, $3*1024}'
    b=$(batt)
    if [ -n "$b" ]; then
      echo "batt_pct=$(rd "$b/capacity")"
      case "$(rd "$b/status")" in Charging) st=charging ;; Discharging) st=discharging ;; *) st=charged ;; esac
      echo "batt_state=$st"
      if [ "$st" = discharging ]; then   # time left = energy / power, as h:mm
        en=$(rd "$b/energy_now"); pw=$(rd "$b/power_now")
        [ -n "$en" ] && [ "${pw:-0}" -gt 0 ] 2>/dev/null && awk -v e="$en" -v p="$pw" 'BEGIN { m=int(e/p*60); printf "batt_time=%d:%02d\n", m/60, m%60 }'
      fi
    fi
    echo "load=$(cut -d' ' -f1-3 /proc/loadavg)"
    # top processes: cpu|mem|pid|mine(1 = yours, can be quit from the panel)|name
    ps -Aeo pcpu=,pmem=,pid=,user:32=,comm= --sort=-pcpu 2>/dev/null | awk -v me="$(id -un)" '$5!="ps" && $5!="awk" && $5!="sort" && $5!="sed" && $5!="sshd" && $5!~/^sshd-/ && $5!="dashling-gate.s" {c=$1; m=$2; p=$3; u=$4; $1=$2=$3=$4=""; sub(/^ +/,""); n++; if(n<=6) printf "proc%d=%s|%s|%s|%d|%s\n", n, c, m, p, (u==me), $0}'
    echo "boot=$(awk '/^btime/ {print $2}' /proc/stat)"
    v=$(volume_get); [ -n "$v" ] && echo "volume=$v"
    # cumulative bytes on real interfaces (not loopback, docker, bridges, virtual ethernet); the server turns this into a rate
    awk -F'[: ]+' 'NR>2 && $2!="lo" && $2!~/^(docker|br-|veth|virbr|tun|tap)/ {rx+=$3; tx+=$11} END {printf "net_rx=%.0f\nnet_tx=%.0f\n", rx, tx}' /proc/net/dev
    ;;

  fans)
    # fan RPM from the kernel's hwmon interface (needs lm-sensors-style drivers; most laptops/desktops have them)
    n=0
    for f in "$SYS"/class/hwmon/hwmon*/fan*_input; do [ -r "$f" ] || continue; n=$((n+1)); echo "fan$n=$(rd "$f")"; done
    if [ "$n" -eq 0 ]; then echo "fan_none=1"; fi
    ;;

  temps)
    # CPU core temperatures (Intel coretemp "Core N"; AMD k10temp Tctl/Tccd), GPU (amdgpu/nouveau, or nvidia-smi)
    pc=0; gpu=""
    for h in "$SYS"/class/hwmon/hwmon*; do
      name=$(rd "$h/name")
      case "$name" in
        coretemp|k10temp|zenpower|cpu_thermal|acpitz) ;;
        amdgpu|nouveau|radeon) t=$(rd "$h/temp1_input"); [ -n "$t" ] && gpu=$((t/1000)); continue ;;
        *) continue ;;
      esac
      for t in "$h"/temp*_input; do
        [ -r "$t" ] || continue
        lab=$(rd "${t%_input}_label")
        case "$name:$lab" in
          coretemp:Core*|k10temp:Tccd*|zenpower:Tccd*) ;;
          coretemp:*) continue ;;                      # skip "Package id 0": only individual cores
          k10temp:Tctl|zenpower:Tctl) [ "$pc" -gt 0 ] && continue ;;
          acpitz:*|cpu_thermal:*) [ "$pc" -gt 0 ] && continue ;;
          *) continue ;;
        esac
        pc=$((pc+1)); echo "pcore$pc=$(( $(rd "$t") / 1000 ))"
      done
    done
    if [ -z "$gpu" ] && have nvidia-smi; then gpu=$(nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader 2>/dev/null | head -1); fi
    if [ -n "$gpu" ]; then echo "gpu=$gpu"; fi
    if [ "$pc" -eq 0 ] && [ -z "$gpu" ]; then echo "temp_none=1"; fi
    ;;

  power)
    # watts and battery health from the kernel's power_supply files. Same keys as the macOS gate.
    b=$(batt)
    ac=0; for a in "$SYS"/class/power_supply/A*; do [ "$(rd "$a/online")" = 1 ] && ac=1; done
    [ -z "$b" ] && ac=1
    echo "ac=$ac"
    if [ -n "$b" ]; then
      st=$(rd "$b/status"); pw=$(rd "$b/power_now")
      if [ -z "$pw" ]; then cu=$(rd "$b/current_now"); vo=$(rd "$b/voltage_now"); [ -n "$cu" ] && [ -n "$vo" ] && pw=$(awk -v c="$cu" -v v="$vo" 'BEGIN {printf "%d", c*v/1000000}'); fi
      if [ -n "${pw:-}" ]; then
        if [ "$st" = Discharging ]; then awk -v p="$pw" 'BEGIN {printf "sys_w=%.1f\nbatt_w=%.1f\n", p/1e6, p/1e6}'
        elif [ "$st" = Charging ]; then awk -v p="$pw" 'BEGIN {printf "batt_w=%.1f\n", -p/1e6}'; fi
      fi
      full=$(rd "$b/energy_full"); [ -z "$full" ] && full=$(rd "$b/charge_full")
      design=$(rd "$b/energy_full_design"); [ -z "$design" ] && design=$(rd "$b/charge_full_design")
      if [ -n "$full" ]; then echo "nominalchargecapacity=$full"; fi; if [ -n "$design" ]; then echo "designcapacity=$design"; fi
      cy=$(rd "$b/cycle_count"); if [ -n "$cy" ] && [ "$cy" != 0 ]; then echo "cyclecount=$cy"; fi
      tp=$(rd "$b/temp"); if [ -n "$tp" ]; then echo "temperature=$((tp*10))"; fi     # tenths of a degree -> hundredths, like the Mac gate
    fi
    ;;

  display-get)
    if have brightnessctl; then brightnessctl -m 2>/dev/null | head -1 | awk -F, '{gsub(/%/,"",$4); print "brightness=" $4}'
    else
      for d in "$SYS"/class/backlight/*; do [ -r "$d/brightness" ] && { awk -v c="$(rd "$d/brightness")" -v m="$(rd "$d/max_brightness")" 'BEGIN {printf "brightness=%d\n", c*100/m}'; exit 0; }; done
      echo "brightness_none=1"
    fi
    ;;
  display-set\ [0-9]|display-set\ [0-9][0-9]|display-set\ 100)
    n="${cmd#display-set }"; [ "$n" -lt 1 ] && n=1                 # never fully black: you couldn't see the panel to undo it
    have brightnessctl && brightnessctl set "${n}%" >/dev/null && echo ok || { echo "install brightnessctl" >&2; exit 1; }
    ;;
  lock)
    if have loginctl; then loginctl lock-sessions && echo ok
    elif have xdg-screensaver; then xdg-screensaver lock && echo ok
    else echo "no lock command found" >&2; exit 1; fi
    ;;
  sleep-display)
    if have xset; then xset dpms force off && echo ok
    elif have busctl; then busctl --user call org.gnome.ScreenSaver /org/gnome/ScreenSaver org.gnome.ScreenSaver SetActive b true >/dev/null && echo ok
    else echo "no display-off command found" >&2; exit 1; fi
    ;;

  volume-set\ [0-9]|volume-set\ [0-9][0-9]|volume-set\ 100)
    n="${cmd#volume-set }"
    if have pactl; then pactl set-sink-volume @DEFAULT_SINK@ "${n}%" && echo ok
    elif have amixer; then amixer sset Master "${n}%" >/dev/null && echo ok
    else echo "install pulseaudio-utils (pactl) or alsa-utils" >&2; exit 1; fi
    ;;
  mute)
    if have pactl; then pactl set-sink-mute @DEFAULT_SINK@ toggle && echo ok
    elif have amixer; then amixer sset Master toggle >/dev/null && echo ok
    else echo "install pulseaudio-utils (pactl) or alsa-utils" >&2; exit 1; fi
    ;;

  media\ playpause|media\ next|media\ prev)
    have playerctl || { echo "install playerctl" >&2; exit 1; }
    case "${cmd#media }" in playpause) playerctl play-pause ;; next) playerctl next ;; prev) playerctl previous ;; esac && echo ok
    ;;
  media-seek\ [0-9]|media-seek\ [0-9][0-9]|media-seek\ [0-9][0-9][0-9]|media-seek\ [0-9][0-9][0-9][0-9]|media-seek\ [0-9][0-9][0-9][0-9][0-9])
    have playerctl || { echo "install playerctl" >&2; exit 1; }
    playerctl position "${cmd#media-seek }" && echo ok
    ;;
  nowplaying)
    # any MPRIS player (Spotify, Firefox, Chrome, VLC, Rhythmbox ...) through playerctl; prints nothing when nothing is playing
    have playerctl || exit 0
    st=$(playerctl status 2>/dev/null) || exit 0
    title=$(playerctl metadata title 2>/dev/null); [ -n "$title" ] || exit 0
    len=$(playerctl metadata mpris:length 2>/dev/null)
    echo "src=$(playerctl metadata --format '{{playerName}}' 2>/dev/null)"
    echo "title=$title"; echo "artist=$(playerctl metadata artist 2>/dev/null)"; echo "album=$(playerctl metadata album 2>/dev/null)"
    [ -n "$len" ] && awk -v l="$len" 'BEGIN {printf "duration=%.1f\n", l/1000000}'
    echo "elapsed=$(playerctl position 2>/dev/null)"
    [ "$st" = Playing ] && echo "rate=1" || echo "rate=0"
    ;;
  artwork)
    u=$(playerctl metadata mpris:artUrl 2>/dev/null)
    case "$u" in
      https://*) curl -fsS --max-time 5 --proto '=https' "$u" 2>/dev/null | head -c 6000000 ;;
      file://*)  f=$(printf '%b' "${u#file://}" | sed 's/%20/ /g')       # only real image files in places a player writes covers
                 case "$f" in "$HOME"/*|/tmp/*|/run/user/*|/var/tmp/*) [[ "$f" =~ \.(jpe?g|png|webp|gif)$ ]] && [ -f "$f" ] && head -c 6000000 "$f" ;; esac ;;
    esac
    ;;

  apps)
    cat "$D/apps.allow" 2>/dev/null
    ;;
  open-app\ *)
    # a .desktop id or command name, and it must exactly match a line in ~/.dashling/apps.allow
    name="${cmd#open-app }"
    if [[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$ ]] && grep -Fxq -- "$name" "$D/apps.allow" 2>/dev/null; then
      if have gtk-launch && gtk-launch "$name" >/dev/null 2>&1; then echo ok
      elif have "$name"; then setsid -f "$name" >/dev/null 2>&1 < /dev/null && echo ok
      else echo "could not launch $name" >&2; exit 1; fi
    else echo "app not in allowlist" >&2; exit 126; fi
    ;;
  shortcuts)
    # your own scripts: every executable file in ~/.dashling/shortcuts is one button the panel may press
    for f in "$D"/shortcuts/*; do [ -f "$f" ] && [ -x "$f" ] && basename "$f"; done
    ;;
  shortcut\ *)
    name="${cmd#shortcut }"
    if [[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9\ ._-]{0,60}$ ]] && [ -f "$D/shortcuts/$name" ] && [ -x "$D/shortcuts/$name" ]; then
      "$D/shortcuts/$name" </dev/null >/dev/null 2>&1 && echo ok || { echo "shortcut failed" >&2; exit 1; }
    else echo "shortcut not found" >&2; exit 126; fi
    ;;
  calendar)
    echo "cal_unsupported=1"
    ;;

  docker-ps)
    docker ps -a --format '{{.Names}}|{{.State}}|{{.Status}}|{{.Image}}' 2>/dev/null || echo "docker_down=1"
    ;;
  docker-act\ *)
    if [[ "$cmd" =~ ^docker-act\ (start|stop|restart)\ ([A-Za-z0-9][A-Za-z0-9_.-]{0,62})$ ]]; then
      case "${BASH_REMATCH[2]}" in *dashling*) echo "refusing to touch the panel's own container" >&2; exit 126 ;; esac
      docker "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" >/dev/null && echo ok
    else echo "bad docker command" >&2; exit 126; fi
    ;;

  photo-list)
    ls -1 "$D/photos" 2>/dev/null | grep -iE '\.(jpe?g|png|webp|heic)$' | head -300
    ;;
  photo-get\ *)
    # one photo from ~/.dashling/photos, shrunk to max 1600px JPEG (ImageMagick or libvips). Plain file names only: no paths.
    shopt -s nocasematch
    name="${cmd#photo-get }"
    if [[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9\ ._\(\)-]{0,100}\.(jpe?g|png|webp|heic)$ ]] && [ -f "$D/photos/$name" ]; then
      f="$D/photos/$name"
      if have magick; then magick "$f" -auto-orient -resize '1600x1600>' -quality 72 jpeg:- 2>/dev/null
      elif have convert; then convert "$f" -auto-orient -resize '1600x1600>' -quality 72 jpeg:- 2>/dev/null
      elif have vipsthumbnail; then t=$(mktemp "${TMPDIR:-/tmp}/dashphoto.XXXXXX.jpg"); vipsthumbnail "$f" -s 1600 -o "$t[Q=72]" >/dev/null 2>&1 && cat "$t"; rm -f "$t"
      elif [[ "$name" =~ \.jpe?g$ ]]; then head -c 8000000 "$f"
      else echo "install imagemagick to show this photo type" >&2; exit 1; fi
    else echo "no such photo" >&2; exit 1; fi
    ;;

  proc-kill\ *|proc-kill9\ *)
    # only YOUR processes, never the desktop session or the SSH session; plain quit (TERM) or force (KILL)
    if [[ "$cmd" =~ ^proc-kill(9)?\ ([0-9]{2,7})$ ]]; then
      pid="${BASH_REMATCH[2]}"; sig=TERM; [ -n "${BASH_REMATCH[1]}" ] && sig=KILL
      owner=$(ps -o user:32= -p "$pid" 2>/dev/null | tr -d ' ')
      pname=$(ps -o comm= -p "$pid" 2>/dev/null); pname=${pname##*/}
      [ -n "$owner" ] && [ "$owner" = "$(id -un)" ] || { echo "not your process" >&2; exit 126; }
      case "$pname" in systemd|init|Xorg|Xwayland|gnome-shell|plasmashell|kwin*|sway|Hyprland|gdm*|sddm|lightdm|dbus-daemon|pipewire*|wireplumber|pulseaudio|sshd|sshd-session|sshd-auth|dashling*) echo "protected process" >&2; exit 126 ;; esac
      kill -"$sig" "$pid" && echo ok
    else echo "bad pid" >&2; exit 126; fi
    ;;

  ai-usage)
    d="$D/cache"
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
    case "$cmd" in gh-contrib) f=gh.json; e=gh.err ;; gl-contrib) f=gl.txt; e=gl.err ;; gh-reviews) f=gh-reviews.json; e=gh-reviews.err ;; *) f=gl-reviews.json; e=gl-reviews.err ;; esac
    d="$D/cache"
    if [ -s "$d/$f" ]; then cat "$d/$f"
    else { cat "$d/$e" 2>/dev/null | tr '\n' ' '; echo "(no cached data yet; the sync job runs every few minutes)"; } >&2; exit 1; fi
    ;;
  *)
    echo "refused" >&2
    exit 126
    ;;
esac
