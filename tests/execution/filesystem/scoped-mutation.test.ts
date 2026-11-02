import test from "node:test";
import assert from "node:assert/strict";
import { createScopedMutationService, type ScopedMutationAuthority } from "../../../src/execution/filesystem/scoped-mutation.js";

const authority: ScopedMutationAuthority = {
  workspaceRoot: "/tmp/workspace", ownedScope: "owned", workerId: "worker-1",
  policyRevision: "rev-1", leaseId: "lease-1",
};

for (const platform of ["linux", "darwin", "win32"] as const) {
  test(`GE-04 scoped mutation fails closed on ${platform} without qualified backend`, async () => {
    const service = createScopedMutationService(platform);
    await assert.rejects(
      service.mutate(authority, { kind: "create", relativePath: "file.txt", content: new Uint8Array([1]) }),
      /qualified scoped mutation backend unavailable \(fail closed\)/,
    );
  });
}
