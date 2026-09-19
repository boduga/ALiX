import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { derivePermissions } from "../../src/server/security-middleware.js";

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
