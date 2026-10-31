# Dependency security remediation — initial technical assessment

Date: 2026-10-31
Branch: `fix/security-dependency-exceptions-20261031`
Status: **HOLD — dependency migration requires explicit build-script trust review and runtime qualification**

## Verified current dependency graph

- `@xenova/transformers@2.17.2` is a direct production dependency, imported in `src/context/repomap/embedding-cache.ts` for `pipeline('feature-extraction', ...)`.
- `onnxruntime-web@1.14.0` is transitive through Xenova; `onnx-proto@4.0.4` and `protobufjs@6.11.6` follow from it.
- `vite@8.0.13` is a development dependency through Vitest. Its installed version is within multiple advisory ranges reported by the current `pnpm audit` output.
- All five repository exception records expire on 2026-09-16. Do not delete, extend, or claim them resolved without governed advisory-by-advisory disposition.

## Audit snapshot

`pnpm audit --json` exited 1, reporting **1 critical, 13 high, 14 moderate, 1 low** advisories across the full dependency graph. These are advisory counts, not a proven exploitability or release-risk classification. Findings also include `sharp`, `postcss`, `nanoid`, `brace-expansion`, `source-map-js`, `minimatch`, and `glob`; the five exception entries do not exhaust the audit surface.

The critical `protobufjs` advisory is GHSA-xq3m-2v4x-88gg, affecting installed 6.11.6 (audit reported patched versions >=7.5.5). Additional `protobufjs` advisories require >=7.5.6 or later. Dependency paths must be upgraded through supported packages rather than overriding incompatible transitive majors without tests.

## Candidate migration and blocked install

A bounded exploratory install of `@huggingface/transformers@4.3.2` resolved the package but failed under the repository's existing pnpm build policy with `ERR_PNPM_IGNORED_BUILDS`: **onnxruntime-node@1.30.0 requires a new install/build-script approval**. This was not overridden or auto-approved. The experimental `package.json` and lockfile modifications were reverted before committing this assessment.

A secure migration requires a separately reviewed build-script trust decision, confirmation of the upstream package's native binary provenance, CPU-only Linux x86-64 inference smoke tests, and embedding-cache compatibility tests. Existing Xenova model identifiers and cached vectors must not be assumed compatible with the new major version without verification.

## Static install-script review — follow-up

Inspected local package `node_modules/.pnpm/onnxruntime-node@1.30.0/node_modules/onnxruntime-node` without executing its postinstall script:

- `package.json` defines `postinstall: node ./script/install`.
- `script/install-metadata.js` sets `requirements['linux/x64'] = ['cuda12']`, mapping three CUDA/TensorRT `.so` provider libraries to a `Microsoft.ML.OnnxRuntime.Gpu.Linux` NuGet package. Other listed targets have empty requirements.
- `script/install.js` selects the platform manifest, checks for missing files, and invokes `installPackages`; `install-utils.js` retrieves NuGet index/package over HTTPS and extracts selected entries to the native binary directory. No independently verified checksum/signature check was identified in the inspected download/extraction path. This is a supply-chain risk requiring review, not proof of compromise.
- The local package already contains `bin/napi-v6/linux/x64/onnxruntime_binding.node` and `libonnxruntime.so.1`, indicating that CPU-native binaries are bundled. **This is not yet a successful runtime inference test.**
- `@huggingface/transformers@4.3.2` declares `onnxruntime-node@1.30.0`, `onnxruntime-web@1.31.0-dev.20260914-8d85527a0`, and `sharp@^0.35.4` dependencies. Their individual advisories and native artifacts still require review.

**Decision:** Do not allow the unrestricted postinstall script or approve new downloads. First verify a package install with lifecycle scripts disabled, CPU-native binding load, real CPU-only model inference, model provenance and compatibility, and a reproducible offline CI path. Any future build-script exception requires separate explicit authorization and exact package/version review.

## Recommended next steps

1. Independently inspect `onnxruntime-node@1.30.0` install scripts, provenance, binary download behavior, and the repository `allowBuilds` policy. Record an explicit scoped approval or reject this candidate; never bypass the guard.
2. Prototype a migration of `embedding-cache.ts` on a dedicated branch after approval, with deterministic offline mocked pipeline tests and real CPU-only model inference smoke tests.
3. Upgrade the development dependency chain for Vite only to a version proven outside each current advisory range; re-run `pnpm audit` and the full CI suite.
4. Assess all other audit findings, not only the five expired exceptions; tie each disposition to actual installed version, runtime reachability, and responsible owner.
5. Run the actual ALiX security gate and independent security review on the final tree. Retain HOLD until evidence is sufficient.

No risk waiver, production build-script approval, final D9 qualification, or release authorization is granted by this report.
