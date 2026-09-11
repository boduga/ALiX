# src/skills — Agent Skills

Purpose: file-based skills (`<store>/<name>/SKILL.md`: YAML front matter +
markdown body) matched to prompts by trigger/pattern, with a candidate →
promote lifecycle.

## Ownership

| File | Responsibility |
|------|----------------|
| `loader.ts` | Parse `SKILL.md` (front matter: `name`, `description`, `trigger?`, `pattern?`, `version`, `is_core`, `tags?`, `allowed_tools?`) |
| `catalog.ts` | `SkillCatalog.match` (`/trigger` exact + case-insensitive pattern); lazy body load |
| `promotion.ts` | `promoteIfEligible`: usage-gated install (`successCount >= 2`), pollution + duplicate-body gates, versioning |
| `pollution.ts` | Pure-compute pairwise overlap (shared triggers, subsuming patterns, name/description/body similarity); consolidation scoring |
| `trust.ts` / `security.ts` / `sandbox.ts` | Trust review, safety patterns, execution sandbox |
| `slash.ts` / `slash-catalog.ts` | Slash commands; `canonicalSkillId()` is the SOLE naming/dedup authority |
| `factory.ts` | Skill distillation from session summaries |

## Local Contracts

- **Promotion gates (durable):** a candidate colliding with an installed skill
  (shared trigger, subsuming pattern + similar text) is blocked with a reason,
  not installed; a near-duplicate same-name body is blocked instead of
  versioned. Same-name pairs are skipped by the detector (naming owned by
  `resolveNamingCollision`).
- **Pollution module is pure compute:** no I/O, no mutations, no stores.
  The single `wordTokens()`/`jaccard()` pair is the only text-similarity
  implementation here — do not duplicate it elsewhere.
- **Eviction:** `evictIfNeeded` drops oldest-first non-core skills past
  `maxStore`; `is_core` skills are never evicted.
- **Manifest validation:** `name` + `description` required; control characters
  rejected.

## Work Guidance

- Mirror new prompt-facing skills with trigger + pattern tests via the catalog
  (`match`/`getMatchedContent`).
- Keep text-similarity changes inside `pollution.ts`.

## Verification

```bash
node --test --test-timeout=30000 dist/tests/skills/*.test.js  # node:test suites (pnpm build first)
pnpm build  # typecheck + build (must be green)
```
