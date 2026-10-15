7isInWorkspace ---

  it("relative path is inside workspace", () => {
    assert.ok(resolver.isInWorkspace("/home/user/project/src/index.ts"));
  });

  it("path outside workspace is rejected", () => {
    assert.ok(!resolver.isInWorkspace("/tmp/foo.txt"));
  });

  // --- isProtected ---

  it("detects .git paths as protected", () => {
    assert.ok(resolver.isProtected("/home/user/project/.git/config"));
  });

  it("detects .env as protected", () => {
    assert.ok(resolver.isProtected("/home/user/project/.env"));
  });

  it("non-protected path returns false", () => {
    assert.ok(!resolver.isProtected("/home/user/project/src/index.ts"));
  });

  // --- isSensitive ---

  it("detects .ssh paths as sensitive", () => {
    assert.ok(resolver.isSensitive("/home/user/.ssh/id_rsa"));
  });

  it("detects .alix paths as sensitive", () => {
    assert.ok(resolver.isSensitive("/home/user/project/.alix/approvals.json"));
  });

  it("detects .git as sensitive", () => {
    assert.ok(resolver.isSensitive("/home/user/project/.git/HEAD"));
  });

  it("non-sensitive path returns false", () => {
    assert.ok(!resolver.isSensitive("/home/user/project/src/index.ts"));
  });

  // --- check (full pipeline) ---

  it("check approves a normal workspace file", () => {
    const result = resolver.check("src/index.ts");
    assert.equal(result.insideWorkspace, true);
    assert.equal(result.protected, false);
    assert.equal(result.sensitive, false);
    assert.equal(result.reason, undefined);
  });

  it("check rejects sensitive .ssh path", () => {
    const result = resolver.check("~/.ssh/id_rsa");
    assert.equal(result.sensitive, true);
    assert.ok(result.reason);
  });

  it("check rejects .git path", () => {
    const result = resolver.check(".git/config");
    assert.equal(result.protected, true);
    assert.ok(result.reason);
  });

  it("check rejects .alix path via sensitivity", () => {
    const result = resolver.check(".alix/config.json");
    assert.equal(result.sensitive, true);
  });

  // --- isTraversalSafe ---

  it("rejects parent directory traversal", () => {
    assert.ok(!resolver.isTraversalSafe("../etc/passwd"));
    assert.ok(!resolver.isTraversalSafe("src/../../etc/passwd"));
  });

  it("rejects tilde expansion", () => {
    assert.ok(!resolver.isTraversalSafe("~/foo"));
  });

  it("accepts normal relative path", () => {
    assert.ok(resolver.isTraversalSafe("src/index.ts"));
    assert.ok(resolver.isTraversalSafe("./src/index.ts"));
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npm run build && node --test dist/tests/runtime/workspace-path.test.js
```

Expected: 18/18 tests pass

---

### Verification

1. `npm run build` — clean compile
2. `node --test dist/tests/runtime/workspace-path.test.js` — 18/18 pass
3. Full suite — no regressions
4. Git diff shows only the 2 intended files
5. No changes to patch-guard, policy-gate, policy-engine, file tools, or executor
