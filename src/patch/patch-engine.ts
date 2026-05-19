import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { EventLog } from "../events/event-log.js";
import { PATCH_EVENT_TYPES } from "../events/types.js";
import type {
  PatchProposalPayload,
  PatchParsedPayload,
  PatchRejectedPayload,
  PatchCheckpointCreatedPayload,
  PatchAppliedPayload,
  PatchRolledBackPayload,
} from "../events/types.js";
import type { EditFormat } from "./edit-format-policy.js";
import { applySearchReplace, parseSearchReplace, validateSearchReplace } from "./search-replace.js";
import { parseStructuredPatch } from "./structured-patch.js";
import { validatePatchOperations, DEFAULT_PATCH_GUARD_CONFIG, type PatchOperation } from "./patch-guard.js";
import type { CheckpointManager } from "./checkpoint.js";

export type PatchApplyResult = {
  status: "applied" | "invalid";
  changedFiles: string[];
};

export type PatchEngineOptions = {
  eventLog?: EventLog;
  sessionId?: string;
  checkpointManager?: CheckpointManager;
};

export async function applyPatch(
  root: string,
  format: EditFormat,
  patchText: string,
  options: PatchEngineOptions = {}
): Promise<PatchApplyResult> {
  const { eventLog, sessionId, checkpointManager } = options;
  const proposalId = randomUUID();

  // Emit patch.proposed
  let patchFiles: Array<{ path: string; operation: string }> = [];
  if (eventLog && sessionId) {
    try {
      patchFiles = extractPatchFiles(patchText, format);
    } catch {
      // Extraction failed, will be reflected in parsed event
    }
    await eventLog.append({
      sessionId,
      actor: "system",
      type: PATCH_EVENT_TYPES.PROPOSED,
      payload: {
        proposalId,
        format,
        provider: "alix",
        model: "n/a",
        files: patchFiles,
        requiresApproval: false,
      } as PatchProposalPayload,
    });
  }

  // Parse patch
  let parsedBlocks;
  let validationFailed = false;
  let validationErrors: string[] = [];

  try {
    if (format === "search_replace") {
      parsedBlocks = parseSearchReplace(patchText);
    } else {
      parsedBlocks = parseStructuredPatch(patchText);
    }
  } catch (err) {
    validationFailed = true;
    validationErrors = [(err as Error).message];
  }

  // Emit patch.parsed
  if (eventLog && sessionId) {
    await eventLog.append({
      sessionId,
      actor: "system",
      type: PATCH_EVENT_TYPES.PARSED,
      payload: {
        proposalId,
        validated: !validationFailed,
        errors: validationFailed ? validationErrors : undefined,
      } as PatchParsedPayload,
    });
  }

  if (validationFailed) {
    // Emit patch.rejected
    if (eventLog && sessionId) {
      await eventLog.append({
        sessionId,
        actor: "system",
        type: PATCH_EVENT_TYPES.REJECTED,
        payload: {
          proposalId,
          reason: validationErrors.join(", "),
        } as PatchRejectedPayload,
      });
    }
    throw new Error(`Patch rejected: ${validationErrors.join(", ")}`);
  }

  // Create checkpoint
  let checkpointId: string | undefined;
  const filePaths = extractPatchFilePaths(parsedBlocks, format);
  if (checkpointManager && filePaths.length > 0) {
    try {
      const checkpoint = await checkpointManager.create(proposalId, filePaths);
      checkpointId = checkpoint.id;

      // Emit patch.checkpoint_created
      if (eventLog && sessionId) {
        await eventLog.append({
          sessionId,
          actor: "system",
          type: PATCH_EVENT_TYPES.CHECKPOINT_CREATED,
          payload: {
            checkpointId,
            proposalId,
            files: filePaths,
          } as PatchCheckpointCreatedPayload,
        });
      }
    } catch (err) {
      // Continue without checkpoint if it fails
      console.warn("Failed to create checkpoint:", err);
    }
  }

  // Apply patch (existing logic)
  const result = await applyPatchBody(root, format, parsedBlocks);

  // Emit patch.applied
  if (eventLog && sessionId) {
    await eventLog.append({
      sessionId,
      actor: "system",
      type: PATCH_EVENT_TYPES.APPLIED,
      payload: {
        proposalId,
        checkpointId: checkpointId ?? "",
        changedFiles: result.changedFiles,
      } as PatchAppliedPayload,
    });
  }

  return result;
}

export async function rollbackPatch(
  proposalId: string,
  checkpointId: string,
  eventLog?: EventLog,
  sessionId?: string,
  checkpointManager?: CheckpointManager
): Promise<void> {
  if (!checkpointManager) throw new Error("No checkpoint manager configured");

  await checkpointManager.restore(checkpointId);

  if (eventLog && sessionId) {
    await eventLog.append({
      sessionId,
      actor: "system",
      type: PATCH_EVENT_TYPES.ROLLED_BACK,
      payload: {
        proposalId,
        checkpointId,
        reason: "Patch failed verification",
      } as PatchRolledBackPayload,
    });
  }
}

// Original applyPatch logic extracted here
async function applyPatchBody(root: string, format: EditFormat, patchData: unknown): Promise<PatchApplyResult> {
  if (format === "search_replace") {
    const blocks = patchData as Array<{ path: string; search: string; replace: string }>;
    if (blocks.length === 0) throw new Error("No patch changes found");
    const ops: PatchOperation[] = blocks.map((b) => ({ path: b.path, operation: "modify" as const, content: b.replace }));
    const result = validatePatchOperations(ops, DEFAULT_PATCH_GUARD_CONFIG);
    if (!result.valid) throw new Error("Patch blocked by safety guard: " + result.reason);
    const plannedWrites: Array<{ path: string; content: string }> = [];
    for (const block of blocks) {
      const path = resolvePatchPath(root, block.path);
      const content = await readFile(path, "utf8");
      validateSearchReplace(content, block);
      plannedWrites.push({ path, content: applySearchReplace(content, block) });
    }
    for (const write of plannedWrites) {
      await writeFile(write.path, write.content, "utf8");
    }
    return { status: "applied", changedFiles: blocks.map((block) => block.path) };
  }

  if (format === "structured_patch") {
    const patch = patchData as { files: Array<{ path: string; operation: string; content?: string; preimageHash?: string }> };
    if (patch.files.length === 0) throw new Error("No patch changes found");
    const ops: PatchOperation[] = patch.files.map((f) => ({
      path: f.path,
      operation: f.operation as "modify" | "create" | "delete",
      content: f.content,
    }));
    const result = validatePatchOperations(ops, DEFAULT_PATCH_GUARD_CONFIG);
    if (!result.valid) throw new Error("Patch blocked by safety guard: " + result.reason);
    const changedFiles: string[] = [];
    for (const file of patch.files) {
      const path = resolvePatchPath(root, file.path);
      if (file.operation === "modify") {
        const content = await readFile(path, "utf8");
        if (!file.preimageHash || sha256(content) !== file.preimageHash) {
          throw new Error(`Preimage validation failed for ${file.path}`);
        }
      }
      if (file.operation === "delete" && file.preimageHash) {
        const content = await readFile(path, "utf8");
        if (sha256(content) !== file.preimageHash) throw new Error(`Preimage validation failed for ${file.path}`);
      }
    }
    for (const file of patch.files) {
      const path = resolvePatchPath(root, file.path);
      if (file.operation === "modify") {
        await writeFile(path, file.content ?? "", "utf8");
        changedFiles.push(file.path);
      }
      if (file.operation === "create") {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, file.content ?? "", "utf8");
        changedFiles.push(file.path);
      }
      if (file.operation === "delete") {
        const path = resolvePatchPath(root, file.path);
        const { rm } = await import("node:fs/promises");
        await rm(path);
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

function resolvePatchPath(root: string, patchPath: string): string {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(resolvedRoot, patchPath);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}/`)) {
    throw new Error(`Patch path is outside workspace: ${patchPath}`);
  }
  return resolvedPath;
}

// Helper to extract files from patch
function extractPatchFiles(patchText: string, format: EditFormat): Array<{ path: string; operation: string }> {
  if (format === "search_replace") {
    const blocks = parseSearchReplace(patchText);
    return blocks.map((b) => ({ path: b.path, operation: "modify" }));
  }
  const patch = parseStructuredPatch(patchText);
  return patch.files.map((f) => ({ path: f.path, operation: f.operation }));
}

function extractPatchFilePaths(patchData: unknown, format: EditFormat): string[] {
  // Extract actual file paths for checkpoint
  if (format === "search_replace") {
    const blocks = patchData as Array<{ path: string }>;
    return blocks.map((b) => b.path);
  }
  const patch = patchData as { files: Array<{ path: string }> };
  return patch.files.map((f) => f.path);
}
