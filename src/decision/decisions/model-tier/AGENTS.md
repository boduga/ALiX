# DOX — Model Tier Decision (J3)

**Purpose:** Choose one of ALiX's enabled canonical tiers for a task, using request FEATURES only. The tier is resolved to a concrete provider/model exclusively through the canonical `models.*` configuration.

**Ownership:**
- `tiers.ts` — `TIER_CANDIDATES` (= canonical `MODEL_TIER_VALUES`, `image` included), `listEnabledTiers(config)`, `isModelTierValue`, `filterTierCandidates`, `assertEnabledTier`, `filterTiersByCapability` (caller-side hard-constraint filter; intersects with enabled tiers).
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
- `image` IS a candidate: it is the tier for **pure image-generation prompts** — the deliverable itself is an image ("create a Christmas card", "edit this photo"), e.g. a nano-banana-class model configured as `models.image`. If it is not configured, an image task abstains rather than falling back to a text tier.
- **Composite deliverables stay on the multimodal reasoning tier.** When an image is only PART of a larger deliverable — a report with images, a UI mockup in a coding session — the caller keeps the composite kind (`synthesis`/`code`/`analysis`) and the image work happens as a nested sub-task. The `image` tier is used only when the prompt itself asks for image generation; an explicit instruction in the prompt wins.
- Image *editing* is `taskKind: "image"` **and** `needsVision: true` (the caller supplies the photo): image output plus an image-input hard constraint.
- **Hard constraints belong to the caller.** `needsVision` (image INPUT) is a hint, not a gate: the caller excludes tiers that cannot satisfy a pass/fail requirement before invoking the decision. A probabilistic decision must not decide whether a hard requirement is met (same principle as JEV-8).
- The caller filters with `filterTiersByCapability(config, tiers, required)`, reading the operator's `models[tier].capabilities` declaration (`vision` = image input, `image_output` = image generation, plus `tools`/`structured_output`). An undeclared capability is unverifiable and therefore unsatisfied — fail closed, never assumed available. The helper also drops unconfigured tiers, so its output is always a valid candidate set.
- The filtered set reaches the decision through `candidates` (`selectModelTier`/`runModelTierShadow` deps). Omitting it means "every enabled tier"; passing it is how a hard constraint is enforced. The candidates are journaled, so the constraint is auditable.
- `resolveTierModel` fails closed on an unknown/unconfigured tier instead of falling back to `models.default` (arch §11), so a bad tier cannot reach a provider invocation.
- Only task features cross the boundary — no prompt text, source, tool output, provider or model names.
- Current routing stays the fallback: the default route is `existing-routing`, and a non-configured route yields an explicit failure, not a guess.
- No legacy alias or second model source: resolution reads `models.*` only, never the derived `model`/`subagents` projections.
- `modelTier.enabled` absent/false keeps the existing routing policy; `selectModelTier` defaults to mode `off`.
- Shadow results carry `authority: "none"`.
- Wire shape is `verified-against-docs` (see `engines/jev-protocol.ts` for the source links); remote is opt-in via `remote.jev.enabled`.

**Work Guidance:**
- Classifying a task: label `taskKind: "image"` only when the deliverable IS an image. If the prompt merely mentions images as part of a bigger result (report, mockup, app), keep the composite kind and let the image work be a nested sub-task. An explicit prompt instruction to generate an image wins.
- Adding a tier means adding it to the canonical `MODEL_TIER_VALUES` (`src/config/schema.ts`) and to `TASK_KIND_PREFERENCE` where it applies; `TIER_CANDIDATES` follows automatically.
- Keep `chooseTierLocally` deterministic and preference-ordered; never guess a tier that is not enabled.
- Resolution goes through `resolveTierModel`/`resolveModelConfig` — never read provider/model IDs from a decision result.
- When a capability requirement appears (vision input, tools, min context), filter the candidate set in the caller with `filterTiersByCapability` — do not add a gate to the baseline. Ask the operator to declare the capability on `models[tier].capabilities` if it is missing.

**Verification:**
- `tests/decision/model-tier.test.ts` — candidate enumeration (incl. image), feature-only projection, baseline corpus/image/hard-constraint/abstention, canonical resolution (legacy projection ignored, fail-closed tiers, image), Jev mapping (no model IDs on the wire, malformed rejection, image hint), shadow (disabled/local/remote/fallback/existing-routing), caller-supplied candidates (choice + journaled constraint), `selectModelTier` off/shadow/active, caller-side `filterTiersByCapability` (fail-closed on undeclared, drops unconfigured).
- `tests/config/validator.test.ts` — capability declarations accepted/rejected; an unverifiable discovery requirement is rejected.

**Known deferrals:**
- Active routing (mode `active`) is gated behind evaluation per the plan PR strategy ("model-tier routing in shadow mode, then separately activate"); no runtime call site consumes `selectModelTier` yet.

**Child DOX Index:** none.
