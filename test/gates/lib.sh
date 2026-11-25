# shellcheck shell=bash
# Tiny assertion helpers shared by the gate tests.
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
check() { if [ "$1" = "$2" ]; then ok "$3"; else bad "$3 (expected '$2', got '$1')"; fi; }
contains() { case "$1" in *"$2"*) ok "$3" ;; *) bad "$3 (missing '$2' in: $(printf '%s' "$1" | head -c 200 | tr '\n' ' '))" ;; esac; }
finish() { echo; echo "$PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]; }
