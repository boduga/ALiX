# SRAP-G3-ACCEPT — Codex handoff

Updated: 2026-10-18 (supersedes the 2026-10-17 revision)
Baseline: `main` == `origin/main` == **`7b54e781`**

## Mission

**`SRAP-G3-ACCEPT` is CLOSED. D4 = UNCONDITIONAL PASS.** There is no open
acceptance work. This document exists so a future session can pick up the fixture
or audit the gate without re-deriving what was learned.

The gate is closed. Reopening it is an operator decision, not a default. If you
find a defect, file it and enter the normal review path — do not patch inside
acceptance evidence.

## 1. Gate status (final)

| Gate | State | Basis |
| --- | --- | --- |
| D0 design | approved / merged | PRs #964, #965 |
| D1 isolated setup | **PASSED**, D1-F1 closed | PRs #966, #967; `docs/2026-10-16-srap-g3-d1-report.md` |
| D2 qualification | **complete** | PR #969 (`86855978`), operator decision 2026-10-16 |
| D3 integrated acceptance | **all rows artifact-backed** | §3 |
| D4 closure | **CLOSED — PASS** | `docs/audits/srap-g3/d4/D4-evidence-manifest.md` (rev 7) |
| Independent D4 sign-off | **APPROVED** by operator | manifest governance sign-off; Codex final independent review of rev 6 evidence |

Issue **#983** (decision-route workspace denial parity) is **CLOSED**.

**Closure authority:** the operator decision recorded in rev 7 is an **advisory
governance acceptance**, not an independently authenticated human security
signature. It accepts Codex's independent review as the D4 reviewer sign-off. Do
not cite it as a separate security signatory.

## 2. What landed (acceptance series)

| PR | Merge | Content |
| --- | --- | --- |
| #971 | `16abd42d` | D3 fixture: isolated credential seeders, loopback TLS/denial proxies, offline mock model |
| #972 | `9f81e511` | merged-main bootstrap record + fixture DOX (`scripts/srap-accept/AGENTS.md`) |
| #973 | `b2d0f168` | reject a state dir that escapes the fixture root via symlink |
| #975 | `93437e6f` | D3 execution record (stopped on E-3) |
| #976 | `68f4520d` | **product fix**: stop redacting non-secret `principalId`/`credentialRef`; enforce `credentialRef` shape at the projection boundary |
| #977 | `0d059b7e` | D3 execution PASS after the E-3 fix |
| #978 | `f3259004` | F-4 race PASS + untrusted-peer denial |
| #979 | `30981acb` | D4 evidence bundle submitted |
| #980 | `5f87d885` | upgraded the LIMITED D4 rows with retained artifacts |
| #981 | `de507925` | focused D4 review + conditional sign-off |
| #982 | `3cff3094` | Codex handoff (previous revision) |
| **#984** | **`aae59c26`** | **product fix**: decision route requires explicit workspace scope → 403 |
| **#985** | **`7b54e781`** | D4 manifest rev 6 — unconditional PASS + merged-build requalification |

### The two product fixes worth knowing

1. **#976 — audit redaction.** `/ip/i` matched `principalId` and `/credential/i`
   matched `credentialRef`, so the projected decision record stored `[REDACTED]`
   while the ledger held real values. Fixed with an exact-match allowlist plus a
   `credentialRef` shape check at the projection boundary.
2. **#984 — decision-route scope denial.** Missing/empty/mismatched workspace
   scopes on `POST /api/approvals/:id/decision` now return **403
   `workspace_scope_required`** *before* approval lookup. Ordinary routes keep
   **401 `workspace_mismatch`**. This closed the last real acceptance deviation.

## 3. D3 rows — all artifact-backed

- **Auth** A-1..A-4 · **Principal** B-1..B-3 · **Workspace** C-1..C-3
- **Decisions** D-1..D-4 · **Evidence** E-1..E-4 · **Concurrency** F-1..F-4
- **Restart** G-1..G-4 · **Lifecycle** H-1..H-3 · **Untrusted-peer** (denied)

C-2/C-3b previously carried an accepted deviation (401 vs plan 403). **That is
resolved**: PR #984 made the route return 403, and
`C2-C3b-requalification.txt` records the merged-build requalification (403, fresh
approval pending, no evidence, key-read delta 0). C-3a is 12/12 across
bearer/cookie × role × auth-mode.

A-2 still differs from the plan's *label* (`invalid_token` vs
`authentication_required`) while returning HTTP 401 with the approval unchanged —
it meets the row's pass criterion.

## 4. Environment (current actual state — not all services are up)

Fixture root: `/tmp/opencode/alix-srap-accept/20261017T164036Z-309922`
(also in `/tmp/opencode/srap-accept-root.txt`)

```bash
source "$(cat /tmp/opencode/srap-accept-root.txt)/private/env.sh"
cd "$SRAP_ACCEPT_ROOT/workspace"
```

| Component | Address | State |
| --- | --- | --- |
| Inspector | `127.0.0.1:4139` | **DOWN** as of this handoff — restart with `private/start-inspector.sh` |
| TLS proxy | `127.0.0.1:4143` | up, but returns **502** while the Inspector is down |
| Mock model | `127.0.0.1:8080` | **up**; fixture copy is patched (planner + reviewer + tool-target modes) |
| Daemon | pid 362403 | **running** |
| Ollama | `127.0.0.1:11434` | **not part of the fixture** — the user's own service; leave it alone |

State: operator principal **`prin_uWXSJw6eQuUB`**; audit chain **278 records**,
tip `ba24cd445d11`, `alix audit verify` → OK / 0 findings.

Isolation invariants: `HOME`/`XDG_STATE_HOME`/`XDG_CACHE_HOME`/`TMPDIR` under the
root; credential backend `plain-file`; every fixture listener loopback-only;
production `~/.config/alix` and the OS keychain untouched.

**The acceptance evidence does not require the services to be running.** D4 is
signed off from committed artifacts; the fixture is only needed if you want to
re-run something.

## 5. Hard-won operational knowledge (read before touching the fixture)

These cost real time and are not recorded anywhere else.

1. **The mock model needs three call shapes.** `bin/mock-model-server.mjs` must
   answer (a) the planner with a task-graph JSON, (b) the worker with a tool call,
   (c) the objective reviewer with `{"satisfied":…,"summary":…,"gaps":[…]}`. The
   planner goal is `SRAP_MOCK_PLAN_GOAL` and **must match the run goal** or the
   reviewer correctly rejects the deliverable.
2. **The reviewer is a deterministic matcher, not a judge.** It checks substring
   presence of the assigned file and text plus a `Tool <name>, call <id>:` record
   shape. It fails closed on an unparseable objective. A forged tool string in
   untrusted evidence would satisfy it. Never cite it as evidence of quality.
   (I got this wrong three times while producing the evidence; the manifest now
   states the limits rather than a capability claim.)
3. **F-1 must run with the daemon stopped.** A live daemon ticks and **consumes
   the single-use approval mid-barrier**, yielding 1×200 + 7×409. That is a
   harness trap, not a product defect. Both runs are committed:
   `F1-raw.json` (racy) and `F1-raw-clean.json` (valid).
4. **Ask mode re-gates every gated action.** One worker turn can raise several
   approvals; drive to terminal by auto-approving pending ones in a loop.
5. **`approvals.json` is a projection and goes stale.** Query the authoritative
   ledger via `alix coordination approvals <runId>` or `ApprovalStore`.
6. **The daemon scheduler takes only the 10 oldest active runs per cycle.** A
   backlog of stale `blocked` runs starves new ones — cancel stale runs first.
7. **Foreground `coordination run` exits while blocked**; resume needs the daemon
   (`--daemon`). A foreground `tick` that dispatches then exits orphans the worker
   (`Worker orphaned — host cli-<pid> is dead`).
8. **The seeders are fixture-only** (`scripts/srap-accept/`) and must never be
   pointed at the OS keychain. They refuse argv secrets, the `srap-evidence`
   namespace, and any credential dir escaping `$SRAP_ACCEPT_ROOT`.

## 6. Residuals carried in the record (scope limits, not blockers)

The manifest §10/§11 lists these. They are accepted as scope limits, not as
resolved:

1. The objective reviewer is a deterministic matcher (§5.2).
2. `approval.created` exists only in the ledger, not as an audit-chain record.
3. The untrusted-peer test uses loopback source addresses (`127.0.0.2`) against a
   `127.0.0.1/32` trust list — **not** a physically separate host. Do not claim
   separate-host isolation.
4. The fixture root is disposable and was mutated across review rounds; rev 6
   records authoritative counts (278 records); rev 7 records governance sign-off.
5. E-4 originally used a hand-seeded decision; the rev-6 supplemental run
   (`E4-full-coverage.txt`) replaced it with a real signed decision through the
   route, so this limitation is effectively closed — but the earlier hand-seeded
   record remains in the chain and must not be counted as a real operator decision.

## 7. Repository map

| Path | Role |
| --- | --- |
| `docs/2026-10-15-srap-g3-acceptance-plan.md` | **normative** acceptance matrix + F-4 amendment |
| `docs/2026-10-16-srap-g3-acceptance-fixture.md` | fixture design (rev 2.3) |
| `docs/2026-10-16-srap-g3-d2-d3-handoff.md` | frozen D3 inputs, bootstrap, D3 execution record |
| `docs/2026-10-16-srap-g3-d1-report.md` | D1 verdict |
| `docs/audits/srap-g3/d4/` | **D4 manifest rev 7 + committed evidence artifacts** (authoritative) |
| `scripts/srap-accept/` | fixture seeders, proxies, mock model (**inert, never imported by `src/`**) |
| `scripts/srap-accept/AGENTS.md` | fixture DOX contract |
| `src/governance/audit/remote-decision-projection.ts` | ledger → audit projection |
| `src/governance/security/audit/audit-chain-writer.ts` | hash chain + redaction allowlist (#976) |
| `src/interfaces/server/security-middleware.ts` | decision-route scope denial (#984) |
| `src/interfaces/server/remote-decision-route.ts` | `POST /api/approvals/:id/decision` |
| `tests/scripts/srap-seed-*.vitest.ts` | seeder contract |

## 8. Constraints that still bind

- **No new approval authority, scheduler, ledger, or execution path.** Remote
  decisions stay default-off outside the isolated fixture.
- **The untrusted-peer row is proven only for loopback source addresses.**
- **Production credentials and the OS keychain are off-limits.** Store-only key
  resolution; fixture values live only under `$SRAP_ACCEPT_ROOT`.
- **If acceptance reveals a defect:** file it and re-enter review; do not patch
  inside the acceptance run. (E-3 → #974 → #976 and the scope deviation → #983 →
  #984 both went this way.)
- **DOX:** read the nearest `AGENTS.md` before editing; run `pnpm check:dox`;
  update the owning doc when contracts change.

## 9. Suggested first actions

Nothing is required — the gate is closed. If you are here for something specific:

1. `git pull` on `main`; confirm `7b54e781`.
2. To audit the gate: read `docs/audits/srap-g3/d4/D4-evidence-manifest.md`
   (rev 7; rev 6 contains reviewed evidence) and §§10–11.
3. To re-run a row: start the Inspector (`private/start-inspector.sh`), remember
   §5.3 for F-1, and query the ledger (not `approvals.json`) for state.
4. To clean up: cancel stale runs, stop the daemon/proxy/mock, and delete the
   fixture root. Nothing in the repo depends on it.
