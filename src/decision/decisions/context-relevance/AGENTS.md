# DOX — Context Relevance Decision (J2)

**Purpose:** Score ONE context item against a compact objective (Noul probability), then rank/filter in deterministic code. Reduces irrelevant context without ever sending a memory/session dump.

**Ownership:**
- `projection.ts` — `ContextRelevanceProjection` (objective + one item's text), projector, `readRelevanceProjection`. The item's correlation id never crosses.
- `local-baseline.ts` — `scoreRelevanceLocally`: probability = fraction of objective content terms present; zero when the objective has no terms.
- `jev-mapping.ts` — `toJevRelevanceRequest` / `fromJevRelevanceResponse` (Noul primitive: P(relevant), no confidence).
- `thresholds.ts` — context-relevance profiles seeded into the generic J4 registry as **shadow** (uncalibrated) entries; `thresholdProfileForEngine` (throwing), `tryThresholdProfileForEngine`, `resolveProfileForEngine`. All accept an optional registry, defaulting to the shadow-only seed.
- `selection.ts` — `selectWithEngineThresholds`: per-engine threshold, rank desc, stable ties, optional cap.
- `corpus.ts` — labeled objective/item fixtures; `knownBaselineFalsePositive` marks cases the lexical baseline gets wrong on purpose (J4 signal).
- `shadow.ts` — `runContextRelevanceShadow`: one call per item, journal every attempt, select, no authority.
- `selection-service.ts` — `selectContextItems`: the integration seam with `off` (identity, no engine call) / `shadow` / `active` modes.
- `index.ts` — barrel.

**Local Contracts:**
- One item per call — a whole dump is never a projection (J2 exit criterion; hand-off §5.2).
- The model scores; deterministic code ranks, thresholds, and caps. The model never ranks a set.
- Each item is thresholded against ITS OWN engine's profile; a fallback engine never inherits another engine's calibration (JEV-9).
- **No automation without a calibrated threshold.** The shipped profiles are `shadow`, so `thresholdProfileForEngine` throws until a calibrated profile is promoted; callers enable filtering by injecting a promoted registry via `deps.profiles`. This is the plan's "no calibrated threshold → shadow/observe, never silent automation" rule.
- The journaled `thresholdProfile` is the profile applied for that attempt's engine, not the route's configured one (they differ on fallback).
- Items no engine could score are KEPT, not dropped — the feature may reduce context, never silently remove context it could not judge.
- `contextRelevance.enabled` absent/false passes the original items through unchanged (existing behavior restored); `selectContextItems` defaults to mode `off` (identity, no engine call).
- Local baseline emits no confidence; Noul results carry probability only.
- Shadow results carry `authority: "none"`.
- Wire shape is `verified-against-docs` (see `engines/jev-protocol.ts` for the source links); remote is opt-in via `remote.jev.enabled`.

**Known deferrals:**
- Task 16's "empirical results" half is unmet: Noul was chosen from the documented primitive contract, not measured SDK behavior. Revisit in J4 with calibration data.
- The runtime context-builder call site for `selectContextItems` is deliberately deferred to the activation PR (plan PR strategy: "context relevance in shadow mode, then separately activate"). No runtime consumer calls it yet; `mode: "off"` is the tested default.

**Work Guidance:**
- Tune thresholds only with J4 evidence; a new value means a new profile id (e.g. `context-relevance/jev/v2`), never an in-place edit of a calibrated one.
- A new engine needs its own profile before it can be used for this decision.
- Keep selection deterministic: no randomness, no clock, no I/O.

**Verification:**
- `tests/decision/context-relevance.test.ts` — projection bounds/redaction, baseline corpus + known FP, engine-specific profile resolution, selection determinism, Jev Noul mapping, shadow (disabled/independent/failure-keeps-item/cap/profile-per-engine), `selectContextItems` off/shadow/active.

**Child DOX Index:** none.
