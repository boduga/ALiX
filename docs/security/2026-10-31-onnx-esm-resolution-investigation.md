# ONNX ESM resolution investigation — controlled local reproduction

Date: 2026-10-31
Branch: `test/onnx-clean-esm-cpu-qualification`
Status: **ESM resolver issue isolated; clean install and real inference still HOLD**

## Reproduction

- Linux x86-64, Node.js 26.11.0.
- Existing exploratory `@huggingface/transformers@4.3.2` installation had no direct `onnxruntime-common` symlink in its package-local pnpm node_modules.
- Node resolved the bare `onnxruntime-common` import in the Transformers ESM bundle through `node_modules/.pnpm/node_modules/onnxruntime-common`, which pointed at **1.14.0**, a CommonJS-only version.
- Direct ESM import failed with `Named export 'Tensor' not found`.
- `onnxruntime-common@1.30.0` exports ESM `Tensor` from `dist/esm/index.js`.
- In a bounded local test, temporarily redirecting the pnpm hoist link to 1.30.0 made the same Transformers ESM entrypoint import succeed (`ESM_PASS function`, exit 0).
- The hoist link was restored to its original 1.14.0 target immediately after the subprocess exited. No dependency manifest, lockfile, or repository policy was changed.

## Interpretation

The failure is explained by stale/mixed hoisted dependency resolution in the exploratory installation, not established as a defect in the new Transformers ESM bundle. The link manipulation is **diagnostic only**, not an acceptable deployment fix. Reproduce in a fresh, disposable, isolated pnpm installation with scripts disabled before accepting the ESM path.

## Remaining evidence

- No real CPU model inference, embedding shape or numerical compatibility test has been run; no pinned local ONNX model was available.
- No fresh isolated install, offline reproducibility proof, complete post-migration dependency audit, or independent security qualification exists.
- Do not approve the ONNX postinstall download or modify `allowBuilds` as a workaround.

**Verdict:** ESM diagnosis PASS (bounded local cause); CPU migration and D9 security gate HOLD.
