#!/bin/bash
# Linux needs no compiled helpers: the gate reads the kernel's /sys and /proc files directly.
# This only CHECKS for the optional tools that unlock features, and tells you what to install (it installs nothing).
DEST="$HOME/.dashling"; mkdir -p "$DEST/shortcuts" "$DEST/photos"
have() { command -v "$1" >/dev/null 2>&1; }
row() { if have "$2"; then printf '  \033[32mok\033[0m   %-14s %s\n' "$2" "$1"; else printf '  \033[33mmiss\033[0m %-14s %s\n' "$2" "$1  ->  needs: $3"; fi; }
echo "Optional tools for Dashling on Linux"
row "now playing + media keys (Spotify, browsers, VLC...)" playerctl playerctl
row "display brightness"                                   brightnessctl brightnessctl
row "volume"                                               pactl "pulseaudio-utils (or pipewire-pulse)"
row "photo frame (resize + HEIC/PNG)"                      convert imagemagick
row "AI usage + GitHub/GitLab sync"                        jq jq
row "GitHub contributions"                                 gh "GitHub CLI (cli.github.com)"
row "Docker widget"                                        docker "docker (your user must be in the 'docker' group)"
if ls /sys/class/hwmon/hwmon*/fan*_input >/dev/null 2>&1; then echo "  ok   fan sensors found"; else echo "  miss fan sensors: none exposed (try: sudo apt install lm-sensors && sudo sensors-detect)"; fi
if ls /sys/class/hwmon/hwmon*/temp*_input >/dev/null 2>&1; then echo "  ok   temperature sensors found"; else echo "  miss temperature sensors: none exposed (try: sudo apt install lm-sensors && sudo sensors-detect)"; fi
echo "  info Calendar events are not supported on Linux yet. Add your own buttons as executable scripts in $DEST/shortcuts"
