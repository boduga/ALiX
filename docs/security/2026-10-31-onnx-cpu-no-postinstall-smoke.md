# ONNX CPU-only smoke test without installer approval

Date: 2026-10-31
Status: **PARTIAL PASS / INFERENCE NOT QUALIFIED**
Baseline: `dbd8f74f` (security assessment PR #1006)
Branch: `test/onnx-cpu-no-postinstall`

## Isolation and trust boundary

No `onnxruntime-node@1.30.0` postinstall script was run or approved. This was an inspection and module-load test against packages left in local pnpm's store after a previous install attempt was blocked by `ERR_PNPM_IGNORED_BUILDS`. No dependency manifest or lockfile was changed. This does **not** constitute a clean reproducible `pnpm install --ignore-scripts` installation, which remains to be tested in a fresh isolated workspace.

## Results on Linux x86-64 / Node.js 26.11.0

| Test | Result |
|---|---|
| Bundled `onnxruntime-node@1.30.0` CPU addon `onnxruntime_binding.node` exists | PASS |
| Direct native addon load (`require(...)`) | PASS |
| `onnxruntime-node` package load and reported version 1.30.0 | PASS |
| `@huggingface/transformers@4.3.2` CommonJS package load; `pipeline` callable exported | PASS |
| Hugging Face runtime load with `allowRemoteModels=false` | PASS |
| Hugging Face ESM entrypoint direct import | FAIL: `onnxruntime-common` named `Tensor` export resolution in current exploratory local dependency state |
| Actual model inference, embedding shape, numerical consistency | **NOT TESTED** — no locally provisioned ONNX model artifact |
| Clean isolated install, reproducibility, offline runtime | **NOT TESTED** |
| Full dependency audit after migration | **NOT TESTED** — migration not applied |

The ESM import failure is a compatibility signal requiring reproduction after a clean install; it must not be dismissed or classified as a product regression before the install environment is validated. CommonJS load success is not proof that ALiX's TypeScript ESM import path works.

## Next acceptance work

1. Create a clean, isolated, disposable install with lifecycle scripts explicitly disabled and a reviewed, pinned dependency graph. Do not modify repository `allowBuilds` to accommodate unreviewed scripts.
2. Supply a pinned, checksum-verified, locally stored CPU ONNX model from a reviewed provenance source; execute real inference with no remote fetch and no GPU libraries.
3. Reproduce and resolve the ESM import mismatch under ALiX's actual TypeScript build/runtime settings.
4. Run embedding-cache behavioral tests and compare cache/vector compatibility; separately audit the new dependency graph.
5. Obtain independent security qualification before considering removal or amendment of expired exceptions.

**Verdict: HOLD for migration and D9 security closeout.** No approval, waiver, or certification is implied.
