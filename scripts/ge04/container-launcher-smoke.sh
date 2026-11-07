#!/bin/sh
# Disposable container smoke probe, NOT privileged VM security qualification.
set -eu
image=${ALIX_GE04_SMOKE_IMAGE:-alix-alix-app:latest}
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
exec docker run --rm --network none --read-only \
  --tmpfs /run:rw,exec,mode=755 --tmpfs /tmp:mode=1777 \
  --mount "type=bind,src=$root/native/ge04,dst=/source,readonly" \
  "$image" sh -ec '
    cd /tmp
    cc -Wall -Wextra -Werror -O2 -o /run/launcher /source/isolated-worker-launcher.c
    test "$(/run/launcher 20002 /usr /usr/bin/id -u)" = 20002
    test "$(/run/launcher 20002 /usr /usr/bin/id -G)" = 20002
    actual=$(/run/launcher 20002 /usr /usr/bin/env -0 | tr "\000" "\n" | sort)
    expected=$(printf "HOME=/nonexistent\nLANG=C\nPATH=/usr/bin:/bin\n" | sort)
    test "$actual" = "$expected"
    printf "ge04-root-secret" >/run/root-secret
    chmod 600 /run/root-secret
    if /run/launcher 20002 /usr /usr/bin/cat /run/root-secret >/tmp/secret-output 2>/tmp/secret-error; then
      echo "FAIL: protected secret readable" >&2; exit 1
    fi
    test ! -s /tmp/secret-output
    # A real root-owned executable beneath a world-writable ancestor must
    # fail specifically because of ancestry, not because it is missing.
    cp /usr/bin/id /tmp/untrusted
    chown 0:0 /tmp/untrusted
    chmod 755 /tmp/untrusted
    if /run/launcher 20002 /usr /tmp/untrusted -u >/tmp/unsafe-output 2>/tmp/unsafe-error; then
      echo "FAIL: unsafe executable accepted" >&2; exit 1
    fi
    grep -q "untrusted executable path component" /tmp/unsafe-error
    if /run/launcher 20002 /usr /bin/id -u >/tmp/symlink-output 2>/tmp/symlink-error; then
      echo "FAIL: symlinked executable ancestry accepted" >&2; exit 1
    fi
    if /run/launcher 20002 /usr /usr/../usr/bin/id -u >/tmp/dotdot-output 2>/tmp/dotdot-error; then
      echo "FAIL: dotdot executable ancestry accepted" >&2; exit 1
    fi
    echo "GE-04 container smoke: PASS (UID, groups, environment, protected file, unsafe executable, symlink and dotdot rejection)"
  '
