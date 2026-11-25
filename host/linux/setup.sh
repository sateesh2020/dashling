#!/bin/bash
# One-time setup so the Dashling container can read stats from THIS Linux machine.
# What it does (and nothing else):
#   1. copies host/linux/dashling-gate.sh to ~/.dashling/ (read it first, it is short)
#   2. creates a dedicated SSH keypair; the private key goes only into the Docker volume
#   3. adds ONE line to ~/.ssh/authorized_keys that locks that key to the gate script
#   4. installs a systemd user timer (or a cron line) that refreshes GitHub/GitLab contribution data and AI usage every 2 minutes
# Undo: ./host/dashling.sh uninstall
set -euo pipefail
cd "$(dirname "$0")"
VOLUME="${VOLUME:-dashling_dashling-data}"; DEST="$HOME/.dashling"

command -v docker >/dev/null || { echo "docker is not installed or not in PATH"; exit 1; }
echo "This will:"
echo "  - install $DEST/dashling-gate.sh"
echo "  - append a restricted key to ~/.ssh/authorized_keys"
echo "  - store the private key in Docker volume '$VOLUME'"
echo "  - install a background timer that syncs GitHub/GitLab contributions and AI usage"
read -r -p "Continue? [y/N] " ok; [[ "$ok" == [yY]* ]] || exit 1

if ! (ss -ltn 2>/dev/null | grep -qE ':22\b' || nc -z localhost 22 2>/dev/null); then
  echo; echo "No SSH server is listening on port 22. Install and start one, then re-run:"
  echo "  Debian/Ubuntu:  sudo apt install openssh-server && sudo systemctl enable --now ssh"
  echo "  Fedora:         sudo dnf install openssh-server && sudo systemctl enable --now sshd"
  echo "  Arch:           sudo pacman -S openssh && sudo systemctl enable --now sshd"
  echo "(tip: in /etc/ssh/sshd_config you can set 'AllowUsers $(whoami)' so only your account can log in)"; exit 1
fi

mkdir -p "$DEST" ~/.ssh && chmod 700 ~/.ssh
install -m 755 dashling-gate.sh "$DEST/dashling-gate.sh"
[ -f "$DEST/apps.allow" ] || printf 'firefox\n' > "$DEST/apps.allow"          # apps the panel may open (desktop ids or commands); edit freely
mkdir -p "$DEST/shortcuts" "$DEST/photos"

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
ssh-keygen -q -t ed25519 -N "" -C "dashling-container" -f "$tmp/id_ed25519"
docker volume create "$VOLUME" >/dev/null
docker run --rm -v "$VOLUME":/data -v "$tmp":/in:ro alpine sh -c \
  'mkdir -p /data/ssh && cp /in/id_ed25519 /data/ssh/id_ed25519 && chown -R 1000:1000 /data && chmod 700 /data/ssh && chmod 600 /data/ssh/id_ed25519'

touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
grep -v -e dashling-container -e phonebox-container ~/.ssh/authorized_keys > "$tmp/ak" || true      # replace any previous key
cat "$tmp/ak" > ~/.ssh/authorized_keys
echo "command=\"$DEST/dashling-gate.sh\",restrict $(cat "$tmp/id_ed25519.pub")" >> ~/.ssh/authorized_keys

./install-jobs.sh
./install-helpers.sh || true

read -r -p "Also add Dashling's Claude Code status-line hook (shows plan limits on the AI page; edits ~/.claude/settings.json, backed up)? [y/N] " hook
[[ "$hook" == [yY]* ]] && ../common/install-claude-statusline.sh || echo "Skipped. Run ./host/dashling.sh statusline any time."

echo; echo "Done. Now run:"
echo "  HOST_SSH=$(whoami)@host.docker.internal docker compose up -d"
