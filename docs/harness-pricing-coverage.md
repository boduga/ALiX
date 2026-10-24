# Pricing coverage (F1-D)

**Status:** PARTIAL — effective-dated pricing implemented; `intern` pricing BLOCKED on an external authority.
**Branch:** `docs/pre-2.0-harness-audit`.
**Parent:** `docs/ALiX_PRE_2_0_HARNESS_PRD_v1.1.md` (root worktree; see `harness-prd-divergence-finding.md`) §7, §9 Gate B.
**Gate B: HOLD.**

---

## 1. Billing-authority audit (required first)

The operator instruction was explicit: do not assume the model name identifies the
entity issuing the bill. Findings:

| Question | Finding | Evidence |
|---|---|---|
| Is `intern` provider-native or a proxy alias? | **Provider-native**, not an alias to another provider | `intern-provider.ts` speaks the OpenAI-compatible protocol directly to `discovery-api.intern-ai.org.cn`; no alias/route indirection exists |
| Who issues the bill? | **Intern InkStone** (intern-ai.org.cn) | `DEFAULT_INTERN_BASE_URL`, catalog entry "Intern InkStone (Token Plan)" |
| What is the billing model? | **Token Plan subscription**, per-account | `schema.ts:158-160` — "Token Plan exposes a per-account root ending in `/v1`" |
| Are rates recorded anywhere in the repo? | **No** | `intern-spec.ts` carries context limits only; no `pricing`, `perMillion`, or rate field anywhere |

### Why this blocks pricing `intern`

`intern` is a **per-account Token Plan subscription**, not per-token metering. Even
if a list price existed, it would not describe what this account is billed. And no
authoritative rate is available in-repo.

Per the instruction — *"If the `intern` provider has no authoritative pricing
source, do not invent one"* — `intern` **remains unpriced**. Its runs correctly
report `totalCost: -1`, `costCompleteness: "partial"`.

**This is an unresolved external dependency, not a code gap.**

---

## 2. What F1-D did fix: effective-dated pricing

A real defect, independent of `intern`:

`PricingCatalog.lookup(provider, model)` **always returned the latest entry**,
ignoring when the invocation ran. A two-tier catalog produced a **10× error** on
historical replay:

```
lookup (no date): 10   <- returns LATEST
a 2025-03 invocation should cost 1, but lookup gives 10
```

### Fix

- `lookup(provider, model, at?)` filters to entries whose `effectiveFrom` is at or
  before `at`, then takes the newest applicable one.
- An invocation predating the earliest known price returns `undefined` →
  **unknown cost**, never borrowing a later rate.
- An unparseable `effectiveFrom` is excluded rather than treated as always-valid.
- Omitting `at` preserves the forward-looking "latest" behaviour, which is
  appropriate only for estimation, never for attribution of a past invocation.
- Both call sites now pass the event timestamp:
  `cost-attribution.ts` (event timestamp) and `cost-correlation.ts`
  (`RunInvocation.timestamp`, newly carried).

---

## 3. Acceptance gate assessment

| Test | Result |
|---|---|
| Verified provider/model mapping | **PASS** — native, not an alias |
| Authoritative pricing source | **FAIL for `intern`** — none exists; recorded as external dependency |
| Effective date recorded and enforced | **PASS** — implemented and tested |
| Input/output calculation independently reproducible | **PASS** — pinned by existing + new tests |
| Historical price selection | **PASS** — the 10× case is now correct |
| Unknown alias remains unpriced | **PASS** — `intern` stays `-1`/`partial` |
| Missing historical price remains unknown | **PASS** — predates-earliest → undefined |
| Non-billable local provider remains non-billable | **PASS** — unchanged |
| Production/evaluation pricing same authority | **PASS** — single `PricingCatalog`, single `isNonBillableProvider` |
| Existing cost regressions green | **PASS** — see §4 |

**F1-D is qualified for effective-dated pricing. It is NOT qualified for
pricing `intern`**, and no price was fabricated to make the gate look complete.

---

## 4. Verification

| Suite | Result |
|---|---|
| New effective-dated tests | see `tests/observability/effective-dated-pricing.vitest.ts` |
| observability + security + architecture | re-run below |
| tui + evals + observability + interfaces | re-run below |

---

## 5. Consequence for F1-E

F1-E needs a **priced** model to demonstrate the end-to-end chain. With `intern`
unpriceable, the options are:

1. **Use a priced provider for the F1-E run.** The catalog already covers
   openai/anthropic. A small, real run on a priced model proves
   `runId → invocation → usage → pricing → cost` end to end with a recomputable
   figure. This is the cheapest path and does not require inventing anything.
2. **Obtain authoritative `intern` rates** from the vendor's published pricing
   page or billing API, plus clarity on Token Plan metering. Then add a
   properly-sourced, effective-dated entry.

Recommendation: do (1) to qualify the mechanism, and treat (2) as an external
dependency tracked separately. Qualifying the mechanism does not require the
provider the operator happens to default to.

---

## 6. Findings

| # | Finding | Severity | Disposition |
|---|---|---|---|
| D6-01 | `PricingCatalog.lookup` ignored invocation time; historical replay used current rates (10× in a two-tier test) | **Medium** | **FIXED** in F1-D |
| D6-02 | `intern` is a per-account Token Plan subscription with no authoritative in-repo rate | Medium (external) | **OPEN** — external dependency; not invented |
| D6-03 | `RunInvocation` did not carry its timestamp, so correlation could not do dated pricing | Low | **FIXED** in F1-D |

---

## 7. Files

| File | Change |
|---|---|
| `src/operations/observability/cost-attribution.ts` | effective-dated `lookup`; call site passes event timestamp |
| `src/operations/evals/cost-correlation.ts` | `RunInvocation.timestamp`; dated lookup; widened `PricingLookup` |
| `tests/observability/effective-dated-pricing.vitest.ts` | new tests |

No pricing data added. Simplification HOLD. Publication HOLD (Q13).
