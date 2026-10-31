# Embedding migration: `@xenova/transformers` → `@huggingface/transformers` (ONNX CPU)

Date: 2026-10-31
Branch: `fix/onnx-embedding-migration`
Baseline: `2fb57c25` (`origin/main` + #1005–#1010 evidence commits, all unmerged)
Status: **technical PASS for the CPU embedding path; D9 Phase F remains HOLD**

This record supersedes the blocked-state conclusions in
`docs/security/2026-10-31-dependency-remediation-assessment.md`,
`docs/security/2026-10-31-onnx-cpu-no-postinstall-smoke.md`,
`docs/security/2026-10-31-onnx-esm-resolution-investigation.md`, and
`docs/security/2026-10-31-transformers-embedding-compatibility.md` **only** for
the items evidenced below. It grants no waiver, no exception renewal beyond the
dated entries in `security/audit-exceptions.json`, and no release approval.

## 1. What changed

| File | Change |
|---|---|
| `package.json` | `@xenova/transformers@2.17.2` → `@huggingface/transformers@4.3.2` (exact pin) |
| `pnpm-lock.yaml` | Regenerated for the new subtree only |
| `pnpm-workspace.yaml` | `onnxruntime-node: false`, `protobufjs: false` under `allowBuilds` — explicit **deny**, not approval |
| `src/context/repomap/embedding-cache.ts` | v4 API, pinned revision, CPU device, offline mode, vector-space cache namespacing, actionable errors |
| `security/audit-exceptions.json` | 3 resolved entries removed, 2 restated with fresh dates |
| `tests/repomap/embedding-cache-deterministic.test.ts` | new, 19 deterministic tests, no network |
| `tests/repomap/embedding-cache-cpu.test.ts` | new, real CPU inference, opt-in via `ALIX_EMBEDDING_MODEL_PATH` |
| `tests/repomap/embedding-cache.test.ts` | honours a provisioned model instead of always requiring network |

No other subsystem was modified. The `EmbeddingCache` public surface
(`getEmbedding`, `search`, `cosineSimilarity`, `buildEmbeddings`,
`checkGuardrail`) is unchanged.

## 2. Model provenance

Model: `Xenova/all-MiniLM-L6-v2`, revision **`751bff37182d3f1213fa05d7196b954e230abad9`**
(immutable commit SHA). Licence: Apache-2.0 (model card `cardData.license`).

Every checksum below was verified twice: once against the downloaded bytes, and
once against the Hugging Face API's own LFS metadata for that revision. They
agree, so the bytes served are the bytes the revision pinned.

| File | Bytes | SHA-256 |
|---|---|---|
| `config.json` | 650 | `7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7` |
| `tokenizer.json` | 711,661 | `da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0` |
| `tokenizer_config.json` | 366 | `9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3` |
| `special_tokens_map.json` | 125 | `b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3` |
| `vocab.txt` | 231,508 | `07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3` |
| `onnx/model_quantized.onnx` | 22,972,370 | `afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1` |
| `onnx/model.onnx` | 90,387,606 | `759c3cd2b7fe7e93933ad23c4c9181b7396442a2ed746ec7c1d46192c469c46e` |

Provisioning (no model weights are committed to the repository):

```
<ALIX_EMBEDDING_MODEL_PATH>/Xenova/all-MiniLM-L6-v2/
  config.json  tokenizer.json  tokenizer_config.json
  special_tokens_map.json  vocab.txt
  onnx/model_quantized.onnx        # dtype: "q8" (default)
```

## 3. Real CPU inference

Environment: Linux x86-64, Node.js 26.11.0, `@huggingface/transformers@4.3.2`,
`onnxruntime-node@1.30.0` with its postinstall **not run**.

Observed on all five required inputs (`hello world`,
`authentication and authorization`, `function login(user)`,
`database connection pooling`,
`export function add(a, b) { return a + b; }`):

- Output shape `[n, 384]`; every value finite; per-row L2 norm `1.000000`.
- Repeat inference is bit-identical within a process and across processes.
- Ranking is sane: for query `authentication`, `login` scores 0.576 and
  `add` 0.050.
- Offline: inference succeeds inside `unshare -rn` (no network interfaces at
  all), confirming no remote access at inference time.

Batch behaviour: identical text yields the same vector batched or alone
(cosine 0.9948 — quantised kernels are not bit-stable across batch geometry;
fp32 is, see §4).

### The build-script decision

`onnxruntime-node@1.30.0` has `postinstall: node ./script/install`. On
`linux/x64` that script maps to the `cuda12` manifest and downloads CUDA/TensorRT
provider libraries from NuGet. Two independent facts make denying it safe:

1. The CPU binaries are **already in the tarball**:
   `bin/napi-v6/linux/x64/onnxruntime_binding.node` and
   `libonnxruntime.so.1`. The script only adds GPU providers.
2. With the script denied, `pnpm install --frozen-lockfile` succeeds and
   384-dim CPU inference runs offline.

`allowBuilds: {onnxruntime-node: false}` is a recorded *denial*. pnpm fails
closed on a script that is neither approved nor denied, so the migration cannot
land without this line; the line must never be `true` without the scoped NuGet
supply-chain review the earlier assessment demanded.

## 4. Old/new vector compatibility — the migration hazard

This is the finding that most changes the migration's risk profile.

`@xenova/transformers` defaults to the **quantised** weights
(`quantized: true` → `onnx/model_quantized.onnx`). `@huggingface/transformers`
defaults to **`fp32`** (`DEFAULT_DEVICE_DTYPE = fp32` → `onnx/model.onnx`).
A naive import swap therefore silently changes every vector ALiX produces while
model id, dimension (384) and normalisation all stay identical — nothing fails,
the numbers just differ.

Measured, same model files, same inputs:

| Comparison | Result |
|---|---|
| v2 fp32 vs v4 fp32 (ORT 1.14 vs 1.30, float graph) | cosine ≥ 0.9999995, max abs diff ≤ **1.7e-7** |
| v2 q8 vs v4 q8 (ORT 1.14 vs 1.30, quantised graph), single-string calls | cosine ≥ 0.99968, max abs diff ≤ **4.0e-3** |
| v2 q8 vs v4 fp32 | cosine 0.9877 – 0.9952 (materially different vectors) |

Interpretation, stated at the strength the evidence supports:

- **fp32 is numerically stable across ONNX Runtime versions.** Differences are
  float-summation noise.
- **Quantised (q8) arithmetic is not stable — and the dominant cause is batch
  *geometry*, not the runtime version.** Within a single runtime, the same text
  scored alone versus inside a padded multi-item batch differs by up to
  **2.9e-2** max-abs for q8, while fp32 is bit-identical across the same
  geometry change. Cross-version drift at ALiX's real call shape (one string
  per call, batch size 1) is only ~4e-3.
- ALiX is structurally insulated from the geometry effect because
  `getEmbedding` always embeds a single string, so no cross-sample padding
  occurs. It is *not* insulated from the version effect, which is why the cache
  is namespaced.
- The existing on-disk cache (2,724 entries under `.alix/embeddings/semantic/`)
  was produced by v2's quantised default: a re-computation of a cached file's
  text under v2 reproduces the stored vector exactly (cosine 1.000000187).

Decision: the migration **preserves `dtype: "q8"`** so the representation ALiX
asks for does not change as a side effect of the library swap, and isolates the
residual difference behind a cache namespace instead of pretending it is
bit-identical. Ranking was verified stable: across three queries and eight
candidate files, v2-q8 and v4-q8 produced identical ordering and identical
top-1 results. q8 was 2–3× faster to load and ~2× faster per batch than fp32.

**Consequence for stored caches:** vectors in the legacy directory
`.alix/embeddings/semantic/*.json` are q8 vectors from a different ORT build.
They are *not* reused (see §5), so a mixed cache cannot exist.

## 5. Cache migration strategy

Previously the cache key was `sha256(text)[0..16]` only, under
`.alix/embeddings/<label>/`. That silently mixes vectors from different models,
revisions, precisions and pooling settings, because none of those were in the
key.

Now the directory is `.alix/embeddings/<label>/<vectorSpaceId>/`, where

```
vectorSpaceId = sha256(modelName|revision|dtype|pooling|normalize|vectorSpaceVersion)[0..12]
```

- Different model, revision, precision, pooling or normalisation ⇒ different
  directory ⇒ a stale vector can never be read.
- `VECTOR_SPACE_VERSION` is bumped for a representation change that keeps the
  config constant (e.g. a pooling bug fix).
- Migration effect: the first run after upgrade recomputes embeddings once into
  the new namespace. The legacy directory is left in place and simply stops
  being read, so a rollback to an older build still finds its old vectors.
  Nothing is deleted, and no two runtimes share a directory.

Failed loads are no longer memoised: a rejected model promise is cleared so a
later call retries rather than replaying the failure forever.

Offline mode is strict. Setting `ALIX_EMBEDDING_MODEL_PATH` (or
`modelPath`) sets `env.localModelPath`, `env.allowRemoteModels = false` **and**
`env.useFSCache = false` for the duration of the load. The last one is not
cosmetic: with the filesystem cache enabled, a model absent from `modelPath` was
silently satisfied from the library's own cache inside `node_modules`, so a run
that claimed to be offline against a local model actually resolved something
else. Disabling it makes a missing model fail closed with
`EmbeddingUnavailableError` and a remediation hint.

All three `env` fields are process-global, so the load path snapshots them,
serialises concurrent loads, and restores them in `finally`. Both properties are
load-bearing and were verified by probe:

- Without restoring `useFSCache`, a *download* is structurally impossible
  afterwards — the Node weight loader returns only through the cache match, so a
  later non-offline load fails with `Unable to get model file path or buffer`.
  The error's own "unset the variable to allow a one-time download" remediation
  would be a lie.
- Without serialising, two embedders with different roots corrupt each other,
  because the library re-reads `env.localModelPath` after `await` points.

Verified after the fix: globals are byte-identical before and after both a
successful and a failed offline load, and a fresh-cache download still succeeds
immediately after an offline load.

A model load that fails because the model is absent or unresolvable is **not**
retried. It is terminal, so the failure is memoised; transient load failures are
still retried. This matters because retrying is not free: a model id that does
not exist upstream produces an outbound 404 per attempt. `microsoft/codebert-base`
is exactly that case, which is why the context compiler no longer constructs a
code embedder (see §8).

## 6. Dependency audit before/after

`pnpm audit` advisory count across the whole graph: **29 → 15 (−14)**.

Removed outright by the migration:

- `protobufjs@6.11.6` — 1 critical + 5 high + 5 moderate (incl. GHSA-xq3m-2v4x-88gg)
- `sharp@0.32.6` — 3 high

Added: **none.**

Remaining, none of which the migration touched:

| Package | Count | Reachability |
|---|---|---|
| `vite@8.0.13` | 7 | dev-only (vitest); not in the packaged CLI |
| `postcss@8.5.18`, `source-map-js@1.2.1`, `nanoid@3.3.16` | 3 | dev-only, via vite |
| `glob@13.0.6` | 1 (moderate) | dev-only (c8/test-exclude) |
| `minimatch@10.2.6`, `brace-expansion@5.0.9` | 4 | **production**: glob-DoS advisories |

`minimatch`/`brace-expansion` are direct production dependencies used on
workspace-relative paths (see §8). They are *not* exception-listed, above the
`failSeverity: critical` threshold, and therefore do not fail the gate; they are
real residual risk, not waived.

Exception disposition:

| Entry | Action | Justification |
|---|---|---|
| `@xenova/transformers` | **removed** | package no longer in the dependency graph |
| `onnx-proto` | **removed** | was only reachable through onnxruntime-web@1.14 |
| `protobufjs` | **removed** | resolved: 6.11.6 → 7.6.6, outside every listed range |
| `onnxruntime-web` | **restated**, expiry 2027-01-29 | **premise was false.** The old reason said migration "will eliminate this dependency". It does not: `@huggingface/transformers@4.3.2` pulls `onnxruntime-web@1.31.0-dev.20260914-8d85527a0` and `onnxruntime-common@1.31.0-dev.20260911-2a43ec07e` — *prerelease* builds. |
| `vite` | **restated**, expiry 2027-01-29 | still present, still dev-only; substance unchanged, not silently extended |

No expiry was extended on an expired entry without its reason being re-examined;
the `onnxruntime-web` row is the one whose original justification the evidence
contradicted, and it is recorded as such rather than quietly renewed.

Determinism: `pnpm install --frozen-lockfile` succeeds and `pnpm install` is a
no-op against the committed lockfile.

Two transitive version changes are consequences of the migration and are called
out rather than hidden under "no unrelated changes":

- **`sharp` 0.32.6 → 0.35.5**, plus its `@img/sharp-*` platform packages and
  `@emnapi/runtime`. `@huggingface/transformers` requires `^0.35.4`;
  `@xenova/transformers` required `^0.32.0`. This is a native-binary dependency
  moving two minor lines, and it is the reason `sharp: true` in `allowBuilds` is
  now a dead approval (0.35.5 defines no install script).
- **`protobufjs` 6.11.6 → 7.6.6**, which is the point of the exercise.

Everything else is byte-identical to `HEAD` (verified package-by-package for
`vite`, `glob`, `minimatch`, `brace-expansion`, `nanoid`, `postcss`,
`source-map-js`, `effect`, `typescript`, `vitest`, `better-sqlite3`, `tiktoken`,
`web-tree-sitter`, `yaml`).

## 7. Verification

Run on the migrated tree (copy of the real repository with the migrated graph
installed):

| Command | Result |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm typecheck:unused` | PASS (0 unused) |
| `pnpm build` | PASS |
| `pnpm verify:deps` | PASS (24 pins) |
| `node scripts/verify-lifecycle-scripts.mjs` | PASS (3 approved, 0 missing, 0 expired) |
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm audit --json` | 15 advisories (was 29) |
| `embedding-cache-deterministic` | 19/19 PASS |
| `embedding-cache-cpu` (provisioned) | 4/4 PASS |
| `embedding-cache-cpu` (unprovisioned) | skipped, exit 0 |
| other `tests/repomap/*` | PASS (context-compiler 16, pipeline 20, features 5, ranker 2, dependency-graph 9, repomap-lite 17, sparse-batch 1, git-activity 2, symbol-extractor 2) |

Pre-existing failures, unchanged by this work (present on the baseline commit
before any edit): 3 `daemon-universal` cross-workspace tests
(`ENOENT /tmp/cross-workspace-test.sock`) and 2 `warm-breakdown` timeouts.

## 8. Residual risk and blockers

1. **`onnxruntime-web` is now a prerelease dependency.** `1.31.0-dev.20260914`
   and `onnxruntime-common@1.31.0-dev.20260911` are development-tagged builds
   with no release advisory coverage. This is a supply-chain exposure the
   migration *introduces*, and it is the single strongest reason D9 stays HOLD.
   Note the restated exception currently matches by package name, so it would
   auto-accept any future `onnxruntime-web` advisory — scoping it to specific
   GHSA ids is preferable and is part of the outstanding decision.
2. **Native binary provenance is unaudited.** CPU binaries ship inside the
   `onnxruntime-node@1.30.0` tarball and were used as-is; no independent
   verification of those binaries against an upstream build was performed. The
   model weights *were* checksum-verified against the pinned revision (§2), but
   nothing verifies them at load time — the revision pin is a trust assumption,
   not an enforced check.
3. **Quantised inference is not geometry- or version-stable.** ALiX embeds one
   string per call, which removes the geometry effect; a future ORT upgrade can
   still move vectors by ~4e-3 cosine. The cache namespace prevents silent
   mixing but does not detect drift; there is no stored-vector sentinel.
4. **Glob-DoS advisories remain reachable** through `minimatch` →
   `brace-expansion` on workspace paths.
5. **`microsoft/codebert-base` ships no ONNX artifacts** and cannot run on this
   runtime. `CODE_EMBEDDER` is retained for API compatibility; the context
   compiler no longer constructs it, and `RankingStage` treats the absent score
   as 0 (the same contribution the always-failing embedder produced before).
6. **Legacy cache is orphaned, not migrated.** 2,724 files / 22 MB under
   `.alix/embeddings/semantic/` are simply no longer read. There is no cleanup
   path, and rolling back to an older build silently reinstates the old
   vectors into a system whose tuning assumes the new ones.
7. **CI exceptions gate is fail-open.** `runExceptionsCheck`
   (`src/governance/security/supply-chain/security-exceptions.ts:363`) returns
   `ok: true` and skips `checkExceptionsPolicy` entirely, using only file
   presence and schema. Before this change it reported "0 expired" on five
   entries expired 2026-09-16, so the Sf.2 gate in
   `scripts/check-supply-chain.sh` could not fail on expiry. Confirmed by
   calling `checkExceptionsPolicy` directly, which returns `ok: false` with five
   `SC_EXCEPTION_EXPIRED` findings. Not fixed here — it is an unrelated
   governance defect that deserves its own reviewed change.

## 9. D9 Phase F recommendation

**HOLD.**

The embedding migration itself is technically qualified on x86-64 Linux CPU:
real offline inference, deterministic output, provenance-pinned model, fail-closed
error handling, an audited 29 → 15 advisory reduction, and cache isolation that
prevents cross-runtime vector mixing.

Phase F cannot close because (a) the migration introduces prerelease
`onnxruntime-web`/`onnxruntime-common` builds into the production graph with no
advisory coverage, (b) the bundled native binaries have no independent
provenance review, and (c) the supply-chain exceptions gate is fail-open, so
"the gate passes" is not currently evidence of anything. Additionally, D9's
requirements around independent verification and Harness Gate E remain outside
what this session can supply.

No waiver. No exception deleted to make CI pass. No expiry extended without
restating the reason.
