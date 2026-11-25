#!/bin/bash
# Linux gate against a FAKE /sys tree: checks the parsers for fans, temperatures, power, brightness and the shortcut/photo helpers.
# Needs a Linux userland with procps (ps). CI runs it on ubuntu; on macOS use:  docker run --rm -v "$PWD":/r:ro -w /r debian:bookworm-slim bash -c 'apt-get update -qq && apt-get install -y -qq procps >/dev/null && bash test/gates/linux.sh'
cd "$(dirname "$0")/../.." || exit 1
. test/gates/lib.sh
[ "$(uname -s)" = Linux ] || { echo "skip: Linux only"; exit 0; }
GATE=host/linux/dashling-gate.sh
export HOME; HOME=$(mktemp -d); trap 'rm -rf "$HOME"' EXIT
F="$HOME/sys"; w() { mkdir -p "$(dirname "$1")"; printf '%s' "$2" > "$1"; }
w $F/class/hwmon/hwmon0/name coretemp;  w $F/class/hwmon/hwmon0/temp1_input 60000; w $F/class/hwmon/hwmon0/temp1_label "Package id 0"
w $F/class/hwmon/hwmon0/temp2_input 55000; w $F/class/hwmon/hwmon0/temp2_label "Core 0"; w $F/class/hwmon/hwmon0/temp3_input 57500; w $F/class/hwmon/hwmon0/temp3_label "Core 1"
w $F/class/hwmon/hwmon1/name amdgpu;    w $F/class/hwmon/hwmon1/temp1_input 48000
w $F/class/hwmon/hwmon2/name thinkpad;  w $F/class/hwmon/hwmon2/fan1_input 2400; w $F/class/hwmon/hwmon2/fan2_input 2650
B=$F/class/power_supply/BAT0; w $B/capacity 45; w $B/status Discharging; w $B/energy_now 20000000; w $B/power_now 10000000
w $B/energy_full 40000000; w $B/energy_full_design 50000000; w $B/cycle_count 123; w $B/temp 305; w $F/class/power_supply/AC/online 0
w $F/class/backlight/intel_backlight/brightness 500; w $F/class/backlight/intel_backlight/max_brightness 1000
mkdir -p "$HOME/.dashling/shortcuts" "$HOME/.dashling/photos"; printf '#!/bin/sh\necho hi\n' > "$HOME/.dashling/shortcuts/Hello"; chmod +x "$HOME/.dashling/shortcuts/Hello"
touch "$HOME/.dashling/photos/a b.JPG" "$HOME/.dashling/photos/notes.txt"
g() { SSH_ORIGINAL_COMMAND="$1" DASHLING_SYSFS="$F" bash "$GATE" 2>"$HOME/err"; }
rc() { SSH_ORIGINAL_COMMAND="$1" DASHLING_SYSFS="$F" bash "$GATE" >/dev/null 2>&1; echo $?; }

echo "-- stats"
out=$(g stats)
for k in name cores cpu_user cpu_sys cpu_idle mem_total mem_used disk_total disk_used load boot net_rx net_tx batt_pct batt_state batt_time; do contains "$out" "$k=" "stats has $k"; done
contains "$out" "batt_pct=45" "battery percent"; contains "$out" "batt_state=discharging" "battery state"; contains "$out" "batt_time=2:00" "time left = energy / power"
mem=$(printf '%s\n' "$out" | sed -n 's/^mem_total=//p'); [ "${mem:-0}" -gt 100000000 ] && ok "mem_total is a plain integer (no scientific notation)" || bad "mem_total=$mem"
check "$(rc stats)" 0 "stats exits 0"

echo "-- sensors"
check "$(g fans | tr '\n' ' ')" "fan1=2400 fan2=2650 " "fans"
check "$(rc fans)" 0 "fans exits 0 (a non-zero exit would look like an SSH failure)"
check "$(g temps | tr '\n' ' ')" "pcore1=55 pcore2=57 gpu=48 " "temps: cores only (package skipped), gpu"
check "$(rc temps)" 0 "temps exits 0"
p=$(g power); contains "$p" "sys_w=10.0" "power: system watts"; contains "$p" "batt_w=10.0" "power: battery draining is positive"; contains "$p" "designcapacity=50000000" "design capacity"; contains "$p" "nominalchargecapacity=40000000" "full capacity"; contains "$p" "cyclecount=123" "cycles"; contains "$p" "temperature=3050" "battery temp in hundredths"; contains "$p" "ac=0" "on battery"
check "$(rc power)" 0 "power exits 0"
check "$(g display-get)" "brightness=50" "brightness from sysfs"

echo "-- helpers"
check "$(g shortcuts)" "Hello" "shortcut listing"; check "$(g 'shortcut Hello')" "ok" "shortcut runs"; check "$(rc 'shortcut Missing')" 126 "missing shortcut refused"
check "$(g photo-list)" "a b.JPG" "photo list: spaces + uppercase ok, .txt ignored"
check "$(g calendar)" "cal_unsupported=1" "calendar reports unsupported"
check "$(g docker-ps | head -1 | sed 's/|.*//')" "$(g docker-ps | head -1 | sed 's/|.*//')" "docker-ps runs"
sleep 300 & pid=$!; check "$(g "proc-kill $pid")" ok "proc-kill quits your own process"; sleep 0.3; kill -0 $pid 2>/dev/null && bad "process survived" || ok "process is gone"
check "$(rc 'proc-kill 1')" 126 "pid 1 refused"
finish
