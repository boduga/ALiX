/**
 * skill-install-history.ts — Evidence for skill install decisions (Layer 3).
 *
 * Mirrors ConfigTrustHistory: every install gate decision — approved AND
 * blocked — is appended to the evidence store. Best-effort: a failure to
 * record evidence never fails the install.
 *
 * @module
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { EvidenceStore } from "./evidence-store.js";
import type { EvidenceRecord } from "./evidence-types.js";
import type { TrustLevel } from "../../skills/trust.js";

export interface SkillInstallRecord {
  skillName: string;
  source: string;
  trustLevel: TrustLevel;
  manifestName: string;
  manifestVersion: string;
  requestedTools: string[];
  license?: string;
  scanOk: boolean;
  scanErrorCount: number;
  scanWarningCount: number;
  approved: boolean;
  force: boolean;
  reason: string;
}

export class SkillInstallHistory {
  private readonly store: EvidenceStore;

  /**
   * @param storeDir - Defaults to `<home>/.alix/security`. Install.ts passes the
   *   explicit dir derived from `skillsDir` so test-HOME isolation applies.
   */
  constructor(storeDir?: string) {
    const root = storeDir ?? join(process.env.HOME ?? homedir(), ".alix", "security");
    this.store = new EvidenceStore({ storeDir: root });
  }

  async recordInstall(record: SkillInstallRecord): Promise<EvidenceRecord | null> {
    try {
      return await this.store.append("skill_installed", { ...record });
    } catch (err) {
      console.warn(`[SkillInstallHistory] Failed to record skill install evidence: ${err}`);
      return null;
    }
  }
}
