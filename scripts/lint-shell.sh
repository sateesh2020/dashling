#!/bin/bash
# Syntax-check every shell script, then run ShellCheck (warnings and errors) if it is installed.
# Install ShellCheck: brew install shellcheck | apt install shellcheck.  CI always runs it.
cd "$(dirname "$0")/.." || exit 1
files=(); while IFS= read -r f; do files+=("$f"); done < <(find host scripts test -name '*.sh' | sort)      # no mapfile: macOS ships bash 3.2
bad=0
for f in "${files[@]}"; do bash -n "$f" || { echo "SYNTAX ERROR: $f"; bad=1; }; done
echo "${#files[@]} shell scripts syntax-checked"
if command -v shellcheck >/dev/null 2>&1; then
  shellcheck -S warning -x "${files[@]}" || bad=1
  echo "shellcheck done"
else
  echo "shellcheck not installed: skipped (CI runs it)"
fi
exit $bad
