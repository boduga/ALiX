# SKILL.state — Decision-Critical Research (Ticket #616)

> **Primary sources:** [SKILL.state: Scalable Long-Horizon Agent Skills — arXiv:2608.26263](https://arxiv.org/abs/2608.26263) (v3, 2 Sep 2026; accepted at EMNLP 2026) — Sanket Badhe, Priyanka Tiwari (Google LLC), Jonghyun Chung (Purdue University). HTML: <https://arxiv.org/html/2608.26263v1>. Video: [AI Just Escaped the Context Window (Skill.state) — https://youtu.be/PtcK1MnW8GM](https://youtu.be/PtcK1MnW8GM). Secondary explainer with tables: [Daniel Vaughan — SKILL.state: O(T) Agent Memory (29 Aug 2026, updated 3 Sep 2026)](https://codex.danielvaughan.com/2026/08/29/skill-state-ot-agent-memory-structured-execution-state-codex-cli-long-horizon/).

---

## 1. Core proposal: transcript → mutable execution state

**Problem diagnosed:** Conventional agent runtimes (ReAct, LangGraph, MemGPT-style) append every `(thought, action, observation)` to an ever-growing conversational transcript `C_t`. Prompt length `|C_t| = O(t)` → cumulative cost `Σ|C_t| = O(T²)`, plus context-poisoning (stale facts out-compete fresh observations) and prefix-cache collapse.

**Replacement (Eq 1–2, Alg. 1):** At step `t` the model sees **only** the bounded triple

```
A_t = (P, Σ_t, O_t)
```

- `P` — **immutable skill specification** (persona, action space, state schema, environment rules). Analogous to a function signature; never changes during execution.
- `Σ_t` — **mutable structured execution state** (JSON dict, authored once per *domain* not per task; e.g. one static 5-field schema `discovered_flags / tested_hypotheses / active_files / working_dir / cmd_summary` reused across all 100 InterCode CTF challenges).
- `O_t` — **latest observation only** (tool stdout / alert / DB response). Prior observations are *not* re-presented; anything needed later must have been projected into `Σ`.

Model generates `(R_t, ΔΣ_t, a_t)` — multi-step CoT `R_t` + structured state patch `ΔΣ_t` (key mutations, `null` = deletion) + action `a_t`.

**Intermediate reasoning is discarded permanently** after the validated state update is committed. Only `Σ_{t+1}` survives. This is what bounds the prompt; it is not summarization or compression.

> "Intermediate reasoning is discarded immediately after producing a validated state update, preventing prompt growth with execution history." — Abstract, arXiv:2608.26263

**Complexity claim ( §3.3 ):** `|P_t| = O(|P|+|Σ|+|O|)` bounded in `t` → `Σ|P_t| = O(T)` cumulative vs `O(T²)` for transcript baselines. Empirically `|Σ|` stays flat because facts overwrite rather than accumulate.

---

## 2. Where validation, merging, execution sit (harness vs model)

| Concern | Owner | Mechanism (paper ref) |
|---|---|---|
| **Prompt assembly** `(P, Σ_t, O_t)` | **Harness (deterministic runtime)** | §3, Alg. 1 step 4 |
| **State transition proposal** `ΔΣ_t` | **Model** | §3.2 Eq 3: LLM outputs JSON `{"state_patch": {…}, "action": "…"}` |
| **Validation** (schema keys + field types) | **Harness** | §3.2, §7: "schema ownership and validation reside in the deterministic runtime rather than the model" |
| **Merge** `Σ_{t+1} = Σ_t ⊕ ΔΣ_t` | **Harness** | Eq 4: runtime dictionary merge with **null-deletion semantics** (`key: null` deletes) |
| **Rollback-retry on invalid patch** | **Harness** | §3.2, §5.7, §7: malformed patch **cannot corrupt** `Σ_t`; triggers rollback-retry cycle (model is re-prompted with its error). For small open-weight models authors recommend **grammar-constrained decoding** to eliminate syntactic errors. |
| **Action / tool execution** `a_t` | **Harness** (environment) | Alg. 1 step 8: runtime executes `a_t`; next observation `O_{t+1}` fed back |
| **Reasoning `R_t`** | **Model, then harness discards** | §3.2: "once the state transition has been validated and applied, the reasoning trace `R_t` is discarded permanently and never appears in subsequent prompts" |

Separation of concerns: **model owns *what* to update; harness owns *whether* it is valid and *how* it is applied.** State corruption via hallucinated keys is structurally impossible (rejected at merge).

Multi-agent note (§7): shared `Σ` as coordination substrate is architecture-natural, but introduces **concurrent writes** requiring deterministic conflict-resolution in `⊕` — explicitly *not exercised* in the single-agent evaluation.

---

## 3. Token reduction & accuracy claims — long-horizon headline

Evaluated on **SkillExecBench** (synthetic deterministic: Warehouse 500 shelves + Software Repo graph), **InterCode CTF** (100 Linux exploitation tasks), **Sierra τ-Bench** (Retail + Airline tool-use workflows). Models: Gemini-3-Flash, Gemma-4-31B-it, Qwen-3-8B-it (temp 0, top-p 1, 5 seeds, p<0.01 at T≥50).

### Headline: Warehouse long-horizon scaling (Gemini-3-Flash, Table 1)

| Horizon | SKILL.state avg prompt / total tokens / score | Best baseline total tokens / score | Reduction |
|---|---|---|---|
| T=10 | 1,775 / **5,870** / 1.00 | 9,438 / 0.90 (Prompt) | ~1.6× |
| T=25 | 1,736 / **14,714** / 1.00 | 41,238 / 1.00 (Stateful) | ~2.8× |
| T=50 | 1,773 / **30,151** / 0.96 | 131,455 / 0.93 (Memory) | ~4.4× |
| **T=100** | **1,905 / 65,408 / 0.94** | **1,062,387 / 0.91 (Stateful)**; 1,245,413 / 0.84 (Prompt) | **16.2× vs Stateful, 19× vs Prompt** |
| **T=200** | **1,811 / 122,384 / 0.94** | **6,175,509 / 0.84 (Memory)**; 2,608,755 / 0.74 (Prompt) | **~50× vs Memory, ~21× vs Prompt** |

Flat prompt ~1.7–1.9k tokens at all horizons vs 36k (T=100) and 48–84k (T=200) for baselines. **Accuracy does not trade off for tokens** — SKILL.state matches or beats every baseline at every horizon.

### Real-task benchmarks (Gemini-3-Flash, Table 4)

- **InterCode CTF (100 tasks):** SKILL.state **54.2% pass@1, 387k total tokens, 813 avg prompt** vs ReAct 43.2%/977k/1,909 (+11 pp, 60% fewer tokens) vs Stateful 41.8%/1.13M/1,946 (+12.4 pp, 66% fewer) vs Memory 46.4%/1.03M.
- **τ-Bench Retail:** **58.3% / 3.47M / 3,325** vs ReAct 48.2%/4.48M (+10.1 pp, 23% fewer) vs Stateful 51.7%/3.92M (+6.6 pp, 12% fewer).
- **τ-Bench Airline:** **32.4% / 2.88M / 2,800** vs ReAct 21.8%/4.85M (+10.6 pp, 41% fewer) vs Stateful 28.1%/5.28M (+4.3 pp, 45% fewer). Airline is where baseline prompts spike >11k/step; SKILL.state stays flat at ~2.8k.

### It is structure, not brevity (Table 5 — budget-matched controls, T=100, ~1.8k token budget)

- Sliding-window truncation → **0.18** accuracy
- LLMLingua perplexity compression → **0.22**
- Summary-capped → **0.52**
- SKILL.state (structured state, same budget) → **0.94**
> Early allocations and low-entropy slot IDs are semantically vital but statistically prunable — entropy filtering destroys them.

### Robustness / recovery

- **Noise robustness (Table 2, T=50, 5–50 distractor events/turn):** Prompt baseline collapses 0.68→0.53; SKILL.state stays **≥0.97–1.00** (distractors filtered at patch-generation time, never enter next prompt).
- **State recovery (Table 3, Table 10):** After silent external drift (secret audit/barcode/move, force-push, flaky CI), transcript baselines **hallucinate 5–14 steps** before recovering (stale history overpowers fresh correction); SKILL.state **0 recovery steps** — correction committed to `Σ` immediately. Scenario C (PR closed) fails for all runtimes (terminal state).

---

## 4. Open-ended caveat — state-projection errors (motivates ALiX hybrid substrate)

Paper's own §7 Limitations states SKILL.state is **lossless only if `Σ_t` is a sufficient statistic** for future execution. Assumption **fails in three settings:**

1. **Dynamic schema discovery** — no fixed schema known in advance; relevant state structure must be discovered during execution.
2. **Retroactive relevance** — an early observation's importance becomes clear only many steps later, after it was already discarded and never committed to `Σ`.
3. **Trajectory-as-output tasks** — auditing, debugging provenance, explaining past actions — where history *is* the deliverable, not overhead.

> "Where this holds, discarding intermediate reasoning and conversational history is lossless. However, this assumption fails in three distinct settings…" — §7, arXiv:2608.26263v1

**Decision implication for ALiX:** Pure state-only substrate is unsound for open-ended engineering workflows (unfamiliar codebases, retroactive bug causality, exploratory research loops). The paper/video warning is precisely the justification for the **hybrid substrate** in the parent map (#615): keep **`EventLog` immutable source of truth**, add **projected `ExecutionState` for O(1) context assembly**, defer state shape to benchmark. The canonical SM fix is adaptive substrate switching and versioned projection.

Video (https://youtu.be/PtcK1MnW8GM — "AI Just Escaped the Context Window") presents the same architecture visually (Fig. 1 flowchart) and reiterates the bounded-triple intuition; YouTube page itself carries no additional textual claims beyond the paper abstract and is cited as the visual companion.

---

## 5. Failure modes & recovery

### Model-class failure taxonomy (Gemma-4-31B, T=100, score 0.42 — §5.7)

| # | Mode | Share | Description |
|---|---|---|---|
| 1 | **Premature state overwrite / deletion** | **68%** | Model omits existing keys during patch (self-inflicted amnesia) rather than merging in-place. Dominant failure; not a reasoning deficit. |
| 2 | **Schema comprehension / type coercion** | 20% | Confuses nested lists vs dicts; wrong field types. |
| 3 | **JSON syntax / formatting** | 12% | Trailing commas, malformed delimiters (eliminated by constrained decoding). |

> Small-model degradation stems from structured-output adherence rather than reasoning capacity — motivates grammar-constrained decoding (§7).

### Runtime-level error handling

- **Malformed patch → rollback-retry loop** (§7, Alg. 1): harness validates before `⊕`; on failure returns error to model for retry. Persistent `Σ_t` never corrupted.
- **External drift / alert recovery:** As above, SKILL.state recovers in **0 steps** vs 5–14 for baselines when the environment injects out-of-band state changes (force push, flaky CI, secret moves).
- **Multi-agent concurrent writes:** flagged as future work — requires deterministic conflict-resolution semantics in `⊕` not present in single-agent prototype.
- **Open-weight mitigation:** authors explicitly recommend **grammar-constrained decoding** to offload syntax enforcement from the model.

---

## 6. Relevance to ALiX map (#615)

- **Governed projection loop** `P + Σ_t + O_t → (R_t, ΔΣ_t, a_t) → harness validates → Σ_t⊕ΔΣ_t → execute a_t` maps directly to ALiX **contract → store → projector → state-aware prompt → transition proposal → governor → ExecutionIntent/CapabilityResolver/Evidence**. Paper's harness/model split validates putting **validation + merge + execution + env communication in the harness**.
- **Headline result justifies benchmark:** flat prompt + 16–50× cumulative saving + accuracy gain at T≥100 is the killer benchmark to reproduce for the ALiX POC (10–500 step tasks, decision-accuracy = `Successful Actions / Total Actionable Events`).
- **Hybrid caveat justifies EventLog preservation:** ALiX's EventLog as immutable truth + projector as intelligence problem (not giant JSON blob) is the paper-consistent response to the sufficient-statistic limitation. State shape benchmark (fog item) will measure projection-adequacy directly.
- **Error taxonomy informs starting schema:** begin with small, typed, domain-authored schemas; add constrained decoding if open-weight models used; guard the 68% overwrite mode with explicit merge-in-place instructions and harness key-preservation checks.

---

## 7. Assets & citations

- Paper (all sections cited): <https://arxiv.org/abs/2608.26263> · HTML <https://arxiv.org/html/2608.26263v1> · DOI `10.48550/arXiv.2608.26263`
- Video: <https://youtu.be/PtcK1MnW8GM>
- Equation refs: (1)(2) triple, (3) generation, (4) merge, (5)–(7) complexity
- Algorithm 1: SKILL.state Runtime
- Appendix A: exact runtime prompts for all four baselines (Prompt/ReAct, Memory, Stateful/LangGraph, SKILL.state)
- Appendix B–C: SkillExecBench env details & noise calibration
- Appendix D / Tables 1–5, 10: quantitative results quoted above
- Secondary synthesis (Vaughan, 29 Aug 2026): <https://codex.danielvaughan.com/2026/08/29/skill-state-ot-agent-memory-structured-execution-state-codex-cli-long-horizon/>

---

*Prepared for #616 by research subagent 2026-09-02. File committed on branch `research/skill-state-paper` as `/tmp/research-skill-state.md` (throwaway research branch per ticket). For the decision map, cite this file; do not inline detail.*
