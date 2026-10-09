/**
 * P5.7c — assertSafePathComponent.
 *
 * Validates that a path component (e.g. a proposal target ID or filename)
 * does not contain path traversal sequences, special characters, reserved
 * names, or absolute path markers. Rejects rather than sanitizing to avoid
 * name collisions.
 *
 * @module
 */

/**
 * Patterns that are never valid in a safe path component.
 *
 * NOTE: we reject `..` (parent traversal), `.` (current dir), and empty
 * strings, but NOT all leading-dot prefixes. IDs like `.well-known` or
 * `.internal-config` are allowed — only the exact values `.` and `..` are
 * dangerous as standalone path segments. The `^^\.$` pattern catches lone
 * dots but permits `.well-known`.
 */
const REJECT_PATTERNS: RegExp[] = [
  /\.\./,       // parent directory traversal (catches ".." and "../foo")
  /^\.$/,      // lone "." (current directory)
  /\//,         // forward slash (Unix path separator)
  /\\/,         // backslash (Windows path separator)
  /\0/,         // null byte
  /^$/,         // empty string
];

/** Windows reserved names (case-insensitive). */
const WINDOWS_RESERVED = new Set([
  "con", "nul", "prn", "aux",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

/** Windows drive prefix pattern (e.g. C:, D:). */
const WINDOWS_DRIVE_RE = /^[a-zA-Z]:/;

/**
 * Validate that `input` is a safe filesystem path component.
 *
 * Throws if the input contains any forbidden patterns. Returns the input
 * unchanged on success (so it can be used as a pass-through validator).
 */
export function assertSafePathComponent(input: string): string {
  if (typeof input !== "string") {
    throw new Error(
      `Path component must be a string, got ${typeof input}`,
    );
  }

  for (const pattern of REJECT_PATTERNS) {
    if (pattern.test(input)) {
      throw new Error(
        `Unsafe path component: "${input}" (matches ${pattern})`,
      );
    }
  }

  if (WINDOWS_RESERVED.has(input.toLowerCase())) {
    throw new Error(
      `Unsafe path component: "${input}" (Windows reserved name)`,
    );
  }

  if (WINDOWS_DRIVE_RE.test(input)) {
    throw new Error(
      `Unsafe path component: "${input}" (Windows drive prefix)`,
    );
  }

  // Absolute paths (Unix or Windows style)
  if (input.startsWith("/")) {
    throw new Error(`Unsafe path component: "${input}" (absolute path)`);
  }

  return input;
}
