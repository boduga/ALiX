# P0.72 — Write Detection Edge Cases

**Goal:** Support more natural-language file creation patterns like `create a file called test.txt with hello` and `make a file named foo with content bar`.

**Architecture:** Add new pattern regexes to `src/runtime/task-router.ts` in the `matchNaturalFileOperation()` function.

---

### Task 1: Add new patterns

**Files:**
- Modify: `src/runtime/task-router.ts`

Add after existing pattern constants:

```typescript
// "create a file called Y with X"
const FILE_CREATE_NAMED_PATTERN = /^create\s+a\s+file\s+(?:called|named)\s+(.+?)\s+(?:with|containing)\s+(.+)$/i;
// "make a file called Y with X"
const MAKE_FILE_NAMED_PATTERN = /^make\s+a\s+file\s+(?:called|named)\s+(.+?)\s+(?:with|containing)\s+(.+)$/i;
// "create file Y with X"
const CREATE_FILE_PATTERN = /^create\s+file\s+(.+?)\s+(?:with|containing)\s+(.+)$/i;
```

In `matchNaturalFileOperation()`, add before the `FILE_WRITE_PATTERN` check:

```typescript
  // "create a file called Y with X"
  match = trimmed.match(FILE_CREATE_NAMED_PATTERN);
  if (match) {
    if (!looksLikeFileTarget(match[1].trim())) return null;
    return `printf '%s\\n' ${shellQuote(content(match[2]))} > ${shellQuote(match[1].trim())}`;
  }

  // "make a file called Y with X"
  match = trimmed.match(MAKE_FILE_NAMED_PATTERN);
  if (match) {
    if (!looksLikeFileTarget(match[1].trim())) return null;
    return `printf '%s\\n' ${shellQuote(content(match[2]))} > ${shellQuote(match[1].trim())}`;
  }

  // "create file Y with X"
  match = trimmed.match(CREATE_FILE_PATTERN);
  if (match) {
    if (!looksLikeFileTarget(match[1].trim())) return null;
    return `printf '%s\\n' ${shellQuote(content(match[2]))} > ${shellQuote(match[1].trim())}`;
  }
```

### Task 2: Add tests

Add to `tests/runtime/task-router-natural-file-hardening.test.ts`:

```typescript
  it('"create a file called test.txt with hello" routes to tool', () => {
    const route = taskRouter("create a file called test.txt with hello");
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      assert.ok(route.args.command.includes("printf"));
      assert.ok(route.args.command.includes("'test.txt'"));
    }
  });

  it('"make a file named foo.txt with content bar" routes to tool', () => {
    const route = taskRouter("make a file named foo.txt with content bar");
    assert.equal(route.kind, "tool");
  });

  it('"create file output.txt with hello world" routes to tool', () => {
    const route = taskRouter("create file output.txt with hello world");
    assert.equal(route.kind, "tool");
  });

  it('"create a file called readme with notes" rejected (no extension)', () => {
    const route = taskRouter("create a file called readme with notes");
    assert.notEqual(route.kind, "tool"); // blocked by looksLikeFileTarget
  });
```

### Verification

```bash
npm run build && node --test dist/tests/runtime/task-router-natural-file-hardening.test.js
```
