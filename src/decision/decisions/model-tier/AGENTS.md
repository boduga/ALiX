# DOX — Model Tier Decision (J3)

**Purpose:** Choose one of ALiX's enabled canonical tiers for a task, using request FEATURES only. The tier is resolved to a concrete provider/model exclusively through the canonical `models.*` configuration.

**Ownership:**
- `tiers.ts` — `TIER_CANDIDATES` (= canonical `MODEL_TIER_VALUES`, `image` included), `listEnabledTiers(config)`, `isModelTierValue`, `filterTierCandidates`, `assertEnabledTier`.
- `projection.ts` — `ModelTierProjection` (taskKind, promptChars, needsTools, needsVision, longContext), projector, `readModelTierProjection`. Provider/model names, prompt text, source and tool output never enter.
- `local-baseline.ts` — `chooseTierLocally`: task-kind preference order filtered to enabled tiers; image tasks route to `image`; abstains only when nothing enabled fits.
- `jev-mapping.ts` — `toJevModelTierRequest` / `fromJevModelTierResponse`; options are tier names; a provider/model ID or non-candidate tier is malformed.
- `resolution.ts` — `resolveTierModel` / `describeCurrentRouting` / `tierMatchesCurrentRouting`, all via `resolveModelConfig` (canonical `models.*`).
- `corpus.ts` — feature→tier fixtures; `unsatisfiable` marks requests the decision must abstain on.
- `shadow.ts` — `runModelTierShadow`: run the route, journal every attempt, compare against current routing.
- `selection-service.ts` — `selectModelTier` with `off` (keep current routing) / `shadow` / `active`.
- `index.ts` — barrel.

**Local Contracts:**
- JEV-10: the candidate set is ALiX tiers; Jev never sees or returns a provider/model ID. Resolution happens locally, after the choice.
- Candidate set = enabled canonical tiers (`isValidModelConfig(models[tier])`); unknown or unconfigured tiers are rejected, never coerced.
- `image` IS a candidate: it is the tier for image-generation tasks (e.g. a nano-banana-class model configured as `models.image`). If it is not configured, an image task abstains rather than falling back to a text tier.
- **Hard constraints belong to the caller.** `needsVision` (image INPUT) is a hint, not a gate: the caller excludes tiers that cannot satisfy a pass/fail requirement before invoking the decision. A probabilistic decision must not decide whether a hard requirement is met (same principle as JEV-8).
- `resolveTierModel` fails closed on an unknown/unconfigured tier instead of falling back to `models.default` (arch §11), so a bad tier cannot reach a provider invocation.
- Only task features cross the boundary — no prompt text, source, tool output, provider or model names.
- Current routing stays the fallback: the default route is `existing-routing`, and a non-configured route yields an explicit failure, not a guess.
- No legacy alias or second model source: resolution reads `models.*` only, never the derived `model`/`subagents` projections.
- `modelTier.enabled` absent/false keeps the existing routing policy; `selectModelTier` defaults to mode `off`.
- Shadow results carry `authority: "none"`.
- Wire shape is `documented-unverified`; remote stays disabled until acknowledged.

**Work Guidance:**
- Adding a tier means adding it to the canonical `MODEL_TIER_VALUES` (`src/config/schema.ts`) and to `TASK_KIND_PREFERENCE` where it applies; `TIER_CANDIDATES` follows automatically.
- Keep `chooseTierLocally` deterministic and preference-ordered; never guess a tier that is not enabled.
- Resolution goes through `resolveTierModel`/`resolveModelConfig` — never read provider/model IDs from a decision result.
- When a capability requirement appears (vision input, tools, min context), filter the candidate set in the caller — do not add a gate to the baseline.

**Verification:**
- `tests/decision/model-tier.test.ts` — candidate enumeration (incl. image), feature-only projection, baseline corpus/image/hard-constraint/abstention, canonical resolution (legacy projection ignored, fail-closed tiers, image), Jev mapping (no model IDs on the wire, malformed rejection, image hint), shadow (disabled/local/remote/fallback/existing-routing), `selectModelTier` off/shadow/active.

**Known deferrals:**
- Active routing (mode `active`) is gated behind evaluation per the plan PR strategy ("model-tier routing in shadow mode, then separately activate"); no runtime call site consumes `selectModelTier` yet.

**Child DOX Index:** none.
