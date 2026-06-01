# Example: Fix a TypeScript error

**Task:**
```bash
alix run "fix the TS2322 error in src/auth.ts"
```

**What ALiX does:**

1. Classifies as `bugfix`
2. Reads `src/auth.ts`, finds the error
3. Makes the fix
4. Runs `tsc --noEmit` to verify
5. Reports the diff

**Expected output:**

```
Classified: bugfix
Context: src/auth.ts (245 lines)

Found: Property 'role' is missing in type 'User'
Fix: Add 'role: string' to User interface

Diff:
- export interface User { name: string; email: string; }
+ export interface User { name: string; email: string; role: string; }

Verification: ✓ TypeScript compiles
```

**Time:** ~30 seconds