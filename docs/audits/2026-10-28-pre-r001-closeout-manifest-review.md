# PRE-R001 — closeout reproducibility manifest review (2026-10-28)

**Verdict:** PARTIAL improvement for new closeout evidence; historical provenance gaps remain.

Artifact: `benchmark/evidence/harness-closeout-manifest-2026-10-28.json`.

The manifest pins the current closeout source commit/tree/branch, clean tracked state, `origin/main`, historical Harness baseline commit, runtime/package/tool versions, OS/CPU/RAM, config-schema hash, lockfile hash, PRD hash, and a source diff stat from the historical baseline. It intentionally contains no credentials or secret-bearing effective configuration.

An isolated read-only Codex verifier (`gpt-6.1-sol`, Codex CLI 0.164.0) reviewed only the manifest against PRE-R001 and concluded:

- source commit/tree/branch are pinned for new evidence;
- dirty state is recorded at capture, but a single snapshot does not prove a later collection caused no mutation;
- runtime/tool versions are pinned but do not by themselves reproduce a run;
- the config schema is correctly pinned by source hash rather than by inventing a schema version;
- the aggregate diff stat identifies change scope but does not explain behavioral Gate 7 differences;
- historical evidence is not retroactively repaired because the manifest cannot supply per-run source/config facts that were never recorded.

Additional limitations from the review:

1. new measured runs must bind their own evidence/output to this or a successor manifest;
2. future run manifests should record before/after clean-state checks;
3. effective **non-secret** execution inputs/config should be pinned where a run depends on them;
4. reproduction commands and expected outputs belong in each run-specific evidence package;
5. Gate 7 behavioral differences remain governed by the existing Gate 7/qualification records, not by the aggregate diff stat alone.

Therefore PRE-R001 remains **PARTIAL** overall. The new artifact establishes a reproducible source/environment anchor for subsequent closeout evidence without overstating historical provenance.
