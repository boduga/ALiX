# DOX — Model Tier Decision (J3)

**Purpose:** Choose one of ALiX's enabled canonical compute classes for a task, using request FEATURES only. The tier is resolved to a concrete provider/model exclusively through the canonical `models.*` configuration.

**Ownership:**
- `tiers.ts` — `ROUTABLE_TIERS` (`tiny|fast|default|coding|thinking|critic`; `image` excluded as a modality, not a compute class), `listEnabledTiers(config)`, `isRoutableTier`, `assertRoutableTier`.
- `projection.ts` — `ModelTierProjection` (taskKind, promptChars, needsTools, needsVision, longContext), projector, `readModelTierProjection`. Provider/model names, prompt text, source and tool output never enter.
- `local-baseline.ts` — `chooseTierLocally`: task-kind preference order filtered to enabled tiers; abstains on vision and when nothing enabled fits.
- `jev-mapping.ts` — `toJevModelTierRequest` / `fromJevModelTierResponse`; options are tier names; a provider/model ID or non-candidate tier is malformed.
- `resolution.ts` — `resolveTierModel` / `describeCurrentRouting` / `tierMatchesCurrentRouting`, all via `resolveModelConfig` (canonical `models.*`).
- `corpus.ts` — feature→tier fixtures; `unsatisfiable` marks requests the decision must abstain on.
- `shadow.ts` — `runModelTierShadow`: run the route, journal every attempt, compare against current routing.
- `selection-service.ts` — `selectModelTier` with `off` (keep current routing) / `shadow` / `active`.
- `index.ts` — barrel.

**Local Contracts:**
- JEV-10: the candidate set is ALiX compute classes; Jev never sees or returns a provider/model ID. Resolution happens locally, after the choice.
- Candidate set = enabled canonical tiers (`isValidModelConfig(models[tier])`); unknown or disabled tiers are rejected, never coerced.
- Only task features cross the boundary — no prompt text, source, tool output, provider or model names.
- Vision requests abstain (the decision is not equipped to route modality) so existing routing keeps the call.
- Current routing stays the fallback: the default route is `existing-routing`, and a non-configured route yields an explicit failure, not a guess.
- No legacy alias or second model source: resolution reads `models.*` only, never the derived `model`/`subagents` projections.
- `modelTier.enabled` absent/false keeps the existing routing policy; `selectModelTier` defaults to mode `off`.
- Shadow results carry `authority: "none"`.
- Wire shape is `documented-unverified`; remote stays disabled until acknowledged.

**Known deferrals:**
- Active routing (mode `active`) is gated behind evaluation per the plan PR strategy ("model-tier routing in shadow mode, then separately activate"); no runtime call site consumes `selectModelTier` yet.

**Work Guidance:**
- A new candidate tier must be a canonical `MODEL_TIER_VALUES` entry and must be added to `ROUTABLE_TIERS` deliberately; `image` stays out.
- Keep `chooseTierLocally` deterministic and preference-ordered; never guess a tier that is not enabled.
- Resolution goes through `resolveModelConfig` — never read provider/model IDs from a decision result.

**Verification:**
- `tests/decision/model-tier.test.ts` — candidate enumeration, feature-only projection, baseline corpus/abstention, canonical resolution (legacy projection ignored), Jev mapping (no model IDs on the wire, malformed rejection), shadow (disabled/local/remote/fallback/existing-routing), `selectModelTier` off/shadow/active.

**Child DOX Index:** none.
