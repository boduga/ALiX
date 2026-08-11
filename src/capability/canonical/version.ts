// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

export interface ParsedVersion { major: number; minor: number; patch: number; }

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

export function isValidVersion(v: unknown): v is string {
  return typeof v === "string" && SEMVER_RE.test(v);
}

export function parseVersion(v: string): ParsedVersion {
  const m = SEMVER_RE.exec(v);
  if (!m) throw new Error(`capability: version '${v}' is not full SemVer MAJOR.MINOR.PATCH`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function formatVersionId(id: string, version: string): string {
  return `${id}@${version}`;
}

export function parseVersionId(ref: string): { id: string; version: string } {
  const at = ref.lastIndexOf("@");
  if (at <= 0) throw new Error(`capability: '${ref}' is not an id@version reference`);
  return { id: ref.slice(0, at), version: ref.slice(at + 1) };
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a); const pb = parseVersion(b);
  return (pa.major - pb.major) || (pa.minor - pb.minor) || (pa.patch - pb.patch);
}

export function bumpVersion(base: string, kind: "major" | "minor" | "patch"): string {
  const v = parseVersion(base);
  if (kind === "major") return `${v.major + 1}.0.0`;
  if (kind === "minor") return `${v.major}.${v.minor + 1}.0`;
  return `${v.major}.${v.minor}.${v.patch + 1}`;
}
