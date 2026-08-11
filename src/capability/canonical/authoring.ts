// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import type { CapabilityDefinition } from "./definition.js";
import { validateCapabilityDefinition } from "./definition.js";
import { isValidVersion } from "./version.js";

/** Two-phase authoring status (#478): A7 proposes gap; an operator authors
 * complete definition. required → incomplete → valid. A7 never invents defaults. */
export type DefinitionAuthoringStatus = "required" | "incomplete" | "valid";

export interface AuthoringAssessment { status: DefinitionAuthoringStatus; missing: string[]; }

const REQUIRED_FIELDS: (keyof CapabilityDefinition)[] = [
  "id", "version", "kind", "title", "description", "tags", "category",
  "risk", "requiredPermissions", "dependencies", "bindings",
];

/** Only these fields require a non-empty array. tags[]/dependencies[] may be
 * legitimately empty and still count as present (#479). */
const NON_EMPTY_ARRAY_FIELDS = new Set<keyof CapabilityDefinition>(["requiredPermissions", "bindings"]);

export function evaluateDefinitionAuthoring(
  input: Partial<CapabilityDefinition> | undefined,
): AuthoringAssessment {
  if (input === undefined || Object.keys(input).length === 0) return { status: "required", missing: REQUIRED_FIELDS as string[] };

  const missing: string[] = [];
  for (const f of REQUIRED_FIELDS) {
    const v = (input as Record<string, unknown>)[f];
    if (v === undefined) missing.push(f as string);
    else if (Array.isArray(v) && v.length === 0 && NON_EMPTY_ARRAY_FIELDS.has(f)) missing.push(f as string);
  }
  if (input.version !== undefined && !isValidVersion(input.version)) missing.push("version");
  // bindings empty handled above; also ensure non-empty array present
  if (Array.isArray(input.bindings) && input.bindings.length > 0) {
    // defer full validation to the "valid" check below
  }

  if (missing.length > 0) return { status: "incomplete", missing };

  try {
    validateCapabilityDefinition(input as CapabilityDefinition);
    return { status: "valid", missing: [] };
  } catch {
    return { status: "incomplete", missing: ["definition"] };
  }
}
