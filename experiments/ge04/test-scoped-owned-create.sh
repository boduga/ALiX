#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
work=$(mktemp -d); outside=$(mktemp -d)
trap 'rm -rf "$work" "$outside"' EXIT
gcc -std=c11 -Wall -Wextra -Werror -O2 scoped-owned-create.c -o "$work/create"
mkdir -p "$work/owned" "$work/unowned" "$work/owned/nested"
"$work/create" "$work" owned nested/good.txt good
[[ $(cat "$work/owned/nested/good.txt") == good ]]
ln -s unowned "$work/alias"
ln -s ../unowned "$work/owned/redirect"
ln -s "$outside" "$work/owned/external"
for spec in 'alias|bad.txt' 'owned|redirect/bad.txt' 'owned|external/bad.txt' 'owned|../unowned/bad.txt' 'owned|/tmp/bad.txt' 'owned|nested/good.txt'; do
  IFS='|' read -r scope target <<< "$spec"
  if "$work/create" "$work" "$scope" "$target" attack >/dev/null 2>&1; then
    echo "FAIL: unexpectedly allowed $spec" >&2; exit 1
  fi
done
[[ ! -e "$work/unowned/bad.txt" && ! -e "$outside/bad.txt" ]]
echo 'GE-04 pinned owned-fd create POC: PASS (basic cases only)'
