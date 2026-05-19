import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import { constants } from "node:fs";

export type ValidationResult = {
  valid: boolean;
  reason?: string;
  actualHash?: string;
  expectedHash?: string;
};

export class PreimageValidator {
  /**
   * Validates that a file's current content matches the expected preimage hash.
   * Used to detect stale patches where the file has been modified since it was read.
   */
  async validate(filePath: string, expectedHash: string): Promise<ValidationResult> {
    // Check if file exists first
    try {
      await access(filePath, constants.F_OK);
    } catch {
      return {
        valid: false,
        reason: `File not found: ${filePath}`,
        expectedHash,
      };
    }

    try {
      const content = await readFile(filePath, "utf8");
      const actualHash = this.hashContent(content);

      if (actualHash !== expectedHash) {
        return {
          valid: false,
          reason: "stale patch: file has been modified since preimage was captured",
          actualHash,
          expectedHash,
        };
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        reason: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
        expectedHash,
      };
    }
  }

  /**
   * Computes SHA-256 hash of file content.
   */
  hashContent(content: string): string {
    return createHash("sha256").update(content).digest("hex");
  }

  /**
   * Generates a preimage hash checkpoint for a file.
   * Used to capture the file state before patching.
   */
  async generateCheckpoint(filePath: string): Promise<string> {
    const content = await readFile(filePath, "utf8");
    return this.hashContent(content);
  }
}