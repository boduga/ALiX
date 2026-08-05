import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { githubRawCandidates } from "../../../../src/cli/commands/skills/net.js";

describe("githubRawCandidates", () => {
  // Pure function — no fetch stubbing needed. The contract for tree URLs
  // is the load-bearing fix for the superpowers layout (skills/<name>/
  // SKILL.md under a tree URL pointing at the skills subdir). The repo-
  // root contract was already exercised indirectly through
  // resolveSkillInMarketplaces tests in marketplace.test.ts.

  it("generates <subdir>/<name>/SKILL.md for tree URLs", () => {
    // Per-name probe is the load-bearing fix: superpowers' static probe
    // used to emit only `<subdir>/SKILL.md` and never `<subdir>/<name>/`,
    // so any superpowers skill was unreachable by name.
    const candidates = githubRawCandidates(
      "https://github.com/obra/superpowers/tree/main/skills",
      "brainstorming",
    );
    assert.deepEqual(candidates, [
      "https://raw.githubusercontent.com/obra/superpowers/main/skills/SKILL.md",
      "https://raw.githubusercontent.com/obra/superpowers/main/skills/brainstorming/SKILL.md",
    ]);
  });

  it("generates only the subdir probe for tree URLs when no name is given", () => {
    // Without a name, only the subdir-root probe is generated — there's
    // no per-name path to compute. This is the "browse the marketplace
    // root" code path used by `alix skills available`.
    const candidates = githubRawCandidates("https://github.com/obra/superpowers/tree/main/skills");
    assert.deepEqual(candidates, [
      "https://raw.githubusercontent.com/obra/superpowers/main/skills/SKILL.md",
    ]);
  });

  it("generates the 3 repo-root paths for non-tree GitHub URLs", () => {
    // Sanity check that the fix didn't regress the standard layout.
    // For repo-root URLs, `<root>/skills/<name>/SKILL.md` IS a valid
    // probe (it's not the same as the 3rd probe for tree URLs, which
    // is a different `<subdir>/skills/<name>/` path that's a guaranteed
    // 404 when the tree URL already points at `skills/`).
    const candidates = githubRawCandidates("https://github.com/mattpocock/skills", "wayfinder");
    assert.deepEqual(candidates, [
      "https://raw.githubusercontent.com/mattpocock/skills/HEAD/SKILL.md",
      "https://raw.githubusercontent.com/mattpocock/skills/HEAD/wayfinder/SKILL.md",
      "https://raw.githubusercontent.com/mattpocock/skills/HEAD/skills/wayfinder/SKILL.md",
    ]);
  });

  it("uses the URL's ref (not HEAD) for non-default branches", () => {
    // The static probe must respect the ref segment of the tree URL.
    // Regression for the HEAD-hardcoding bug: a `tree/dev/skills`
    // marketplace should probe `dev/skills/...`, not `HEAD/skills/...`.
    const candidates = githubRawCandidates(
      "https://github.com/example/repo/tree/dev/skills",
      "foo",
    );
    assert.ok(candidates, "githubRawCandidates should return non-null for a tree URL");
    assert.equal(candidates[0], "https://raw.githubusercontent.com/example/repo/dev/skills/SKILL.md");
    assert.equal(candidates[1], "https://raw.githubusercontent.com/example/repo/dev/skills/foo/SKILL.md");
  });
});
