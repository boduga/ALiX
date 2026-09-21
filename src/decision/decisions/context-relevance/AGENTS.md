# DOX — Context Relevance Decision (J2)

**Purpose:** Score ONE context item against a compact objective (Noul probability), then rank/filter in deterministic code. Reduces irrelevant context without ever sending a memory/session dump.

**Ownership:**
- `projection.ts` — `ContextRelevanceProjection` (objective + one item's text), projector, `readRelevanceProjection`. The item's correlation id never crosses.
- `local-baseline.ts` — `scoreRelevanceLocally`: probability = fraction of objective content terms present; zero when the objective has no terms.
- `jev-mapping.ts` — `toJevRelevanceRequest` / `fromJevRelevanceResponse` (Noul primitive: P(relevant), no confidence).
- `thresholds.ts` — versioned, engine-specific profiles + `thresholdProfileForEngine` / `resolveRelevanceThreshold` (mismatch fails closed, JEV-9).
- `selection.ts` — `selectWithEngineThresholds`: per-engine threshold, rank desc, stable ties, optional cap.
- `corpus.ts` — labeled objective/item fixtures; `knownBaselineFalsePositive` marks cases the lexical baseline gets wrong on purpose (J4 signal).
- `shadow.ts` — `runContextRelevanceShadow`: one call per item, journal every attempt, select, no authority.
- `index.ts` — barrel.

**Local Contracts:**
- One item per call — a whole dump is never a projection (J2 exit criterion; hand-off §5.2).
- The model scores; deterministic code ranks, thresholds, and caps. The model never ranks a set.
- Each item is thresholded against ITS OWN engine's profile; a fallback engine never inherits another engine's calibration (JEV-9).
- Items no engine could score are KEPT, not dropped — the feature may reduce context, never silently remove context it could not judge.
- `contextRelevance.enabled` absent/false passes the original items through unchanged (existing behavior restored).
- Local baseline emits no confidence; Noul results carry probability only.
- Shadow results carry `authority: "none"`.
- Wire shape is `documented-unverified`; remote stays disabled until acknowledged (see `engines/jev.ts`).

**Work Guidance:**
- Tune thresholds only with J4 evidence; a new value means a new profile id (e.g. `context-relevance/jev/v2`), never an in-place edit of a calibrated one.
- A new engine needs its own profile before it can be used for this decision.
- Keep selection deterministic: no randomness, no clock, no I/O.

**Verification:**
- `tests/decision/context-relevance.test.ts` — projection bounds/redaction, baseline corpus + known FP, JEV-9 thresholds, selection determinism, Jev Noul mapping, shadow (disabled/independent/failure-keeps-item/cap).

**Child DOX Index:** none.
