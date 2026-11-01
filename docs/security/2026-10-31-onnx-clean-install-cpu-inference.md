# Clean isolated ONNX CPU installation and inference evidence

Date: 2026-10-31
Branch: `test/onnx-clean-esm-cpu-qualification`
Status: **PASS for bounded isolated CPU smoke; migration security qualification HOLD**

## Procedure

Created a disposable `/tmp/alix-onnx-isolated-XXXXXX` project with `type: module`, installed `@huggingface/transformers@4.3.2` using `pnpm add --ignore-scripts --config.minimum-release-age=0`, and did **not** approve or execute `onnxruntime-node` postinstall. The minimum-release-age override applied only to this disposable experiment; no repository configuration or lockfile was changed.

## Results

1. Fresh isolated `pnpm add --ignore-scripts` succeeded, resolving 43 packages. No install lifecycle scripts were executed.
2. ESM `import {pipeline} from '@huggingface/transformers'` succeeded (`typeof pipeline === 'function`).
3. `onnxruntime-node@1.30.0` native package loaded from the installed Transformers dependency graph.
4. `onnxruntime-common` resolved to 1.30.0 in the isolated dependency graph, unlike the earlier mixed repository node_modules where it resolved to 1.14.0.
5. A local 70-byte ONNX **Identity** model was generated deterministically using a minimal protobuf encoder, without downloading a model. SHA-256: `93bcd71fdc840dc8f7cc8da33f66917355faa9d9f776ca36bf26c4504f5080e7`.
6. `onnxruntime-node.InferenceSession.create('./identity.onnx',{executionProviders:['cpu']})` and `.run()` returned `[1.25,-2.5,3.75]` for the matching float32 input. **Actual CPU inference PASS**.

## Important boundaries

This is a minimal ONNX runtime identity-operator smoke test, **not** a Transformers embedding pipeline, tokenization/model-weights test, embedding-cache regression test, full clean ALiX install, offline package-store reproducibility test, supply-chain provenance audit, or security gate clearance. The local model's SHA-256 identifies test bytes but does not provide third-party model provenance. The package store could have reused cached artifacts; this is a fresh project installation, not an independently sourced package verification.

Do not approve the ONNX GPU-provider download script, remove exceptions, or claim D9 Phase F PASS on this evidence. Next: test pinned real embedding model, migration compatibility, lockfile audit, independent verification and governed exception disposition.
