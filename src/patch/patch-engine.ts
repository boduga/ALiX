import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { EditFormat } from "./edit-format-policy.js";
import { applySearchReplace, parseSearchReplace } from "./search-replace.js";
import { parseStructuredPatch } from "./structured-patch.js";

export type PatchApplyResult = {
  status: "applied" | "invalid";
  changedFiles: string[];
};

export async function applyPatch(root: string, format: EditFormat, patchText: string): Promise<PatchApplyResult> {
  if (format === "search_replace") {
    const blocks = parseSearchReplace(patchText);
    const changedFiles: string[] = [];
    for (const block of blocks) {
      const path = `${root}/${block.path}`;
      const content = await readFile(path, "utf8");
      const next = applySearchReplace(content, block);
      await writeFile(path, next, "utf8");
      changedFiles.push(block.path);
    }
    return { status: "applied", changedFiles };
  }

  if (format === "structured_patch") {
    const patch = parseStructuredPatch(patchText);
    const changedFiles: string[] = [];
    for (const file of patch.files) {
      const path = `${root}/${file.path}`;
      if (file.operation === "modify") {
        const content = await readFile(path, "utf8");
        if (!file.preimageHash || sha256(content) !== file.preimageHash) {
          throw new Error(`Preimage validation failed for ${file.path}`);
        }
        await writeFile(path, file.content ?? "", "utf8");
        changedFiles.push(file.path);
      }
      if (file.operation === "create") {
        await writeFile(path, file.content ?? "", "utf8");
        changedFiles.push(file.path);
      }
    }
    return { status: "applied", changedFiles };
  }

  throw new Error(`Unsupported edit format: ${format}`);
}

export function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
