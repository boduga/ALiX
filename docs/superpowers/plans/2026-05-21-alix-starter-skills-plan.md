# ALiX Starter Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create three core starter skills (TDD, Debug, Review) with lazy-loading architecture for skill content.

**Architecture:** 
- Skills live as `.md` files in `~/.alix/skills/<name>/SKILL.md`
- At startup: load only manifests (name, trigger, pattern) — lightweight metadata
- At request time: `SkillCatalog.match()` → lazy-load body only for matched skills
- An `alix skills install` command copies bundled skills to user config

**Tech Stack:** Node.js, TypeScript, Hermes-format skills (YAML front matter + markdown body)

---

### Task 0: Lazy-Load Skill Manifests at Startup

**Problem:** Currently `loadSkills()` reads full skill content (markdown body) at startup. This is wasteful — content is only needed when a skill matches.

**Fix:** Load only manifests at startup. Lazy-load body content only for matched skills.

**Files:**
- Modify: `src/skills/loader.ts` — separate manifest loading from body loading
- Modify: `src/run.ts` — use SkillCatalog.match() instead of injecting all skills
- Modify: `src/skills/catalog.ts` — add method to get matched skill bodies
- Test: `tests/skills/loader.test.ts`

- [ ] **Step 1: Modify loader.ts to separate manifest from body**

```typescript
// src/skills/loader.ts
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontMatter } from "./types.js";
import type { SkillManifest } from "./types.js";

const homeDir = process.env.HOME ?? "";
const skillsHome = join(homeDir, ".alix", "skills");

export interface SkillManifestOnly = {
  manifest: SkillManifest;
  path: string;
};

/**
 * Load only manifests (lightweight) — no body content.
 * Used at startup for catalog building.
 */
export async function loadSkillManifests(root: string): Promise<SkillManifestOnly[]> {
  const manifests: SkillManifestOnly[] = [];
  let entries: string[] = [];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const skillPath = join(root, entry);
    let isDir = false;
    try { isDir = (await stat(skillPath)).isDirectory(); } catch { continue; }
    if (!isDir) continue;
    const skillFile = join(skillPath, "SKILL.md");
    let content: string;
    try {
      content = await readFile(skillFile, "utf8");
    } catch {
      continue;
    }
    const manifest = parseFrontMatter(content);
    if (!manifest) continue;
    manifests.push({ manifest, path: skillPath });
  }

  return manifests;
}

/**
 * Load full skill content (manifest + body) for a specific path.
 * Used when a skill matches — lazy-load only what's needed.
 */
export async function loadSkillContent(path: string): Promise<{ manifest: SkillManifest; body: string } | null> {
  const skillFile = join(path, "SKILL.md");
  try {
    const content = await readFile(skillFile, "utf8");
    const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)/);
    if (!match) return null;
    const manifest = parseFrontMatter(match[1]);
    if (!manifest) return null;
    return { manifest, body: match[2] ?? "" };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Modify catalog.ts to store paths and lazy-load bodies**

```typescript
// Add to SkillCatalog class
private byPath: Map<string, string> = new Map(); // name → path

constructor(skills: SkillManifestOnly[]) {
  for (const skill of skills) {
    if (skill.manifest.trigger) {
      this.byTrigger.set(skill.manifest.trigger, skill.path);
      this.byPath.set(skill.manifest.name, skill.path);
    }
    if (skill.manifest.pattern) {
      try {
        this.byPattern.push({
          pattern: new RegExp(skill.manifest.pattern, "i"),
          name: skill.manifest.name,
          path: skill.path,
        });
      } catch {
        // skip invalid regex
      }
    }
  }
}

/**
 * Get full content (manifest + body) for matched skills only.
 * This is the lazy-load: only reads file content when skill matches.
 */
async getMatchedContent(prompt: string): Promise<Array<{ manifest: SkillManifest; body: string }>> {
  const matched = this.match(prompt); // returns paths
  const results = await Promise.all(
    matched.map(path => loadSkillContent(path))
  );
  return results.filter((r): r is { manifest: SkillManifest; body: string } => r !== null);
}
```

- [ ] **Step 3: Modify run.ts to use lazy loading**

```typescript
// Replace lines 237-238
const { loadSkillManifests } = await import("./skills/loader.js");
const skillManifests = await loadSkillManifests(skillsHome);
const skillCatalog = buildSkillCatalog(skillManifests);

// Replace buildSystemPrompt to use lazy loading
const matchedSkills = await skillCatalog.getMatchedContent(message.content);
if (matchedSkills.length > 0) {
  const skillSection = matchedSkills
    .map(s => `## Skill: ${s.manifest.trigger ?? s.manifest.name}\n${s.body}`)
    .join("\n\n");
  parts.push(`## Available Skills\n${skillSection}`);
}
```

- [ ] **Step 4: Run tests**

Run: `npm test 2>&1 | tail -10`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/skills/loader.ts src/skills/catalog.ts src/run.ts
git commit -m "perf(skills): lazy-load skill content only when matched

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 1: Create TDD Skill

**Files:**
- Create: `src/cli/commands/skills/tdd/SKILL.md`
- Modify: `src/cli/commands/skills/index.ts` (register skills command)
- Modify: `src/cli/commands/skills/install.ts` (install command)
- Test: `tests/cli/commands/skills/tdd.test.ts`

- [ ] **Step 1: Create the TDD skill file**

```markdown
---
name: tdd
description: Test-driven development with red-green-refactor loop. Use when user wants to build features or fix bugs using TDD, mentions "red-green-refactor", wants test-first development.
trigger: /tdd
pattern: "test.?first|tdd|red.?green|test.?driven"
version: "1.0.0"
is_core: true
tags: [testing, quality, development]
---

# Test-Driven Development

## Philosophy

**Core principle**: Tests should verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't.

**Good tests** are integration-style: they exercise real code paths through public APIs. They describe _what_ the system does, not _how_ it does it.

**Bad tests** are coupled to implementation. They mock internal collaborators, test private methods, or verify through external means.

## The Red-Green-Refactor Loop

1. **RED** — Write a failing test that describes the desired behavior
2. **GREEN** — Write minimal code to make the test pass
3. **REFACTOR** — Clean up code while keeping tests passing

## Key Rules

- **Vertical slices, not horizontal.** One test → one implementation → repeat. Don't write all tests first, then all code.
- **Test public interfaces.** If you rename an internal function and tests break, those tests were testing implementation.
- **One assertion focus.** Each test should verify one behavior. Multiple assertions are fine if they describe one capability.
- **Meaningful names.** Test names should read like specifications: `user can checkout with valid cart` not `testCheckout`.

## When to Use

Use `/tdd` when:
- Building a new feature
- Fixing a bug (write test first to reproduce)
- Adding to an untested module
- Refactoring existing code

## Anti-Pattern: Horizontal Slices

DO NOT write all tests first, then all implementation. This produces tests that:
- Test imagined behavior, not actual behavior
- Are insensitive to real changes
- Pass when behavior breaks, fail when behavior is fine

## Workflow

1. Identify the smallest piece of behavior to add
2. Write a failing test for that behavior
3. Write minimal code to pass the test
4. Verify test passes
5. Refactor for clarity
6. Repeat

## Examples

**Good test name:** `returns 404 when resource not found`
**Bad test name:** `testGetResource`

**Good test:** Calls public API, asserts on return value
**Bad test:** Mocks internal services, checks mock was called
```

- [ ] **Step 2: Create tests directory and write test**

```typescript
// tests/cli/commands/skills/tdd.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("tdd skill", () => {
  it("should have valid front matter", () => {
    const skillPath = join(process.cwd(), "src/cli/commands/skills/tdd/SKILL.md");
    const content = readFileSync(skillPath, "utf8");
    
    expect(content).toMatch(/^---\n/);
    expect(content).toMatch(/name: tdd/);
    expect(content).toMatch(/description:/);
    expect(content).toMatch(/trigger: \/tdd/);
    expect(content).toMatch(/version: "1\.0\.0"/);
    expect(content).toMatch(/is_core: true/);
  });

  it("should contain red-green-refactor guidance", () => {
    const skillPath = join(process.cwd(), "src/cli/commands/skills/tdd/SKILL.md");
    const content = readFileSync(skillPath, "utf8");
    
    expect(content).toMatch(/RED/);
    expect(content).toMatch(/GREEN/);
    expect(content).toMatch(/REFACTOR/);
    expect(content).toMatch(/vertical slices/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- --run tests/cli/commands/skills/tdd.test.ts`
Expected: FAIL with "file not found"

- [ ] **Step 4: Create the skill file**

Run: `mkdir -p src/cli/commands/skills/tdd`

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --run tests/cli/commands/skills/tdd.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/skills/tdd/SKILL.md tests/cli/commands/skills/tdd.test.ts
git commit -m "feat(skills): add TDD starter skill

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Create Debug Skill

**Files:**
- Create: `src/cli/commands/skills/debug/SKILL.md`
- Test: `tests/cli/commands/skills/debug.test.ts`

- [ ] **Step 1: Create the Debug skill file**

```markdown
---
name: debug
description: Systematic debugging using reproduce-minimize-hypothesize-instrument-fix-regression loop. Use when user reports a bug, says something is broken, or asks to diagnose an issue.
trigger: /debug
pattern: "debug|diagnose|fix this|broken|not working|error|fail"
version: "1.0.0"
is_core: true
tags: [debugging, troubleshooting, quality]
---

# Systematic Debugging

## Core Principle

**NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST.** Symptom fixes waste time and create new bugs.

## The Four Phases

### Phase 1: Root Cause Investigation

1. **Read error messages carefully** — They often contain the exact solution
2. **Reproduce consistently** — Can you trigger it reliably? What are the exact steps?
3. **Check recent changes** — What changed that could cause this?
4. **Gather evidence** — Log data flow, check state at each layer

### Phase 2: Pattern Analysis

1. **Find working examples** — What's similar that works?
2. **Compare against references** — Read the pattern implementation completely
3. **Identify differences** — What's different between working and broken?
4. **Understand dependencies** — What does this need?

### Phase 3: Hypothesis and Testing

1. **Form single hypothesis** — "I think X is the root cause because Y"
2. **Test minimally** — Smallest change to test hypothesis
3. **Verify before continuing** — Worked? Continue. Didn't? New hypothesis.

### Phase 4: Implementation

1. **Create failing test case** — Automated reproduction
2. **Implement single fix** — Address root cause only
3. **Verify fix** — Test passes, no regressions
4. **If fix doesn't work (3+ attempts):** Question the architecture

## Red Flags

Stop and follow process when you catch yourself thinking:
- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "It's probably X, let me fix that"
- "One more fix attempt" (after 2+ failures)

## When 3+ Fixes Failed

**Pattern indicating architectural problem:**
- Each fix reveals new shared state/coupling/problem in different place
- Fixes require massive refactoring to implement

**Action:** STOP and discuss with human partner. This is a wrong architecture, not a wrong hypothesis.

## Quick Reference

| Phase | Key Activities | Success Criteria |
|-------|---------------|-----------------|
| 1. Root Cause | Read errors, reproduce, check changes | Understand WHAT and WHY |
| 2. Pattern | Find working examples, compare | Identify differences |
| 3. Hypothesis | Form theory, test minimally | Confirmed or new hypothesis |
| 4. Implementation | Create test, fix, verify | Bug resolved, tests pass |
```

- [ ] **Step 2: Write test for debug skill**

```typescript
// tests/cli/commands/skills/debug.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("debug skill", () => {
  it("should have valid front matter", () => {
    const skillPath = join(process.cwd(), "src/cli/commands/skills/debug/SKILL.md");
    const content = readFileSync(skillPath, "utf8");
    
    expect(content).toMatch(/name: debug/);
    expect(content).toMatch(/trigger: \/debug/);
    expect(content).toMatch(/is_core: true/);
  });

  it("should contain systematic debugging phases", () => {
    const skillPath = join(process.cwd(), "src/cli/commands/skills/debug/SKILL.md");
    const content = readFileSync(skillPath, "utf8");
    
    expect(content).toMatch(/Phase 1.*Root Cause/s);
    expect(content).toMatch(/Phase 2.*Pattern/s);
    expect(content).toMatch(/Phase 3.*Hypothesis/s);
    expect(content).toMatch(/Phase 4.*Implementation/s);
    expect(content).toMatch(/Red Flags/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- --run tests/cli/commands/skills/debug.test.ts`
Expected: FAIL

- [ ] **Step 4: Create the skill file**

Run: `mkdir -p src/cli/commands/skills/debug`

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --run tests/cli/commands/skills/debug.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/skills/debug/SKILL.md tests/cli/commands/skills/debug.test.ts
git commit -m "feat(skills): add Debug starter skill

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Create Review Skill

**Files:**
- Create: `src/cli/commands/skills/review/SKILL.md`
- Test: `tests/cli/commands/skills/review.test.ts`

- [ ] **Step 1: Create the Review skill file**

```markdown
---
name: review
description: Code review with checklist covering security, performance, error handling, test coverage, and code quality. Use when user asks for review or wants to improve code quality.
trigger: /review
pattern: "review|check.*code|look.*over|assess|evaluate|audit|quality"
version: "1.0.0"
is_core: true
tags: [quality, review, security, performance]
---

# Code Review

## Core Principle

Reviews should improve code, not just check it. Find actionable improvements, not nitpicks.

## Review Checklist

### Security
- [ ] No hardcoded secrets, credentials, or API keys
- [ ] Input validation on all public interfaces
- [ ] Proper error handling (no stack traces to users)
- [ ] SQL injection, XSS, CSRF prevention
- [ ] File path traversal prevention
- [ ] Rate limiting on public endpoints

### Performance
- [ ] No N+1 queries
- [ ] Appropriate indexing for database queries
- [ ] Lazy loading where appropriate
- [ ] No blocking operations in hot paths
- [ ] Appropriate caching strategies
- [ ] No memory leaks (unbounded data structures, event listeners)

### Error Handling
- [ ] All async operations have error handling
- [ ] Errors are logged with context
- [ ] Fallback values are sensible
- [ ] No silently swallowed errors
- [ ] Timeouts on external calls

### Test Coverage
- [ ] New code has tests
- [ ] Tests cover happy path and error cases
- [ ] Tests are not overly mocked (testing behavior, not implementation)
- [ ] Edge cases are covered

### Code Quality
- [ ] No code duplication (DRY)
- [ ] Clear naming (intent is obvious)
- [ ] Appropriate abstraction level
- [ ] No commented-out dead code
- [ ] Consistent style
- [ ] Appropriate comments (WHY, not WHAT)

### API Design (if applicable)
- [ ] RESTful conventions followed
- [ ] Proper HTTP status codes
- [ ] Consistent response format
- [ ] Versioning strategy defined

## Review Workflow

1. **Understand the context** — What problem does this solve?
2. **Check the happy path** — Does it work for normal cases?
3. **Check error paths** — What happens on failures?
4. **Apply checklist** — Go through security, performance, etc.
5. **Provide actionable feedback** — Suggest HOW to fix, not just WHAT is wrong
6. **Approve or request changes** — Be clear about the gate

## Feedback Guidelines

- Be specific: "Line 42: X should handle empty array" not "X is wrong"
- Be kind: Critique code, not people
- Be helpful: Offer suggestions, not just criticism
- Be practical: Focus on real issues, not style preferences
- Be balanced: Acknowledge good work, not just problems

## When to Request Changes

Request changes for:
- Security vulnerabilities
- Breaking bugs
- Missing tests
- Performance regressions
- Violations of domain patterns

Approve with comments for:
- Style preferences
- Personal taste differences
- "I would have done it differently" without clear improvement

## Priority

1. **Blocking** — Must fix before merge (security, correctness)
2. **Important** — Should fix, but merge ok with comments (performance, coverage)
3. **Nice to have** — Consider fixing (style, readability)
4. **Nit** — Optional, don't block on (formatting, naming)
```

- [ ] **Step 2: Write test for review skill**

```typescript
// tests/cli/commands/skills/review.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("review skill", () => {
  it("should have valid front matter", () => {
    const skillPath = join(process.cwd(), "src/cli/commands/skills/review/SKILL.md");
    const content = readFileSync(skillPath, "utf8");
    
    expect(content).toMatch(/name: review/);
    expect(content).toMatch(/trigger: \/review/);
    expect(content).toMatch(/is_core: true/);
  });

  it("should contain review checklist sections", () => {
    const skillPath = join(process.cwd(), "src/cli/commands/skills/review/SKILL.md");
    const content = readFileSync(skillPath, "utf8");
    
    expect(content).toMatch(/Security/);
    expect(content).toMatch(/Performance/);
    expect(content).toMatch(/Error Handling/);
    expect(content).toMatch(/Test Coverage/);
    expect(content).toMatch(/Code Quality/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- --run tests/cli/commands/skills/review.test.ts`
Expected: FAIL

- [ ] **Step 4: Create the skill file**

Run: `mkdir -p src/cli/commands/skills/review`

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --run tests/cli/commands/skills/review.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/skills/review/SKILL.md tests/cli/commands/skills/review.test.ts
git commit -m "feat(skills): add Review starter skill

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Add Skills Install Command

**Files:**
- Create: `src/cli/commands/skills/install.ts`
- Modify: `src/cli.ts` (add skills command to CLI)
- Test: `tests/cli/commands/skills/install.test.ts`

- [ ] **Step 1: Create the install command**

```typescript
// src/cli/commands/skills/install.ts
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";

const homeDir = process.env.HOME ?? "";
const alixDir = join(homeDir, ".alix");
const skillsDir = join(alixDir, "skills");

export interface InstallOptions {
  list?: boolean;
  name?: string;
  all?: boolean;
}

export async function runInstall(opts: InstallOptions): Promise<void> {
  // Ensure .alix directory exists
  if (!existsSync(alixDir)) {
    await mkdir(alixDir, { recursive: true });
  }
  if (!existsSync(skillsDir)) {
    await mkdir(skillsDir, { recursive: true });
  }

  // List installed skills
  if (opts.list) {
    await listInstalledSkills(skillsDir);
    return;
  }

  // Install all core skills
  if (opts.all) {
    await installAllCoreSkills();
    return;
  }

  // Install specific skill
  if (opts.name) {
    await installSkill(opts.name);
    return;
  }

  // Default: show help
  console.log(`ALiX Skills Installer

Usage:
  alix skills install --all    Install all core skills
  alix skills install <name>    Install specific skill
  alix skills install --list   List installed skills

Core skills available:
  tdd     - Test-driven development
  debug   - Systematic debugging
  review  - Code review checklist
`);
}

async function installAllCoreSkills(): Promise<void> {
  const coreSkills = ["tdd", "debug", "review"];
  console.log("Installing core skills...\n");
  
  for (const name of coreSkills) {
    try {
      await installSkill(name);
    } catch (err) {
      console.error(`Failed to install ${name}: ${err}`);
    }
  }
}

async function installSkill(name: string): Promise<void> {
  // Source: bundled in CLI (src/cli/commands/skills/<name>/SKILL.md)
  const bundledPath = join(process.cwd(), "src", "cli", "commands", "skills", name, "SKILL.md");
  const destPath = join(skillsDir, name, "SKILL.md");

  if (!existsSync(bundledPath)) {
    throw new Error(`Skill '${name}' not found in bundle`);
  }

  // Create destination directory
  const destDir = join(skillsDir, name);
  await mkdir(destDir, { recursive: true });

  // Copy skill file
  await copyFile(bundledPath, destPath);
  console.log(`Installed: ${name}`);
}

async function listInstalledSkills(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    console.log("No skills installed.");
    return;
  }

  const entries = await readdir(dir);
  if (entries.length === 0) {
    console.log("No skills installed.");
    return;
  }

  console.log("Installed skills:\n");
  for (const name of entries) {
    const skillPath = join(dir, name, "SKILL.md");
    if (existsSync(skillPath)) {
      console.log(`  ${name}`);
    }
  }
}
```

- [ ] **Step 2: Write test for install command**

```typescript
// tests/cli/commands/skills/install.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runInstall } from "../../../src/cli/commands/skills/install.js";
import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { mkdirSync } from "node:fs/promises";

const testDir = join(process.cwd(), ".test-alix-skills");

describe("install command", () => {
  beforeEach(() => {
    // Mock HOME to test directory
    process.env.HOME = testDir;
    mkdirSync(join(testDir, ".alix", "skills"), { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should list installed skills", async () => {
    await runInstall({ list: true });
    // Test passes if no error thrown
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- --run tests/cli/commands/skills/install.test.ts`
Expected: FAIL

- [ ] **Step 4: Create the install command**

Run: `mkdir -p src/cli/commands/skills`

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --run tests/cli/commands/skills/install.test.ts`
Expected: PASS

- [ ] **Step 6: Wire into CLI**

Modify `src/cli.ts` to add:
```typescript
case "skills": {
  const { runInstall } = await import("./commands/skills/install.js");
  await runInstall({
    list: args.includes("--list"),
    all: args.includes("--all"),
    name: args.find(a => !a.startsWith("--")),
  });
  break;
}
```

- [ ] **Step 7: Run all tests**

Run: `npm test 2>&1 | tail -20`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add src/cli/commands/skills/install.ts tests/cli/commands/skills/install.test.ts src/cli.ts
git commit -m "feat(skills): add alix skills install command

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Self-Review Checklist

- [ ] TDD skill has valid front matter and red-green-refactor guidance
- [ ] Debug skill has all 4 phases with clear activities
- [ ] Review skill has checklist covering security, performance, error handling, tests, quality
- [ ] All skills use `is_core: true` and have appropriate triggers/patterns
- [ ] Install command works: `alix skills install --all`
- [ ] All tests pass

---

## Execution Options

Plan complete and saved to `docs/superpowers/plans/2026-05-21-alix-starter-skills-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?