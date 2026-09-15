// tests/explain/explain-purity-sentinels.vitest.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { importedBindings, codeOnly } from "../helpers/import-graph.js";

const FORBIDDEN_IMPORTS = [
  "ProposalStore",
  "ApprovalGate",
  "AdaptationProposalStore",
  "AutomaticProposalGenerator",
  "AgentCardApplier",
  "SkillApplier",
  "RevertApplier",
  "runLearningRefresh",
];

const EXPLAIN_FILES = [
  "src/explain/proposal-explanation-assembler.ts",
  "src/cli/commands/explain.ts",
];

const FORBIDDEN_WRITE_CALLS = [
  ".append(",
  ".appendSignal(",
  ".appendProfile(",
  ".appendReport(",
  ".appendChain(",
  ".write(",
  ".writeFile(",
  ".appendFile(",
  ".save(",
  ".recordOutcome(",
  ".createProposal(",
  ".approveProposal(",
  ".applyProposal(",
  ".rejectProposal(",
  "runLearningRefresh(",
  "update_agent_card",
  "add_capability",
  "adjust_skill_definition",
];

const FORBIDDEN_FS_WRITES = ["appendFileSync", "writeFileSync", "createWriteStream"];

describe("Explain module purity sentinel", () => {
  for (const file of EXPLAIN_FILES) {
    it(`${file} has no forbidden imports`, () => {
      const bindings = importedBindings(join(process.cwd(), file));
      for (const forbidden of FORBIDDEN_IMPORTS) {
        expect(bindings.has(forbidden), `${file} imports ${forbidden}`).toBe(false);
      }
    });

    it(`${file} never calls any mutation method`, () => {
      const src = codeOnly(readFileSync(join(process.cwd(), file), "utf-8"));
      for (const call of FORBIDDEN_WRITE_CALLS) {
        expect(src, `${file} contains forbidden call ${call}`).not.toContain(call);
      }
    });

    it(`${file} never imports node:fs write APIs`, () => {
      const src = codeOnly(readFileSync(join(process.cwd(), file), "utf-8"));
      for (const call of FORBIDDEN_FS_WRITES) {
        expect(src, `${file} uses ${call}`).not.toContain(call);
      }
    });

    it(`${file} never references a forbidden mutation surface anywhere (incl. dynamic import)`, () => {
      // Comment-stripped whole-file scan: catches static imports, dynamic
      // `await import(...)`, `require(...)`, and any incidental reference,
      // while ignoring commented-out mentions. The read-only assembler/CLI
      // legitimately never name ProposalStore, ApprovalGate, appliers, or
      // runLearningRefresh, so a flat check is safe and closes the gap left
      // by the binding-only filter above.
      const src = codeOnly(readFileSync(join(process.cwd(), file), "utf-8"));
      for (const forbidden of FORBIDDEN_IMPORTS) {
        expect(src, `${file} references forbidden surface ${forbidden}`).not.toContain(forbidden);
      }
    });
  }
});
