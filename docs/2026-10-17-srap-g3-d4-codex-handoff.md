# SRAP-G3-ACCEPT — Codex handoff

Updated: 2026-10-17
Baseline: `main` == `origin/main` == **`de507925`**

## Mission

**`SRAP-G3-ACCEPT` is complete except for separation-of-duties on D4.** D1–D3 are
done and artifact-backed; D4 closed as **PASS (conditional)** with a sign-off
performed by the implementation agent. The only genuinely open item is an
**independent** re-run of the D4 sign-off by someone who did not produce the
evidence (see §6).

Do **not** re-open the acceptance program. The scope agreed with the operator was
a focused D4 review, not a re-qualification.

## 1. Gate status

| Gate | State | Basis |
| --- | --- | --- |
| D0 design | approved / merged | PRs #964, #965 |
| D1 isolated setup | **PASSED**, D1-F1 closed | PRs #966, #967; `docs/2026-10-16-srap-g3-d1-report.md` |
| D2 qualification | **complete** | PR #969 (`86855978`), operator decision 2026-10-16 |
| D3 integrated acceptance | **all rows artifact-backed** | §3 |
| D4 closure | **PASS (conditional)** | `docs/audits/srap-g3/d4/D4-evidence-manifest.md` §11 |
| Independent third-party D4 sign-off | **NOT DONE** | §6 |

## 2. What landed (this session's PRs)

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

## 3. D3 rows — all artifact-backed

Documented in `docs/2026-10-16-srap-g3-d2-d3-handoff.md` §4.5–§4.9 and the D4
manifest.

- **Auth** A-1..A-4 · **Principal** B-1..B-3 · **Workspace** C-1..C-3
- **Decisions** D-1..D-4 · **Evidence** E-1..E-4 · **Concurrency** F-1..F-4
- **Restart** G-1..G-4 · **Lifecycle** H-1..H-3 · **Untrusted-peer** (denied)

Two accepted deviations (fail-closed equivalent, no authority widening):
C-2/C-3b return **401 `workspace_mismatch`** where the plan says 403; A-2 returns
`invalid_token` where the plan text says `authentication_required`.

## 4. Environment (still running)

Fixture root: `/tmp/opencode/alix-srap-accept/20261017T164036Z-309922`
(also in `/tmp/opencode/srap-accept-root.txt`)

```bash
source "$(cat /tmp/opencode/srap-accept-root.txt)/private/env.sh"
cd "$SRAP_ACCEPT_ROOT/workspace"
```

| Service | Address | Notes |
| --- | --- | --- |
| Inspector | `127.0.0.1:4139` | pid changes on restart; `private/start-inspector.sh` |
| Mock model | `127.0.0.1:8080` | `bin/mock-model-server.mjs` (fixture copy, patched) |
| TLS proxy | `127.0.0.1:4143` | `bin/proxy.mjs`, CA at `tls/proxy.crt` |
| Daemon | pid 362403 | long-lived; ticks and resumes ask-mode runs |

State: operator principal **`prin_uWXSJw6eQuUB`**; scoped credential
`tLD6PGzs4RHU`; audit chain **276 records**, tip `1d305c9fc456`,
`alix audit verify` → OK / 0 findings.

Isolation invariants: `HOME`/`XDG_STATE_HOME`/`XDG_CACHE_HOME`/`TMPDIR` under the
root; credential backend `plain-file`; every listener loopback-only; production
`~/.config/alix` and the OS keychain untouched.

## 5. Hard-won operational knowledge (read before touching the fixture)

These cost real time. They are **fixture/harness** facts, not product behaviour.

1. **The mock model needs three call shapes.** `bin/mock-model-server.mjs` must
   answer (a) the planner with a task-graph JSON, (b) the worker with a tool call,
   (c) the objective reviewer with `{"satisfied":…,"summary":…,"gaps":[…]}`.
   The planner goal is `SRAP_MOCK_PLAN_GOAL` and must match the run goal or the
   reviewer (correctly) rejects the deliverable.
2. **The reviewer is a deterministic matcher, not a judge.** It checks substring
   presence of the assigned file and text plus a `Tool <name>, call <id>:` record
   shape. It fails closed on an unparseable objective. A forged tool string in
   untrusted evidence would satisfy it. Never cite it as evidence of quality.
3. **F-1 must run with the daemon stopped.** A live daemon ticks and **consumes
   the single-use approval mid-barrier**, producing 1×200 + 7×409. That is a
   harness trap, not a defect. `F1-raw.json` (racy) and `F1-raw-clean.json`
   (valid) are both committed.
4. **Ask mode re-gates every gated action.** One worker turn can raise several
   approvals; drive to terminal by auto-approving pending ones in a loop.
5. **`approvals.json` is a projection and goes stale.** Query the authoritative
   ledger through the CLI (`coordination approvals <runId>`) or `ApprovalStore`.
6. **The daemon's scheduler takes only the 10 oldest active runs per cycle.**
   A backlog of stale `blocked` runs starves new ones — cancel stale runs.
7. **Foreground `coordination run` exits while blocked**; resume needs the daemon
   (`--daemon`). A foreground `tick` that dispatches then exits orphans the
   worker (`Worker orphaned — host cli-<pid> is dead`).
8. **The seeders are fixture-only** (`scripts/srap-accept/`) and must never be
   pointed at the OS keychain. They refuse argv secrets, the `srap-evidence`
   namespace, and any credential dir escaping `$SRAP_ACCEPT_ROOT`.

## 6. The one open item: independent D4 sign-off

The sign-off in `docs/audits/srap-g3/d4/D4-evidence-manifest.md` §11 was performed
by the implementation agent at the operator's direction. It states that
explicitly and is **not** an independent audit. Six of seven earlier review rounds
caught real errors in the implementer's own submissions, which is precisely why
separation of duties matters here.

To close it, an independent reviewer should:

1. Re-verify artifact integrity — every file in `docs/audits/srap-g3/d4/` must be
   byte-identical to its counterpart under
   `$ROOT/runs/20261017T164036Z/` (`sha256sum`), and
   `raw-artifact-inventory.txt` must match.
2. Re-verify the chain independently — recompute every `recordHash` with
   `canonicalStringify` and the `alix-audit-v1:` domain prefix over
   `{action, details, timestamp, actor}` + `seq` + `prevHash`; confirm 0
   mismatches, no seq gaps, no `prevHash` breaks, export == live, head == tip.
3. Re-read each row verdict against its named artifact (not the prose), especially
   A-4, F-1, F-2, F-3, G-2, E-3, F-4.
4. Accept or reject the deviations and the §10/§11 residuals.
5. Record the verdict in §11 with a different name.

**Residuals that must be accepted or escalated (§10/§11):** the reviewer is a
matcher; E-4 is hand-seeded (no `credential.key_read`); `approval.created` exists
only in the ledger, not the chain; the untrusted-peer test uses loopback source
addresses (`127.0.0.2`) against a `127.0.0.1/32` trust list, not a separate host;
the fixture root is disposable and was mutated across review rounds, so each
manifest states its own authoritative counts.

## 7. Repository map for this work

| Path | Role |
| --- | --- |
| `docs/2026-10-15-srap-g3-acceptance-plan.md` | **normative** acceptance matrix + F-4 amendment |
| `docs/2026-10-16-srap-g3-acceptance-fixture.md` | fixture design (rev 2.3) |
| `docs/2026-10-16-srap-g3-d2-d3-handoff.md` | frozen D3 inputs, bootstrap, D3 execution record |
| `docs/2026-10-16-srap-g3-d1-report.md` | D1 verdict |
| `docs/audits/srap-g3/d4/` | D4 manifest + committed evidence artifacts |
| `scripts/srap-accept/` | fixture seeders, proxies, mock model (**inert, never imported by `src/`**) |
| `scripts/srap-accept/AGENTS.md` | fixture DOX contract |
| `src/governance/audit/remote-decision-projection.ts` | ledger → audit projection |
| `src/governance/security/audit/audit-chain-writer.ts` | hash chain + redaction allowlist |
| `src/interfaces/server/remote-decision-route.ts` | `POST /api/approvals/:id/decision` |
| `tests/scripts/srap-seed-provider-key.vitest.ts`, `tests/scripts/srap-seed-key.vitest.ts` | seeder contract |

## 8. Constraints that still bind

- **No new approval authority, scheduler, ledger, or execution path.** Remote
  decisions stay default-off outside the isolated fixture.
- **The untrusted-peer row is proven only for loopback source addresses.** Do not
  claim physically separate-host isolation.
- **Production credentials and the OS keychain are off-limits.** Store-only key
  resolution; fixture values live only under `$SRAP_ACCEPT_ROOT`.
- **If acceptance reveals a product defect:** file it and re-enter review; do not
  patch inside the acceptance run. (That is exactly how E-3 → #974 → #976 went.)
- **DOX:** read the nearest `AGENTS.md` before editing; run `pnpm check:dox`;
  update the owning doc when contracts change.

## 9. Suggested first actions

1. `git pull` on `main`; confirm `de507925`.
2. Read `docs/audits/srap-g3/d4/D4-evidence-manifest.md` §10–§11 (10 minutes).
3. Run the §6.1–§6.2 integrity checks (they are mechanical and fast).
4. Decide: accept the conditional sign-off, or perform the independent §11 review.
5. Nothing else in the gate needs re-running.
