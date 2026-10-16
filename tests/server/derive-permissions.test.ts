import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { derivePermissions } from "../../src/interfaces/server/security-middleware.js";

describe("derivePermissions", () => {
  it("grants coordination:execute to admin and operator", () => {
    for (const role of ["admin", "operator"]) {
      const perms = derivePermissions(role);
      assert.ok(perms.includes("coordination:read"), `${role} needs coordination:read`);
      assert.ok(perms.includes("coordination:execute"), `${role} needs coordination:execute`);
    }
  });

  it("does not grant coordination:execute to readonly", () => {
    const perms = derivePermissions("readonly");
    assert.ok(perms.includes("coordination:read"));
    assert.ok(!perms.includes("coordination:execute"));
  });

  it("grants nothing beyond health for an unknown role", () => {
    assert.deepEqual(derivePermissions("nobody"), ["health:read"]);
  });
});

// ---------------------------------------------------------------------------
// G3-C: approvals:decide (remote decision endpoint)
// ---------------------------------------------------------------------------

describe("derivePermissions — approvals:decide (G3-C)", () => {
  it("grants approvals:decide to admin and operator", () => {
    for (const role of ["admin", "operator"]) {
      assert.ok(
        derivePermissions(role).includes("approvals:decide"),
        `${role} must hold approvals:decide`,
      );
    }
  });

  it("does not grant approvals:decide to readonly", () => {
    assert.ok(!derivePermissions("readonly").includes("approvals:decide"));
  });

  it("does not grant approvals:decide to an unknown role", () => {
    assert.ok(!derivePermissions("nobody").includes("approvals:decide"));
  });
});
