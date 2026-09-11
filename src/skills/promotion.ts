// src/skills/promotion.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseSkillContent } from "./types.js";
import { loadSkillManifests, loadSkillContent } from "./loader.js";
import { findCandidateCollisions, isDuplicateBody } from "./pollution.js";
import { canonicalSkillId } from "./slash.js";

const homeDir = process.env.HOME ?? "";
const candidatesDir = join(homeDir, ".alix", "candidates");
const skillsDir = join(homeDir, ".alix", "skills");

type UsageRecord = {
  lastUsed: string;
  successCount: number;
};

const usagePath = join(skillsDir, ".usage.json");

function readUsage(): Record<string, UsageRecord> {
  try { return JSON.parse(readFileSync(usagePath, "utf8")); } catch { return {}; }
}

function writeUsage(usage: Record<string, UsageRecord>): void {
  try {
    if (!existsSync(skillsDir)) mkdirSync(skillsDir, { recursive: true });
    writeFileSync(usagePath, JSON.stringify(usage, null, 2), "utf8");
  } catch {}
}

function readCandidate(sessionId: string): string | null {
  const candidatePath = join(candidatesDir, sessionId, "SKILL.md");
  try { return readFileSync(candidatePath, "utf8"); } catch { return null; }
}

export async function promoteIfEligible(
  sessionId: string,
): Promise<{ promoted: boolean; name: string; blocked?: string }> {
  const content = readCandidate(sessionId);
  if (!content) return { promoted: false, name: "" };

  const { manifest, body: candidateBody } = parseSkillContent(content);
  if (!manifest) return { promoted: false, name: "" };

  const usage = readUsage();
  const skillName = manifest.name;

  if (!usage[skillName]) {
    usage[skillName] = { lastUsed: new Date().toISOString(), successCount: 0 };
  }
  usage[skillName].lastUsed = new Date().toISOString();
  usage[skillName].successCount++;

  const shouldPromote = usage[skillName].successCount >= 2;

  if (shouldPromote) {
    // Pollution gate: refuse to install a candidate that collides with an
    // installed skill (shared trigger, subsuming pattern + similar text).
    // Same-name pairs are skipped by the detector (resolveNamingCollision
    // owns versioning below). Manifest-only scan — no body reads.
    const installed = await loadSkillManifests(skillsDir);
    const collisions = findCandidateCollisions(
      { manifest },
      installed.map((entry) => ({ manifest: entry.manifest })),
      { includeBody: false },
    );
    if (collisions.length > 0) {
      const clash = collisions[0];
      const other = clash.a === skillName ? clash.b : clash.a;
      const reason =
        `collides with installed skill "${other}" ` +
        `(score ${clash.score.toFixed(2)}` +
        `${clash.signals.sameTrigger ? ", shared trigger" : ""}` +
        `${clash.signals.patternOverlap ? ", overlapping pattern" : ""})`;
      console.warn(`[skill-promotion] Blocked "${skillName}": ${reason}.`);
      writeUsage(usage);
      return { promoted: false, name: skillName, blocked: reason };
    }

    // Same-name body gate: a candidate whose body is a near-duplicate of
    // the installed same-name skill adds nothing — block instead of
    // minting a version-suffixed copy. Genuinely revised bodies fall
    // through to versioning below. Single file read, only on name hits.
    const sameName = installed.find(
      (entry) => canonicalSkillId(entry.manifest) === skillName,
    );
    if (sameName) {
      const installedContent = await loadSkillContent(sameName.path);
      const installedBody = installedContent?.body ?? "";
      if (isDuplicateBody(candidateBody, installedBody)) {
        const reason =
          `body duplicates installed skill "${skillName}" — no new content to version`;
        console.warn(`[skill-promotion] Blocked "${skillName}": ${reason}.`);
        writeUsage(usage);
        return { promoted: false, name: skillName, blocked: reason };
      }
    }

    const finalName = resolveNamingCollision(skillName, manifest.version ?? "1.0.0");
    const targetDir = join(skillsDir, finalName);
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, "SKILL.md"), content, "utf8");
    usage[skillName] = { lastUsed: new Date().toISOString(), successCount: usage[skillName].successCount };
    writeUsage(usage);
    return { promoted: true, name: finalName };
  }

  writeUsage(usage);
  return { promoted: false, name: skillName };
}

export function resolveNamingCollision(name: string, version: string): string {
  const targetPath = join(skillsDir, name, "SKILL.md");
  if (!existsSync(targetPath)) return name;

  const existing = parseSkillContent(readFileSync(targetPath, "utf8"));
  if (!existing.manifest) return name;

  // If the existing file's name doesn't match our name, it's already suffixed.
  // Don't overwrite it — create a new suffixed version instead.
  if (existing.manifest.name !== name) {
    const suffix = version.replace(/\./g, "-");
    return `${name}-v${suffix}`;
  }

  const existingVer = existing.manifest.version ?? "1.0.0";
  if (compareVersions(version, existingVer) > 0) {
    return name; // improvement — overwrite
  }
  // Same or lower version — variation: add version suffix
  const suffix = version.replace(/\./g, "-");
  return `${name}-v${suffix}`;
}

function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const na = partsA[i] ?? 0;
    const nb = partsB[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}