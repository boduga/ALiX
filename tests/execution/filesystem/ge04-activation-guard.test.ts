import test from "node:test";
import assert from "node:assert/strict";
import {
  createScopedMutationService,
  UnavailableScopedMutationService,
  type ScopedMutationAuthority,
} from "../../../src/execution/filesystem/scoped-mutation.js";

const authority: ScopedMutationAuthority = {
  workspaceRoot: "/tmp/unused-ge04-test",
  ownedScope: "owned",
  workerId: "test-worker",
  policyRevision: "test-policy",
  leaseId: "test-lease",
  approvalId: "test-approval",
};

for (const platform of ["linux", "darwin", "win32", "freebsd"] as const) {
  test(`GE-04 cannot activate on ${platform}, regardless of supplied metadata`, async () => {
    const service = createScopedMutationService(platform);
    assert.ok(service instanceof UnavailableScopedMutationService);
    await assert.rejects(
      service.mutate(authority, {
        kind: "create",
        relativePath: "sentinel.txt",
        content: new TextEncoder().encode("nothing must be written"),
      }),
      /qualified scoped mutation backend unavailable \(fail closed\)/,
    );
    await assert.rejects(
      service.mutate({ ...authority, approvalId: undefined }, {
        kind: "delete",
        relativePath: "sentinel.txt",
      }),
      /qualified scoped mutation backend unavailable \(fail closed\)/,
    );
  });
}
