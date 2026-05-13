import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { EditFormat } from "./edit-format-policy.js";
import { applySearchReplace, parseSearchReplace } from "./search-replace.js";
import { parseStructuredPatch } from "./structured-patch.js";
import { validatePatchOperations, type PatchOperation } from "./patch-guard.js";

export type PatchApplyResult = {
  status: "applied" | "invalid";
  changedFiles: string[];
};

export async function applyPatch(root: string, format: EditFormat, patchText: string): Promise<PatchApplyResult> {
  if (format === "search_replace") {
    const blocks = parseSearchReplace(patchText);
    if (blocks.length === 0) throw new Error("No patch changes found");
    const ops: PatchOperation[] = blocks.map((b) => ({ path: b.path, operation: "modify" as const, content: b.replace }));
    const result = validatePatchOperations(ops, {
      protectedPaths: [".git/**", ".env", ".env.*", "secrets/**"],
      maxFileSizeBytes: 10 * 1024 * 1024,
    });
    if (!result.valid) throw new Error("Patch blocked by safety guard: " + result.reason);
    const changedFiles: string[] = [];
    for (const block of blocks) {
      const path = resolvePatchPath(root, block.path);
      const content = await readFile(path, "utf8");
      const next = applySearchReplace(content, block);
      await writeFile(path, next, "utf8");
      changedFiles.push(block.path);
    }
    return { status: "applied", changedFiles };
  }

  if (format === "structured_patch") {
    const patch = parseStructuredPatch(patchText);
    if (patch.files.length === 0) throw new Error("No patch changes found");
    const ops: PatchOperation[] = patch.files.map((f) => ({
      path: f.path,
      operation: f.operation,
      content: f.content,
    }));
    const result = validatePatchOperations(ops, {
      protectedPaths: [".git/**", ".env", ".env.*", "secrets/**"],
      maxFileSizeBytes: 10 * 1024 * 1024,
    });
    if (!result.valid) throw new Error("Patch blocked by safety guard: " + result.reason);
    const changedFiles: string[] = [];
    for (const file of patch.files) {
      const path = resolvePatchPath(root, file.path);
      if (file.operation === "modify") {
        const content = await readFile(path, "utf8");
        if (!file.preimageHash || sha256(content) !== file.preimageHash) {
          throw new Error(`Preimage validation failed for ${file.path}`);
        }
        await writeFile(path, file.content ?? "", "utf8");
        changedFiles.push(file.path);
      }
      if (file.operation === "create") {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, file.content ?? "", "utf8");
        changedFiles.push(file.path);
      }
      if (file.operation === "delete") {
        throw new Error(`Delete operation is not supported for ${file.path}`);
      }
    }
    return { status: "applied", changedFiles };
  }

  throw new Error(`Unsupported edit format: ${format}`);
}

export function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function resolvePatchPath(root: string, patchPath: string): string {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(resolvedRoot, patchPath);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}/`)) {
    throw new Error(`Patch path is outside workspace: ${patchPath}`);
  }
  return resolvedPath;
}
