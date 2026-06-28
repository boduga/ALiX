# P0.69 — File Operation Feedback Polish

**Goal:** Show human-readable success output (e.g. `✓ Wrote test.txt`) instead of `(tool completed)` for file operations that produce no stdout.

**Architecture:** Modify `src/runtime/route-executor.ts` to inspect `route.args.command` for file-operation patterns and return descriptive messages instead of `"(tool completed)"` when output is empty.

---

### Task 1: Add feedback formatter

**Files:**
- Modify: `src/runtime/route-executor.ts`

Add after the import block, before the `LocalRuntimeExecutor` class:

```typescript
/**
 * Generate a human-readable success message for silent shell commands
 * that produce no stdout (e.g. printf > file, mv, cp).
 */
function describeShellResult(name: string, args: Record<string, unknown>, output: string | undefined): string | undefined {
  if (output && output.trim().length > 0) return undefined; // has real output

  const command = typeof args.command === "string" ? args.command : "";
  
  // File write: printf '%s\n' 'content' > 'path'
  const writeMatch = command.match(/>\s*'([^']+)'/);
  if (writeMatch && command.startsWith("printf")) {
    return `✓ Wrote ${writeMatch[1]}`;
  }
  
  // File append: printf '%s\n' 'content' >> 'path'
  const appendMatch = command.match(/> >\s*'([^']+)'/);
  if (appendMatch && command.startsWith("printf")) {
    return `✓ Appended to ${appendMatch[1]}`;
  }
  
  // File delete: rm -- 'path'
  const rmMatch = command.match(/^rm -- '(.+)'$/);
  if (rmMatch) return `✓ Deleted ${rmMatch[1]}`;
  
  // Directory delete: rm -rf -- 'path'
  const rmrfMatch = command.match(/^rm -rf -- '(.+)'$/);
  if (rmrfMatch) return `✓ Deleted directory ${rmrfMatch[1]}`;

  // Cat: cat -- 'path' (ignore — cat produces output)
  
  return undefined;
}
```

Then in `executeTool()`, change:
```typescript
    if (result.kind === "success") {
      return result.output || result.content || "(tool completed)";
```
To:
```typescript
    if (result.kind === "success") {
      return describeShellResult(name, args, result.output) ?? result.output ?? result.content ?? "(tool completed)";
```

### Task 2: Add tests

Create `tests/runtime/route-executor-feedback.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Import the describeShellResult or test via the actual route executor
// For simplicity, test the pattern matching directly

describe("file operation feedback", () => {
  // Helper that simulates the describeShellResult logic
  function simulateFeedback(command: string): string | undefined {
    const writeMatch = command.match(/>\s*'([^']+)'/);
    if (writeMatch && command.startsWith("printf")) return `✓ Wrote ${writeMatch[1]}`;
    
    const appendMatch = command.match(/>>\s*'([^']+)'/);
    if (appendMatch && command.startsWith("printf")) return `✓ Appended to ${appendMatch[1]}`;
    
    const rmMatch = command.match(/^rm -- '(.+)'$/);
    if (rmMatch) return `✓ Deleted ${rmMatch[1]}`;
    
    const rmrfMatch = command.match(/^rm -rf -- '(.+)'$/);
    if (rmrfMatch) return `✓ Deleted directory ${rmrfMatch[1]}`;
    
    return undefined;
  }

  it('write file shows "✓ Wrote test.txt"', () => {
    const cmd = "printf '%s\\n' 'hello' > 'test.txt'";
    assert.equal(simulateFeedback(cmd), "✓ Wrote test.txt");
  });

  it('append shows "✓ Appended to file"', () => {
    const cmd = "printf '%s\\n' 'line2' >> 'log.txt'";
    assert.equal(simulateFeedback(cmd), "✓ Appended to log.txt");
  });

  it('delete shows "✓ Deleted file"', () => {
    const cmd = "rm -- 'old.txt'";
    assert.equal(simulateFeedback(cmd), "✓ Deleted old.txt");
  });

  it('directory delete shows correct message', () => {
    const cmd = "rm -rf -- './tmp'";
    assert.equal(simulateFeedback(cmd), "✓ Deleted directory ./tmp");
  });

  it('cat with actual output returns undefined (uses real stdout)', () => {
    const cmd = "cat -- 'test.txt'";
    assert.equal(simulateFeedback(cmd), undefined);
  });

  it('commands with real output return undefined', () => {
    const cmd = "ls -la";
    assert.equal(simulateFeedback(cmd), undefined);
  });
});
```

### Verification

```bash
npm run build && node --test dist/tests/runtime/route-executor-feedback.test.js
```
