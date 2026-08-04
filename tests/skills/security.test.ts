import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSkillContent } from "../../src/skills/types.js";
import { checkManifest, MANIFEST_DENY_CODES } from "../../src/skills/security.js";

describe("parseSkillContent manifest extensions", () => {
  it("parses allowed-tools (list), requires, license", () => {
    const { manifest } = parseSkillContent(
      "---\nname: x\ndescription: X\nallowed-tools: [bash, curl]\nrequires:\n  - git\nlicense: MIT\n---\nBody.\n",
    );
    assert.ok(manifest);
    assert.deepEqual(manifest.allowed_tools, ["bash", "curl"]);
    assert.deepEqual(manifest.requires, ["git"]);
    assert.equal(manifest.license, "MIT");
  });

  it("parses allowed-tools as a comma string", () => {
    const { manifest } = parseSkillContent("---\nname: x\ndescription: X\nallowed-tools: bash, curl\n---\nBody.\n");
    assert.ok(manifest);
    assert.deepEqual(manifest.allowed_tools, ["bash", "curl"]);
  });

  it("leaves fields undefined when absent", () => {
    const { manifest } = parseSkillContent("---\nname: x\ndescription: X\n---\nBody.\n");
    assert.ok(manifest);
    assert.equal(manifest.allowed_tools, undefined);
    assert.equal(manifest.requires, undefined);
    assert.equal(manifest.license, undefined);
  });
});

describe("checkManifest", () => {
  const manifest = {
    name: "x", description: "X", version: "1.0.0", is_core: false,
    allowed_tools: ["bash"], requires: ["git"], license: "MIT",
  };

  it("surfaces requested tools, requires, license", () => {
    const report = checkManifest(manifest);
    assert.deepEqual(report.requestedTools, ["bash"]);
    assert.deepEqual(report.requires, ["git"]);
    assert.equal(report.license, "MIT");
    assert.equal(report.deny, false);
  });

  it("denies a skill that spoofs is_core: true when not a core source", () => {
    const report = checkManifest({ ...manifest, is_core: true });
    assert.equal(report.deny, true);
    assert.equal(report.denyCode, MANIFEST_DENY_CODES.SPOOFED_CORE);
  });

  it("allows is_core: true when the source is core", () => {
    const report = checkManifest({ ...manifest, is_core: true }, { core: true });
    assert.equal(report.deny, false);
  });

  it("warns when requested tools include credential-reading classes", () => {
    const report = checkManifest({ ...manifest, allowed_tools: ["mcp__env__read_secrets"] });
    assert.ok(report.warnings.some((w) => w.includes("credential")));
  });
});
