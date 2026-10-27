/**
 * policy-protected-path-parity.vitest.ts — parity table for the protected-path
 * decision in `PolicyGate`.
 *
 * WHY THIS EXISTS
 *
 * `PolicyGate.isProtectedPath` compared workspace-RELATIVE patterns (`.git/**`,
 * `.env`, `secrets/**` — the shipped defaults) against resolved ABSOLUTE paths.
 * They never matched, so the gate's protected-path rule silently never fired for
 * the default configuration. The file router and patch guard both caught these
 * writes, so nothing escaped in practice — but a policy rule that cannot fire is
 * a policy rule that is not a control.
 *
 * This is an authorization change (it changes what an allow/deny decision
 * authorizes), so per the repo rule it gets an expected-outcome TABLE broader
 * than the implementation, not a spot check of the fixed cases. Every row states
 * its expected verdict so a regression in ANY direction fails, including
 * over-blocking.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PolicyGate } from "../../src/governance/policy/policy-gate.js";
import { DEFAULT_CONFIG } from "../../src/operations/config/defaults.js";

const PATTERNS = DEFAULT_CONFIG.permissions.protectedPaths;

type Row = {
  /** Path as the model would supply it. */
  target: string;
  expect: "deny" | "allow";
  why: string;
};

/**
 * The full declared outcome table. Mixed deliberately:
 * - relative + absolute forms of the same protected target must agree
 * - enclosing and sibling names must not be over-blocked
 * - prefix collisions must not match (`src/file.ts` vs `src/file.tsx`)
 */
const ROWS: Row[] = [
  // ── protected targets, relative form ──
  { target: ".git/config", expect: "deny", why: "`.git/**` prefix match" },
  { target: ".env", expect: "deny", why: "exact pattern" },
  { target: ".env.local", expect: "deny", why: "`.env.*` pattern" },
  { target: "secrets/db.json", expect: "deny", why: "`secrets/**` prefix match" },
  { target: "secrets/nested/deep.json", expect: "deny", why: "`secrets/**` at depth" },
  { target: ".git", expect: "deny", why: "the prefix itself" },
  // ── protected targets, absolute form: MUST agree with relative ──
  { target: "<ABS>/.git/config", expect: "deny", why: "absolute path resolves to the same target" },
  { target: "<ABS>/.env", expect: "deny", why: "absolute exact" },
  { target: "<ABS>/secrets/x", expect: "deny", why: "absolute prefix" },
  // ── not protected: must NOT be over-blocked ──
  { target: "src/cli.ts", expect: "allow", why: "ordinary source file" },
  { target: "README.md", expect: "allow", why: "ordinary file" },
  { target: ".github/workflows/ci.yml", expect: "allow", why: "`.git/**` must not match `.github/`" },
  { target: ".gitignore", expect: "allow", why: "`.git/**` must not match `.gitignore`" },
  { target: ".environment", expect: "allow", why: "`.env` must not match a longer name" },
  { target: "secrets.txt", expect: "allow", why: "`secrets/**` must not match a sibling file" },
  { target: "src/secrets/x.ts", expect: "allow", why: "`secrets/**` is rooted, not a substring" },
  // ── outside the workspace: containment, not protection ──
  { target: "/etc/passwd", expect: "allow", why: "outside the workspace; containment is a different gate (router rejects it)" },
];

describe("PolicyGate protected-path parity", () => {
  for (const row of ROWS) {
    it(`${row.expect === "deny" ? "denies" : "allows"} ${row.target} — ${row.why}`, async () => {
      const root = mkdtempSync(join(tmpdir(), "parity-"));
      try {
        mkdirSync(join(root, ".git"), { recursive: true });
        mkdirSync(join(root, "secrets"), { recursive: true });
        mkdirSync(join(root, "src"), { recursive: true });

        const config = structuredClone(DEFAULT_CONFIG) as never as {
          permissions: { tools: Record<string, string> };
        };
        // Force the tool policy OUT of the way so the protected-path rule is what
        // is under test; a `file.write: allow` would otherwise mask it.
        config.permissions.tools["file.write"] = "allow";
        const gate = new PolicyGate(config as never);

        const target = row.target.replace("<ABS>", root);
        const decision = await gate.evaluateToolCall({
          requestId: "parity",
          toolName: "file.create",
          capability: "file.write",
          args: { path: target, content: "x" },
          cwd: root,
          sessionMode: "bypass",
          source: "tool",
        } as never);

        if (row.expect === "deny") {
          expect(decision.decision).toBe("deny");
          expect(decision.matchedRuleId).toBe("protected-path-rule");
        } else {
          expect(decision.decision).not.toBe("deny");
          expect(decision.matchedRuleId).not.toBe("protected-path-rule");
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }

  it("applies the same rule to patch targets under an owned scope", async () => {
    // `patch.apply` carries no `args.path`, so step 1 never sees its targets.
    // The owned-path branch must check them, or an owned patch could rewrite
    // `.git/config`.
    const root = mkdtempSync(join(tmpdir(), "parity-patch-"));
    try {
      mkdirSync(join(root, ".git"), { recursive: true });
      writeFileSync(join(root, ".git", "config"), "x");
      const config = structuredClone(DEFAULT_CONFIG) as never as {
        permissions: { tools: Record<string, string> };
      };
      config.permissions.tools["file.write"] = "allow";
      const gate = new PolicyGate(config as never);
      const decision = await gate.evaluateToolCall({
        requestId: "parity-patch",
        toolName: "patch.apply",
        capability: "file.write",
        args: {
          format: "search_replace",
          patchText: "<<<<<<< SEARCH path=.git/config\nx\n=======\ny\n>>>>>>> REPLACE",
        },
        cwd: root,
        sessionMode: "bypass",
        source: "tool",
        ownedPaths: [".git/config"],
      } as never);
      expect(decision.decision).toBe("deny");
      expect(decision.matchedRuleId).toBe("protected-path-rule");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
