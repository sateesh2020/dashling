#!/bin/bash
# Hostile input must be refused by the gate (exit 126) and must never run anything.
# Runs the gate for the current OS (macOS or Linux) with an empty HOME so no real allowlists or data are touched.
cd "$(dirname "$0")/../.." || exit 1
. test/gates/lib.sh
case "$(uname -s)" in Darwin) GATE=host/macos/dashling-gate.sh ;; Linux) GATE=host/linux/dashling-gate.sh ;; *) echo "skip: unsupported OS"; exit 0 ;; esac
export HOME; HOME=$(mktemp -d); trap 'rm -rf "$HOME"' EXIT
CANARY="$HOME/PWNED"
run() { SSH_ORIGINAL_COMMAND="$1" bash "$GATE" >"$HOME/out" 2>"$HOME/err"; echo $?; }
echo "gate under test: $GATE"

refused() {   # $1 = command; must exit 126 and must not have created the canary
  rm -f "$CANARY"; local rc; rc=$(run "$1")
  check "$rc" "126" "refused: $1"
  [ -e "$CANARY" ] && bad "INJECTION RAN for: $1"
  return 0
}
failed() {    # exits non-zero (not necessarily 126), no canary, no leak of file contents
  rm -f "$CANARY"; local rc; rc=$(run "$1")
  [ "$rc" != 0 ] && ok "fails: $1" || bad "should fail: $1"
  [ -e "$CANARY" ] && bad "INJECTION RAN for: $1"
  grep -q "root:" "$HOME/out" 2>/dev/null && bad "LEAKED /etc/passwd for: $1"
  return 0
}

refused ""
refused "bogus"
refused "rm -rf /"
refused "stats; touch $CANARY"
refused "\$(touch $CANARY)"
refused "stats && touch $CANARY"
refused "proc-kill 1"
refused "proc-kill abc"
refused "proc-kill 4242; touch $CANARY"
refused "proc-kill9 -1"
refused "volume-set 101"
refused "volume-set 5; touch $CANARY"
refused "display-set 999"
refused "display-set 5;touch $CANARY"
refused "media seek"
refused "media-seek 1; touch $CANARY"
refused "media-seek 123456"
refused "docker-act delete web"
refused "docker-act stop web; touch $CANARY"
refused "docker-act stop dashling-dashling-1"
refused "docker-act restart my-dashling-panel"
refused "open-app ../../bin/sh"
refused "open-app NotInTheAllowlist"
refused "open-app x; touch $CANARY"
refused "shortcut ../x"
refused "shortcut Nope"
refused "shortcut a;touch $CANARY"
failed  "photo-get ../../etc/passwd"
failed  "photo-get /etc/passwd"
failed  "photo-get nothere.jpg"
finish
