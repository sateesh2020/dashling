#!/bin/bash
# One-time setup so the Dashling container can read stats from THIS Mac.
# What it does (and nothing else):
#   1. copies host/dashling-gate.sh to ~/.dashling/ (read it first, it is short)
#   2. creates a dedicated SSH keypair; the private key goes only into the Docker volume
#   3. adds ONE line to ~/.ssh/authorized_keys that locks that key to the gate script
#   4. installs a background job (launchd agent) that refreshes GitHub/GitLab contribution data every 15 min
# Undo: delete the line containing "dashling-gate" from ~/.ssh/authorized_keys, then
#       launchctl bootout gui/$(id -u)/dev.dashling.contrib; rm ~/Library/LaunchAgents/dev.dashling.contrib.plist; rm -rf ~/.dashling
set -euo pipefail
cd "$(dirname "$0")"
VOLUME="${VOLUME:-dashling_dashling-data}"
DEST="$HOME/.dashling"

echo "This will:"
echo "  - install $DEST/dashling-gate.sh"
echo "  - append a restricted key to ~/.ssh/authorized_keys"
echo "  - store the private key in Docker volume '$VOLUME'"
echo "  - install a background job (~/Library/LaunchAgents/dev.dashling.contrib.plist) that syncs GitHub/GitLab contributions"
read -r -p "Continue? [y/N] " ok; [[ "$ok" == [yY]* ]] || exit 1

if ! nc -z localhost 22 2>/dev/null; then
  echo; echo "Remote Login is OFF. Turn it on: System Settings > General > Sharing > Remote Login"
  echo "(tip: 'Allow access for: Only these users' and pick just your account), then re-run."; exit 1
fi

mkdir -p "$DEST" ~/.ssh && chmod 700 ~/.ssh
install -m 755 dashling-gate.sh "$DEST/dashling-gate.sh"
[ -f "$DEST/apps.allow" ] || printf 'Safari\nMusic\nNotes\nCalendar\n' > "$DEST/apps.allow"   # apps the panel may open; edit freely

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
ssh-keygen -q -t ed25519 -N "" -C "dashling-container" -f "$tmp/id_ed25519"
docker volume create "$VOLUME" >/dev/null
docker run --rm -v "$VOLUME":/data -v "$tmp":/in:ro alpine sh -c \
  'mkdir -p /data/ssh && cp /in/id_ed25519 /data/ssh/id_ed25519 && chown -R 1000:1000 /data && chmod 700 /data/ssh && chmod 600 /data/ssh/id_ed25519'

touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
sed -i '' -e '/dashling-container/d' -e '/phonebox-container/d' ~/.ssh/authorized_keys     # replace any previous key (including the old PhoneBox one)
echo "command=\"$DEST/dashling-gate.sh\",restrict $(cat "$tmp/id_ed25519.pub")" >> ~/.ssh/authorized_keys

./install-jobs.sh

read -r -p "Also add Dashling's Claude Code status-line hook (shows plan limits on the AI page; edits ~/.claude/settings.json, backed up, undo with ./host/dashling.sh statusline --remove)? [y/N] " hook
[[ "$hook" == [yY]* ]] && ../common/install-claude-statusline.sh || echo "Skipped. Run ./host/dashling.sh statusline any time."

./install-helpers.sh || echo "(helpers skipped; run ./host/dashling.sh helpers later)"

echo; echo "Done. Now run:"
echo "  HOST_SSH=$(whoami)@host.docker.internal docker compose up -d"
