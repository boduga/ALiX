#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
work=$(mktemp -d); outside=$(mktemp -d)
trap 'rm -rf "$work" "$outside"' EXIT
gcc -std=c11 -Wall -Wextra -Werror -O2 scoped-create.c -o "$work/scoped-create"
mkdir -p "$work/allowed" "$work/other"
"$work/scoped-create" "$work" allowed/ok.txt safe
[[ $(cat "$work/allowed/ok.txt") == safe ]]
ln -s "$outside" "$work/escape"
ln -s ../other "$work/allowed/alias"
for target in escape/bad.txt allowed/alias/bad.txt ../bad.txt /tmp/bad.txt allowed/ok.txt; do
  if "$work/scoped-create" "$work" "$target" attack >/dev/null 2>&1; then
    echo "FAIL: unexpectedly allowed $target" >&2; exit 1
  fi
done
[[ ! -e "$outside/bad.txt" && ! -e "$work/other/bad.txt" ]]
echo 'GE-04 Linux openat2 POC: PASS (basic negative cases only)'
