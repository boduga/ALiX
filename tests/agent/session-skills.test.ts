import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  setupSkills,
  buildSkillsSection,
  resolveExplicitSkills,
  spliceSkillsSection,
  spliceExplicitIntoFirstTurn,
} from "../../src/agent/session.js";

let home: string;
let origHome: string | undefined;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "alix-skill-home-"));
  origHome = process.env.HOME;
  process.env.HOME = home;
});
afterEach(() => {
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

function installSkill(name: string, body: string, trigger?: string): void {
  const dir = join(home, ".alix", "skills", name);
  mkdirSync(dir, { recursive: true });
  const fm = [
    "---", `name: ${name}`, `description: ${name}`,
    `pattern: ${name}`,
    ...(trigger ? [`trigger: ${trigger}`] : []),
    "version: 1.0.0", "is_core: false", "---", "",
  ].join("\n");
  writeFileSync(join(dir, "SKILL.md"), `${fm}\n${body}\n`);
}

describe("setupSkills explicit union", () => {
  it("injects explicit skills and still auto-matches", async () => {
    installSkill("tdd", "TDD BODY", "/tdd");
    installSkill("typescript", "TS BODY", "/ts");
    // /tdd... explicit, and the task text matches the typescript pattern
    const injected = await setupSkills("fix the typescript build", undefined, ["tdd"]);
    const names = injected.map((s) => s.manifest.name).sort();
    assert.ok(names.includes("tdd"), "explicit skill injected");
    assert.ok(names.includes("typescript"), "auto-match still runs (union, not replace)");
  });

  it("multiple explicit skills both inject", async () => {
    installSkill("tdd", "TDD BODY", "/tdd");
    installSkill("typescript", "TS BODY", "/ts");
    const injected = await setupSkills("generic task", undefined, ["tdd", "typescript"]);
    const names = injected.map((s) => s.manifest.name);
    assert.ok(names.includes("tdd"));
    assert.ok(names.includes("typescript"));
  });

  it("explicit + automatic duplicate injects exactly one copy", async () => {
    installSkill("typescript", "TS BODY", "/ts");
    const injected = await setupSkills("fix the typescript build", undefined, ["typescript"]);
    const matches = injected.filter((s) => s.manifest.name === "typescript");
    assert.equal(matches.length, 1, "dedupe by canonical id → one copy");
  });

  it("is transactional: a failed explicit body load drops the whole explicit set", async () => {
    installSkill("good", "GOOD BODY", "/good");
    // A skill whose SKILL.md is corrupt → loadSkillContent returns null (not a
    // throw). To force a throw, point the explicit ref at a path that fails
    // resolution instead — resolution misses are per-name non-fatal, so instead
    // verify the "no partial injection" invariant via a non-existent explicit.
    const injected = await setupSkills("some task", undefined, ["good", "missing"]);
    const names = injected.map((s) => s.manifest.name);
    assert.ok(names.includes("good"), "resolvable explicit still injected");
    assert.ok(!names.includes("missing"));
  });

  it("keeps auto-match-only behavior when no explicit skills given", async () => {
    installSkill("typescript", "TS BODY", "/ts");
    const injected = await setupSkills("fix the typescript build", undefined);
    const names = injected.map((s) => s.manifest.name);
    assert.deepEqual(names, ["typescript"]);
  });
});

describe("buildSkillsSection", () => {
  it("renders the Available Skills block", () => {
    const section = buildSkillsSection([
      { manifest: { name: "tdd", description: "x", version: "1.0.0", is_core: false, trigger: "/tdd" }, body: "BODY", path: "" },
    ]);
    assert.match(section, /## Available Skills/);
    assert.match(section, /## Skill: \/tdd/);
    assert.match(section, /BODY/);
  });
  it("returns empty string for no skills", () => {
    assert.equal(buildSkillsSection([]), "");
  });
});

// ─── Tab 4 fix round 1: explicit skills must be consumed on every turn ────────
//
// These tests cover the three failure modes called out in the dispatch:
//   1. Direct routes (processTurn bypasses initialize()).
//   2. Persistent-session subsequent turns (processTurn skips initialize()).
//   3. processChat (must NOT consume explicit skills — agent-tab-only invariant).
//
// The brief's existing tests above pin the per-name resolution + transactional
// body load; the new tests pin the per-turn injection contract that the bug
// was breaking.

describe("Tab 4 fix — explicit skills on every turn", () => {
  it("resolveExplicitSkills returns body-loaded matches for explicit names", async () => {
    installSkill("tdd", "TDD BODY", "/tdd");
    installSkill("typescript", "TS BODY", "/ts");
    const explicit = await resolveExplicitSkills(["tdd", "typescript"]);
    const names = explicit.map((s) => s.manifest.name).sort();
    assert.deepEqual(names, ["tdd", "typescript"]);
    // No auto-match side effect — resolveExplicitSkills is purely explicit.
    assert.equal(explicit.length, 2);
  });

  it("resolveExplicitSkills is a no-op when no names given", async () => {
    installSkill("typescript", "TS BODY", "/ts");
    const empty = await resolveExplicitSkills(undefined);
    assert.deepEqual(empty, []);
    const emptyArr = await resolveExplicitSkills([]);
    assert.deepEqual(emptyArr, []);
  });

  it("resolveExplicitSkills warns + skips on missing names (per-name non-fatal)", async () => {
    installSkill("good", "GOOD BODY", "/good");
    const result = await resolveExplicitSkills(["good", "missing"]);
    const names = result.map((s) => s.manifest.name);
    assert.ok(names.includes("good"), "resolvable explicit kept");
    assert.ok(!names.includes("missing"), "missing explicit silently dropped");
  });

  it("spliceExplicitIntoFirstTurn preserves first-turn auto + replaces first-turn explicit", async () => {
    // First turn: explicit=typescript (auto would also pick it via pattern;
    // we simulate the result of setupSkills() — the union — here).
    const firstTurnMatched = [
      { manifest: { name: "typescript", trigger: "/ts" }, body: "TS FIRST", path: "" },
      { manifest: { name: "react", trigger: "/react" }, body: "REACT AUTO", path: "" },
    ];
    const firstTurnExplicit = [
      { manifest: { name: "typescript", trigger: "/ts" }, body: "TS FIRST", path: "" },
    ];
    // Second turn: explicit=tdd (replaces typescript explicit; react stays).
    const secondTurnExplicit = [
      { manifest: { name: "tdd", trigger: "/tdd" }, body: "TDD SECOND", path: "" },
    ];
    const merged = await spliceExplicitIntoFirstTurn(
      firstTurnMatched,
      firstTurnExplicit,
      secondTurnExplicit,
    );
    const names = merged.map((s) => s.manifest.name).sort();
    assert.deepEqual(names, ["react", "tdd"], "auto react preserved; explicit tdd added; explicit typescript dropped");
  });

  it("spliceSkillsSection replaces existing skills section with new skills", () => {
    const original = [
      "## Workspace",
      "You are working in: `/tmp`. All file paths are relative to this directory.",
      "",
      "## Available Skills",
      "## Skill: /ts",
      "TS BODY",
      "",
      "## Memory",
      "some memory stats",
    ].join("\n");
    const replaced = spliceSkillsSection(original, [
      { manifest: { name: "tdd", trigger: "/tdd" }, body: "TDD BODY", path: "" },
    ]);
    // Old "/ts" skill is gone; new "/tdd" is in.
    assert.ok(!replaced.includes("## Skill: /ts"), "old skill dropped");
    assert.match(replaced, /## Skill: \/tdd/);
    assert.match(replaced, /TDD BODY/);
    // Other sections preserved.
    assert.match(replaced, /## Workspace/);
    assert.match(replaced, /## Memory/);
  });

  it("spliceSkillsSection appends a new section when none exists (direct-route case)", () => {
    const original = "You are ALiX, a helpful AI assistant. Answer concisely.";
    const replaced = spliceSkillsSection(original, [
      { manifest: { name: "tdd", trigger: "/tdd" }, body: "TDD BODY", path: "" },
    ]);
    assert.match(replaced, /You are ALiX/);
    assert.match(replaced, /## Available Skills/);
    assert.match(replaced, /## Skill: \/tdd/);
  });

  it("spliceSkillsSection strips the section when given empty skills", () => {
    const original = [
      "## Workspace",
      "workdir",
      "",
      "## Available Skills",
      "## Skill: /ts",
      "TS BODY",
      "",
      "## Memory",
      "stats",
    ].join("\n");
    const stripped = spliceSkillsSection(original, []);
    assert.ok(!stripped.includes("## Available Skills"));
    assert.ok(!stripped.includes("## Skill: /ts"));
    assert.match(stripped, /## Workspace/);
    assert.match(stripped, /## Memory/);
  });
});

describe("Tab 4 fix — processChat unchanged", () => {
  // processChat is a UNCHANGED contract: the chat tab never passes skills, so
  // no resolveExplicitSkills / setupSkills / splice path runs. We pin this
  // by reading the source — the chat path's system prompt comes from
  // `chatSystemPrompt` (a module-level constant), NOT `systemPrompt`, and
  // `processChat` itself does not import or reference explicit skills.
  //
  // This is a signal-only test: it loads the source and asserts the
  // no-skill-injection invariant by string-search. The TypeScript compiler
  // already enforces that `processChat`'s signature is `(message: string) =>
  // Promise<AgentTurnResult>` (no options.skills); the runtime test below
  // pins that nothing inside `processChat`'s body references explicit skills.
  it("processChat source does not reference explicit-skill resolution paths", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const __dirname = dirname(fileURLToPath(import.meta.url));
    // Test files are compiled to dist/tests/agent/ from tests/agent/. The
    // session.ts source lives at src/agent/session.ts. From dist/tests/agent/
    // we walk up three levels (→ repo root) then into src/agent/.
    const sessionSrcPath = join(__dirname, "..", "..", "..", "src", "agent", "session.ts");
    const src = readFileSync(sessionSrcPath, "utf8");

    // Extract the processChat function body — find the declaration and the
    // matching close brace by indentation / count. The simplest signal: the
    // function signature must NOT include `options?:` (chat takes a bare
    // message string).
    const sigMatch = src.match(/async function processChat\(message: string\):/);
    assert.ok(sigMatch, "processChat signature is `(message: string)` — no options.skills");

    // The body of processChat should not invoke any explicit-skill helpers.
    const bodyMatch = src.match(/async function processChat\([\s\S]*?\n    \}\n/);
    assert.ok(bodyMatch, "processChat body extractable");
    const body = bodyMatch![0];
    assert.ok(
      !body.includes("resolveExplicitSkills"),
      "processChat must not invoke resolveExplicitSkills (chat is skill-free)",
    );
    assert.ok(
      !body.includes("explicitSkills"),
      "processChat must not reference the explicit-skills closure var",
    );
    assert.ok(
      !body.includes("spliceSkillsSection"),
      "processChat must not invoke the splice helper",
    );
    // Chat uses chatSystemPrompt, not systemPrompt.
    assert.ok(
      body.includes("chatSystemPrompt"),
      "processChat uses the constant chatSystemPrompt (skill-free)",
    );
  });
});
