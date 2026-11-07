# GE-04 fixed preflight installation review — microcloud3

**Status: operator-controlled, not installed.** This is a read-only qualification helper, not worker containment approval.

Review `native/ge04/cgroup2-fixed-preflight.c` and its commit. It accepts no arguments, has fixed cgroup paths, and performs no writes or worker launches. Build with `cc -Wall -Wextra -Werror -O2 -o /tmp/alix-ge04-fixed-preflight native/ge04/cgroup2-fixed-preflight.c`, record `sha256sum /tmp/alix-ge04-fixed-preflight`, then transfer with `scp /tmp/alix-ge04-fixed-preflight 10.1.1.22:/tmp/alix-ge04-fixed-preflight`.

On microcloud3, an administrator must independently verify the staged binary's SHA-256 against the reviewed build and inspect the root ownership, permissions and symlink-free ancestry of `/usr/local/sbin`. The staged binary must **never** be authorized by sudoers. After verification, install interactively with `sudo install -o root -g root -m 0755 /tmp/alix-ge04-fixed-preflight /usr/local/sbin/alix-ge04-fixed-preflight`; verify installed ownership and SHA-256 again. Never install setuid or file capabilities.

Only after review and installation, create a **separate** `/etc/sudoers.d/alix-ge04-readonly-preflight` with the exact line:

```sudoers
babasola ALL=(root) NOPASSWD: /usr/local/sbin/alix-ge04-fixed-preflight ""
```

The trailing `""` is critical: sudoers allows **zero arguments**. Use `sudo visudo -f /etc/sudoers.d/alix-ge04-readonly-preflight`, then `sudo visudo -c`; require root:root and mode 0440. Never authorize a shell, compiler, wildcard, `/tmp`, or user-owned repository path. Leave `/etc/sudoers.d/alix-ge04-q31` untouched.

Verify `sudo -n -l`, `sudo -n /usr/local/sbin/alix-ge04-fixed-preflight` (must PASS), and `sudo -n /usr/local/sbin/alix-ge04-fixed-preflight /tmp` (must be rejected by sudo). Record kernel, host, source revision, reviewed binary digest, installed digest, and outputs. Any unexpected result stops qualification.

After qualification, remove only this dedicated rule and binary using an interactive administrator session, then validate `sudo visudo -c` and `sudo -n -l`. **GE-04 SECURITY HOLD remains active.**
