# M0.62 Approval ID Regex Truncation Fix

**Goal:** Fix approval ID displayed to user being truncated at the second underscore, causing `/approve approval_123` to never match the stored ID `approval_123_abcde`.

**Root cause:** Regex `[a-zA-Z0-9-]` doesn't match `_`. Full ID `approval_1718100000000_a1b2c` matches as `approval_1718100000000` — the `_a1b2c` suffix is silently dropped.

**Fix:** Add `_` to regex character class: `[a-zA-Z0-9_-]`

---

## Files

- `src/runtime/route-executor.ts` — line 68: one-character regex fix
- `tests/tui/tui-approval-regex.test.ts` — guard test

## Implementation

### Step 1: Fix the regex

In `src/runtime/route-executor.ts`, change:
```typescript
const idMatch = reason.match(/(approval_[a-zA-Z0-9-]+)/);
```
To:
```typescript
const idMatch = reason.match(/(approval_[a-zA-Z0-9_-]+)/);
```

### Step 2: Guard test

Create `tests/tui/tui-approval-regex.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("approval ID regex", () => {
  const RE = /(approval_[a-zA-Z0-9_-]+)/;

  it("captures full ID with timestamp and random suffix", () => {
    const id = "approval_1718100000000_a1b2c";
    const match = id.match(RE);
    assert.ok(match);
    assert.equal(match[1], id);
  });

  it("captures ID with hyphens in random part", () => {
    const id = "approval_1718100000000_a1b2c-xyz";
    const match = id.match(RE);
    assert.ok(match);
    assert.equal(match[1], id);
  });

  it("does NOT match missing prefix", () => {
    const match = "no-match".match(RE);
    assert.equal(match, null);
  });

  it("extracts approval ID from full error message", () => {
    const msg = "Pending approval: approval_1718100000000_a1b2c";
    const match = msg.match(RE);
    assert.ok(match);
    assert.equal(match[1], "approval_1718100000000_a1b2c");
  });

  it("matches when ID is at end of string", () => {
    const msg = "Approval required: approval_123_xyz";
    const idMatch = msg.match(RE);
    assert.ok(idMatch);
    assert.equal(idMatch[1], "approval_123_xyz");
  });
});
```

### Step 3: Verify

```bash
npm run build
node --test dist/tests/tui/tui-approval-regex.test.js
```
