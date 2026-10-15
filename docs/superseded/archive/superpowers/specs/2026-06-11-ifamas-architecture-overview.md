# IFÁ-MAS on ALiX — Architecture Overview

**Status:** ✅ Published (2026-06-11)
**Version:** 1.0 — Passive overlay complete (M0.43 through M0.56)
**Stack:** TypeScript-only. No Python runtime modules.

---

## 1. What IFÁ-MAS Is

IFÁ-MAS is a **passive symbolic coordination overlay** for ALiX. It does not replace or modify ALiX's existing runtime — it layers structured diagnostic reasoning on top of it.

### Architecture statement

```
        ┌─────────────────────────────────────────────────┐
        │                 IFÁ-MAS Overlay                  │
        │  (passive — observes, reasons, records, never   │
        │   executes tools, never bypasses policy)         │
        │                                                 │
        │  Signal → Offering → Envelope → Route → Gate    │
        │                                   → Select      │
        │                                                 │
        │  Display (TUI) → Persist (trace) → Learn (CL)   │
        │                                   → Recall      │
        └─────────────────────────────────────────────────┘
                           │
                           │ (reads context, writes memory)
                           ▼
        ┌─────────────────────────────────────────────────┐
        │              ALiX Runtime (unchanged)             │
        │  ToolExecutor · PolicyGate · ApprovalStore        │
        │  ReplayExecutor · RollbackExecutor · Trace       │
        │  MCP routing · Shell/file/web handlers           │
        └─────────────────────────────────────────────────┘
```

### What it produces

| Artifact | Type | Purpose |
|----------|------|---------|
| SignalFrame | 8-bit encoded state | What is happening |
| OfferingPlan | Prescribed action | What should be done |
| EssenceProfile | Agent identity | Who should handle it |
| BridgeEnvelope | Transport wrapper | Carry context safely |
| NexusRouteDecision | Routing recommendation | Where to send it |
| BridgeValidationResult | Structural check | Is it well-formed |
| GuildCandidate | Ranked agent list | Who is most compatible |
| IfamasDiagnostic | All-of-the-above | Full pipeline output |

---

## 2. Module Inventory

### Core runtime modules (src/runtime-state/runtime/)

| Module | Milestone | Lines | Responsibility |
|--------|-----------|-------|----------------|
| `signal-frame.ts` | M0.43 | 211 | 8-bit signal encode/decode, polarity inference |
| `offering-planner.ts` | M0.44 | 138 | Signal → advisory action mapping |
| `bridge-envelope.ts` | M0.47 | 145 | Envelope assembly + safety derivation |
| `nexus-router.ts` | M0.48 | 151 | 6-rule priority routing recommendation |
| `bridge-gateway.ts` | M0.49 | 225 | Envelope validation (6 rule groups) |
| `ifamas-pipeline.ts` | M0.51 | 131 | Orchestrator — chains all modules |

### Agent modules (src/agents/)

| Module | Milestone | Lines | Responsibility |
|--------|-----------|-------|----------------|
| `essence-profile.ts` | M0.45 | 227 | Agent identity + compatibility scoring |
| `guild-selector.ts` | M0.50 | 71 | Ranked agent selection from compat scores |

### Chronicle modules (src/context/chronicle/)

| Module | Milestone | Lines | Responsibility |
|--------|-----------|-------|----------------|
| `chronicle-store.ts` | M0.46 | 173 | File-backed case memory (JSON) |

### TUI modules (src/interfaces/tui/)

| Module | Milestone | Lines | Responsibility |
|--------|-----------|-------|----------------|
| `ifamas-panel.ts` | M0.52 | 28 | Diagnostic display formatter |
| `chronicle-panel.ts` | M0.55 | 57 | Historical entry display formatter |

### Test modules

| Test | Milestone | Tests | Scope |
|------|-----------|-------|-------|
| `signal-frame.test.ts` | M0.43 | 25 | Encoding, decoding, polarity, frame creation |
| `offering-planner.test.ts` | M0.44 | 16 | All 9 rules, priority, constraint passthrough |
| `essence-profile.test.ts` | M0.45 | 19 | Scoring dimensions, edge cases, clamping |
| `chronicle-store.test.ts` | M0.46 | 11 | Append, get, search, persistence |
| `bridge-envelope.test.ts` | M0.47 | 22 | Safety derivation, taboo dedup, optional fields |
| `nexus-router.test.ts` | M0.48 | 11 | All 6 rules, chronicle lookup, essence annotation |
| `bridge-gateway.test.ts` | M0.49 | 35 | All validation rules, ALL errors collected |
| `guild-selector.test.ts` | M0.50 | 8 | Sorting, compatible-first, stable sort |
| `ifamas-pipeline.test.ts` | M0.51/M0.53/4 | 14 | Full pipeline, event emission, chronicle writing |
| `trace-events-ifamas.test.ts` | M0.53 | 4 | Trace event normalization |
| `ifamas-panel.test.ts` | M0.52 | 8 | Display formatting, empty/invalid states |
| `chronicle-panel.test.ts` | M0.55 | 6 | Empty/multi/entry conversion, filters |
| `ifamas-smoke.test.ts` | M0.57 | 11 | **End-to-end: signal → recall** |

---

## 3. Passive Boundary Guarantees

The following components have **zero changes** across all IFÁ-MAS milestones (M0.43–M0.56):

| Component | Status | Evidence |
|-----------|--------|---------|
| **ToolExecutor** | 🛡️ Untouched | No imports, no references in any IFÁ-MAS module |
| **PolicyGate** | 🛡️ Untouched | No imports, no references in any IFÁ-MAS module |
| **ApprovalStore** | 🛡️ Untouched | No imports, no references in any IFÁ-MAS module |
| **Runtime routing** | 🛡️ Untouched | No `executeRoute`, no task dispatch calls |
| **ReplayExecutor** | 🛡️ Untouched | No replay/rollback execution |
| **MCP tools** | 🛡️ Untouched | No MCP tool invocation |

The overlay reads from `ChronicleStore` (optional) and writes to `EventLog` (optional) — both are non-fatal. If either fails, the diagnostic still succeeds.

---

## 4. Operator Lifecycle

```
                         ┌──────────────────┐
                         │  /ifamas          │
                         │  runs diagnostic  │
                         │  on trace event   │
                         └────────┬─────────┘
                                  │
                         ┌────────▼─────────┐
                         │  TUI displays     │
                         │  Signal/Offering/ │
                         │  Route/Gate/Guild │
                         └────────┬─────────┘
                                  │
                         ┌────────▼─────────┐
                         │  Trace event      │
                         │  persisted to     │
                         │  session file     │
                         └────────┬─────────┘
                                  │
                         ┌────────▼─────────┐
                         │  Chronicle entry  │
                         │  appended to      │
                         │  .alix/chronicle/ │
                         └────────┬─────────┘
                                  │
                         ┌────────▼─────────┐
                         │  /chronicle       │
                         │  search + recall  │
                         │  by signal/route  │
                         └──────────────────┘
```

---

## 5. Rule Systems

### Offering Planner (9 priority-ordered rules)

| Priority | Condition | Action |
|----------|-----------|--------|
| 1 | `approvalRequired` or `(toolRequired && policyRisk)` | `ask_approval` |
| 2 | `replayRollbackContext && mutationPossible` | `rollback_preview` |
| 3 | `replayRollbackContext` alone | `replay_preview` |
| 4 | `freshnessRequired && memoryRequired` | `fetch_memory` |
| 5 | `freshnessRequired` alone | `run_policy_check` |
| 6 | `memoryRequired` alone | `fetch_memory` |
| 7 | `policyRisk` alone | `run_policy_check` |
| 8 | `toolRequired` alone | `proceed` |
| 9 | Default | `proceed` |

### Nexus Router (6 priority-ordered rules)

| Priority | Condition | Target Role | Confidence |
|----------|-----------|-------------|------------|
| 1 | `offering.action === "ask_approval"` | `caller` | 80 |
| 2 | `offering.action === "pause"` | `nexus` | 85 |
| 3 | `safety.mutationPossible === true` | `bridge` | 75 |
| 4 | `action === "proceed"` and `!requiresPolicyGate` | `guild` | 70 |
| 5 | `requiresPolicyGate === true` | `bridge` | 65 |
| 6 | Default | `guild` | 50 |

### Essence Compatibility (4 scoring dimensions)

| Dimension | Max score | Key logic |
|-----------|-----------|-----------|
| Domain match | 40 | Profile domains include signal domain |
| Affinity bonus | 20 | Profile affinity maps to signal domain |
| Risk tolerance | 20 | High/dangerous or Low/safe → 20 |
| Offering alignment | 20 | Proceed+clean → 20, ask_approval+low risk → 20 |
| Violation penalty | -10 each | Constraints/taboos, capped at -40 |

---

## 6. Data Flow (End-to-End)

```
Step                              Output                    Used by
────                              ──────                    ───────
1. createSignalFrame(bits)        SignalFrame               M0.43
2. prescribeOffering(signal)      OfferingPlan              M0.44
3. buildBridgeEnvelope(sig,off)   BridgeEnvelope            M0.47
4. gateway.validateEnvelope(env)  BridgeValidationResult    M0.49
5. routeViaNexus(env,store)       NexusRouteDecision        M0.48
6. selector.select(env,cands)     GuildCandidate[]          M0.50
7. runIfamasDiagnostic(input)     IfamasDiagnostic          M0.51
8. eventLog.append(event)         TraceEvent                M0.53
9. chronicleStore.append(entry)   ChronicleEntry            M0.54
10. chronicleStore.search(q)      ChronicleEntry[]          M0.55
```

---

## 7. Design Decisions

### 7.1 Why passive?

The passive boundary is not an accident — it is the most important architectural constraint. By never executing tools or bypassing policy, IFÁ-MAS can be **proven safe** through code review alone. There is no path where an IFÁ-MAS module accidentally calls `executeTool` or changes runtime routing.

### 7.2 Bits, not semantics

The 8-bit Signal encodes conditions, not interpretations. The same bit pattern always produces the same offering, the same route, and the same compatibility score. This determinism makes the system testable and auditable.

### 7.3 Priority-ordered rules

All rule systems (Offering, Nexus, Essence) use **first-match-wins** priority ordering. This eliminates ambiguity: given identical inputs, the output is always identical. Adding a new rule means inserting it at the correct priority position.

### 7.4 Chronicle as learned memory

Chronicle entries are written after every diagnostic run. They record what was observed (signal), what was prescribed (offering), and what outcome was determined (gateway valid/invalid). This creates an audit trail that can be queried later without any machine learning.

---

## 8. Extension: Advisory Mode

The current passive overlay produces diagnostics and recommendations. The next architectural step is **advisory mode** — where IFÁ-MAS recommendations influence the existing ALiX runtime without violating the passive boundary.

### Design constraints for advisory mode

1. **Recommendations, not commands.** The OfferingPlan says `ask_approval`. The Nexus says route to `caller`. The runtime can still choose a different path.
2. **PolicyGate remains authoritative.** Even with an IFÁ-MAS recommendation of `proceed`, PolicyGate still evaluates the tool call independently.
3. **Opt-in.** Advisory mode is enabled per-session or per-command, never default.
4. **Transparent.** Every influence decision is logged as a trace event.

### Candidate integration points

| Integration | Risk | Value |
|-------------|------|-------|
| Pre-populate ApprovalStore with IFÁ-MAS rationale | Low | Operator sees "why" in approval prompt |
| Inject routeHint into TaskRouter decision | Medium | Tool selection could prefer recommended agents |
| Tag trace events with IFÁ-MAS offering action | Low | Better searchability |
| Chronicle entries feed into context compilation | Medium | Past failures inform new task planning |

---

## 9. Files on Disk

```
.alix/chronicle/
  index.json              — array of ChronicleEntry summaries
  entries/
    <entryId>.json        — full ChronicleEntry

(Replay-related files under .alix/replays/ are unchanged by IFÁ-MAS)
```

---

## 10. Quick Reference

```bash
# Build and test
npm run build
node --test dist/tests/runtime/ifamas-smoke.test.js

# Run a diagnostic in TUI
# 1. Select a trace event in the trace panel
# 2. Type /ifamas
# 3. View results in the IFÁ-MAS panel
# 4. Type /chronicle to search past diagnostics

# Commands
/ifamas                        # Run diagnostic on selected trace event
/chronicle                     # Recent chronicle entries
/chronicle signal:00100010    # Filter by signal code
/chronicle trace:<id>         # Filter by trace ID
/chronicle offering:proceed   # Filter by offering action
/chronicle route:guild        # Filter by route target
```

---

*End of architecture overview. All 14 milestones (M0.42–M0.56) complete on main as of 2026-06-11.*
