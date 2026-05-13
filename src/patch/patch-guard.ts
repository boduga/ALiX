export type PatchOperation = {
  path: string;
  operation: "modify" | "create" | "delete";
  content?: string;
};

export type PatchGuardConfig = {
  protectedPaths: string[];
  maxFileSizeBytes: number;
};

export type ValidationResult = {
  valid: boolean;
  reason?: string;
};

export function isProtectedPath(patterns: string[], path: string): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith("/**")) return path.startsWith(pattern.slice(0, -3));
    if (pattern.endsWith(".*")) return path === pattern.slice(0, -2) || path.startsWith(pattern.slice(0, -1));
    return path === pattern;
  });
}

export function isPathSafe(path: string): boolean {
  if (path.startsWith("..")) return false;
  if (path.startsWith("/")) return false;
  if (path.includes("../")) return false;
  if (path.startsWith("~")) return false;
  if (path.startsWith("$")) return false;
  return true;
}

export function validatePatchOperations(ops: PatchOperation[], config: PatchGuardConfig): ValidationResult {
  for (const op of ops) {
    if (!isPathSafe(op.path)) {
      return { valid: false, reason: `Path is unsafe: ${op.path}` };
    }

    if (isProtectedPath(config.protectedPaths, op.path)) {
      return { valid: false, reason: `Path is protected: ${op.path}` };
    }

    if (op.content !== undefined) {
      const sizeBytes = new TextEncoder().encode(op.content).length;
      if (sizeBytes > config.maxFileSizeBytes) {
        return { valid: false, reason: `Content exceeds max file size: ${op.path}` };
      }
    }
  }

  return { valid: true };
}