# Memory Auto-Capture

> **For agentic workers:** Use superpowers:subagent-driven-development or execute inline.

**Goal:** Automatically capture key decisions and learnings from each session into memory store.

**Tech Stack:** TypeScript, file-based memory store (already implemented)

---

## Task 1: Session Decision Extraction

**Files:**
- Create: `src/utils/memory/decision-extractor.ts`
- Modify: `src/run.ts`

### Steps

1. Create decision extractor:
```typescript
// Extract key decisions from session events
export function extractDecisions(events: Event[]): MemoryEntry[]

// Patterns to detect:
// - "We chose X because Y" → project decision
// - "User prefers X" → user preference
// - "Fixed by doing X" → feedback/lesson learned
```

2. Integrate into session end flow:
   - After session completes, extract decisions
   - Save to appropriate memory type
   - Update confidence based on confirmation

**Commit:** `git add src/utils/memory/decision-extractor.ts && git commit -m "feat: auto-extract decisions from session"`

---

## Task 2: Memory Confirmation Flow

**Files:**
- Modify: `src/utils/memory/decision-extractor.ts`
- Modify: `src/cli.ts`

### Steps

1. Add confirmation prompt after session:
```
[ALiX Memory] I noticed this decision: "User prefers TypeScript"
Save to memory? [y/n/q]
```

2. Implement confirmation handler that:
   - Increments confirmations on existing entries
   - Creates new entries with confidence 0.6
   - Allows quick edit before saving

**Commit:** `git add src/utils/memory/decision-extractor.ts src/cli.ts && git commit -m "feat: add memory confirmation flow"`

---

## Task 3: Memory Stats in Prompt

**Files:**
- Modify: `src/run.ts`

### Steps

1. Show memory context summary in session start:
```
Loaded 3 memories:
- [user] Prefers TypeScript (confirmed 5x)
- [project] We chose file-based storage (confirmed 2x)
- [feedback] Run tests before commit
```

2. Inject into system prompt for context

**Commit:** `git add src/run.ts && git commit -m "feat: show memory stats at session start"`

---

## Verification

```bash
npm test
node dist/src/cli.js memory stats
```

Manual checks:
- [ ] Decisions extracted after session
- [ ] Confirmation prompt works
- [ ] Memory context shown at start