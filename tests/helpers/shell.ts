/**
 * shell.ts — portable shell commands for timeout/kill tests (#732).
 *
 * `shell.run` uses `spawn(cmd, { shell: true })` → `/bin/sh -c` on POSIX and
 * `cmd.exe /c` on Windows. `sleep`/`touch` don't exist on Windows, so tests
 * that exercise a long-running child or a marker file need a portable command.
 */

/** A portable long-running command that keeps the child alive for `ms`. */
export function longRunningCommand(ms: number): string {
  return `node -e "setTimeout(function(){}, ${ms})"`;
}

/** A portable command that writes `markerPath` then keeps running for `ms`. */
export function markerThenSleepCommand(markerPath: string, ms: number): string {
  // Forward slashes are accepted by Node on every platform and avoid
  // backslash-escaping inside the embedded JS string literal.
  const p = markerPath.split("\\").join("/").split("'").join("\\'");
  return `node -e "require('fs').writeFileSync('${p}', ''); setTimeout(function(){}, ${ms})"`;
}
