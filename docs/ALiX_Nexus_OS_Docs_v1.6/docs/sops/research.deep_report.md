# SOP: research.deep_report

All P0 SOP Packs must have a full acceptance contract before being considered shippable. This section defines those contracts. P1+ SOPs require acceptance contracts before their milestone ships.

### 33.1 research.deep_report Acceptance Contract

`research.deep_report` is the primary public showcase SOP.

**Required output artifacts:**

| Artifact | Required | Purpose |
|---|---|---|
| `final_report.md` | Yes | Human-readable report |
| `sources.json` | Yes | Source inventory with URLs, titles, dates, credibility notes |
| `claims.json` | Yes | Major claim-to-source mapping |
| `contradictions.md` | Yes | Conflicting claims or unresolved uncertainties |
| `critic_review.md` | Yes | Critic agent assessment |
| `run_manifest.json` | Yes | Graph, agents, models, tools, costs, timestamps |

**Acceptance criteria:**
- The report must use at least five distinct sources for broad research tasks unless fewer credible sources exist.
- Every major factual claim must map to at least one source in `claims.json`.
- Conflicting evidence must be listed in `contradictions.md`.
- The report must separate facts, interpretations, and recommendations.
- The critic agent must check for unsupported claims, stale sources, source concentration, and missing uncertainty statements.
- The final report cannot be marked complete until the critic pass completes.
- All web/tool/model calls must appear in the event trace.

**Demo command:**
```
alix sop run research.deep_report --topic "best vector backend for a TypeScript local-first agent OS"
```
