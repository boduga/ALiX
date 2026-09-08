const DEFAULT_CHILD_ENV = [
  "PATH", "HOME", "SHELL", "TMPDIR", "TMP", "TEMP",
  "SystemRoot", "COMSPEC", "PATHEXT",
];

/** Build a subprocess environment without implicitly propagating credentials. */
export function buildChildEnv(
  allowlist: readonly string[] = DEFAULT_CHILD_ENV,
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of new Set([...DEFAULT_CHILD_ENV, ...allowlist])) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return { ...env, ...overrides };
}
