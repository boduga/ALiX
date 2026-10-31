# Dependency advisory remediation: vite, minimatch, brace-expansion, glob

Date: 2026-10-31
Branch: `fix/dependency-advisories-vite-minimatch`
Base: `origin/main` @ `d77aa991`
Status: **15 of 29 advisories resolved; 0 introduced**

## Why this change is independent of the embeddings migration

`main` carries 29 npm advisories. Sixteen of them (`protobufjs` ×11,
`sharp` ×3, plus the `@xenova/transformers` tree they come from) are resolved
only by the `@huggingface/transformers` migration, which is on HOLD. The
remaining thirteen have nothing to do with embeddings: they come from the
`vite` toolchain and from `minimatch`/`brace-expansion`/`glob`.

This branch is therefore based on `main`, not stacked on the embeddings work,
so the part of the exposure that is straightforwardly fixable is not held
behind an unrelated supply-chain decision.

## Result

| | Advisories |
|---|---|
| `main` | 29 (1 critical, 15 high) |
| after | **14** (1 critical, 3 high) |
| resolved | **15** |
| introduced | **0** |

The 14 remaining are `protobufjs` (11) and `sharp` (3), all production, all
resolved by the HOLD-blocked migration. None of them is touched here.

### Advisories resolved

| GHSA | Severity | Package |
|---|---|---|
| GHSA-587h-7wmj-h5pm | high | vite |
| GHSA-v6wh-96g9-6wx3 | moderate | vite |
| GHSA-698v-4r3x-3vcv | moderate | vite |
| GHSA-r825-w8mm-5pxw | moderate | vite |
| GHSA-rq7h-c2jc-7f22 | moderate | vite |
| GHSA-fx2h-pf6j-xcff | moderate | vite |
| GHSA-9jrq-w75r-8gcw | low | vite |
| GHSA-fxqj-rqcc-2cmp | moderate | postcss |
| GHSA-2v37-7h3g-55p8 | high | nanoid |
| GHSA-68fv-2mgg-jv7q | high | source-map-js |
| GHSA-g3hv-75wg-m249 | moderate | minimatch |
| GHSA-qhr7-859c-m2p7 | high | brace-expansion |
| GHSA-6j4f-fj2g-mc7p | high | brace-expansion |
| GHSA-q2hr-2g5m-vwhr | moderate | brace-expansion |
| GHSA-3g3m-2fjr-6pw4 | moderate | glob |

## What changed

Two version bumps in `package.json`; the rest is `pnpm-lock.yaml`.

| Package | From | To | Kind |
|---|---|---|---|
| `minimatch` | 10.2.6 | 11.0.3 | direct production dependency |
| `glob` | 13.0.6 | 14.0.3 | direct dev dependency |
| `vite` | 8.0.13 | 8.3.5 | transitive, via `vitest` (`^8.0.0`) |

**Ten of the fifteen fall out of one transitive update.** `vite@8.0.13`
pulled `postcss@8.5.18`, which pulled `nanoid@3.3.16` and
`source-map-js@1.2.1`. Moving `vite` to 8.3.5 resolves it to
`postcss@8.5.32` / `nanoid@3.3.20` / `source-map-js@1.2.2`, clearing all four
packages. `vite` is not a direct dependency, so this needed no `package.json`
change: `vitest@5.0.3` declares `vite: ^6.4.0 || ^7.0.0 || ^8.0.0`.

### The scoped override

`minimatch@11.0.3` and `glob@14.0.3` fix the production path, but a second
copy survived: `c8@12.0.0` → `test-exclude@8.0.0` → `glob@13.0.6` →
`minimatch@10.2.6` → `brace-expansion@5.0.9`.

`test-exclude@8.0.0` is the **latest** release and still declares
`glob: ^13.0.6` / `minimatch: ^10.2.2`, so there is no upstream version that
fixes it. Leaving it would have meant shipping four known advisories, three of
them high, in the coverage tooling.

`pnpm-workspace.yaml` therefore pins the fixed lines, **scoped to that subtree
only**:

```yaml
overrides:
  "test-exclude>glob": 14.0.3
  "test-exclude>minimatch": 11.0.3
```

Scoped rather than global so no other consumer is silently moved off its
declared range.

Forcing a dependency outside its declared range is the risky part of this
change, so it was verified behaviourally rather than assumed:

- `test-exclude@8.0.0` uses only `minimatch(path, pattern, opts)` and
  `glob.sync` / `glob()`. Both APIs are stable across minimatch 10→11 and
  glob 13→14.
- Direct `test-exclude` probe: `globSync` enumerated 1499 files, and
  `shouldInstrument` returned the correct verdict for an included file, an
  excluded test file, and a `node_modules` path.
- Real `c8` run produced a coverage summary (`67.85%` statements) with no
  error.

After the override, `pnpm why` reports exactly one version of each:
`glob@14.0.3`, `minimatch@11.0.3`, `brace-expansion@5.0.12`.

### minimatch 10 → 11 behavioural parity

`minimatch` is production code, not just tooling: `src/capabilities/tools/ignore.ts`,
`file-tools.ts` and `repomap-lite.ts` use it to decide which workspace paths are
ignored and which files a search touches. minimatch 11 changed `**` handling and
added `@isaacs/nonrecursive-glob-match`, so a silent behavioural change could
weaken ignore enforcement rather than merely break a test.

Both versions were run side by side over 754 pattern/path/option comparisons:
18 representative patterns (including `.env`, `.git`, `node_modules`, `**`,
`a/**/b`, brace sets and `**/secrets/**`) against 21 paths, with `{ dot: true }`
and default options, plus the exact `` `${p}/**` `` construction `ignore.ts`
builds for directory patterns.

**Result: 754 comparisons, 0 differences.**

## Exception removed

`security/audit-exceptions.json` lost **one** entry — `vite` — because the
vulnerability it excused is genuinely fixed (8.3.5 ≥ the highest patched
requirement of 8.1.6). Verified by matching the exception file against the
post-change audit: `vite` matches zero advisories, `protobufjs` matches
eleven.

The other four entries (`@xenova/transformers`, `onnx-proto`,
`onnxruntime-web`, `protobufjs`) were **left untouched**. They belong to the
transformers migration, not to this change, and renewing or deleting them
here would be an unreviewed decision made to make a gate look better. They
remain expired (2026-09-16) and are tracked by the migration work.

`lastReviewed` moved to 2026-10-31 because the file was reviewed.

## Verification

| Command | Result |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm typecheck:unused` | PASS (0 unused) |
| `pnpm build` | PASS |
| `pnpm verify:deps` | PASS (24 exact pins) |
| `pnpm audit --json` | 29 → 14 advisories |
| `security supply-chain lifecycle-check` | PASS (0 unapproved, 0 expired) |
| `bash scripts/check-supply-chain.sh` | PASS |
| `tests/file-tools.test.js` | 6/6 |
| `tests/tools/search-tools.test.js` | 13/13 |
| `tests/repomap/repomap-lite.test.js` | 17/17 |
| glob-consumer vitest files (4) | 67/67 |
| `c8` coverage path | produced a summary, no error |
| `pnpm test:node` | see below |
| `pnpm test:vitest` | see below |

### A note on the first lifecycle-check run

The first `lifecycle-check` failed, reporting `onnxruntime-node@1.30.0` and
`protobufjs@7.6.6` as unapproved. Neither version appears in the lockfile:
they were stale `node_modules/.pnpm` directories left behind by an earlier
branch. The check reads the **installed tree**, not the lockfile, so it
reported packages that were not part of this change.

A clean `pnpm install --frozen-lockfile` after removing `node_modules` made
the check pass with zero unapproved packages. This is recorded because the
false failure is itself a property of the check worth knowing: a stale tree
can produce a lifecycle verdict that does not describe the lockfile.

## Residual risk

- The 14 remaining advisories (`protobufjs`, `sharp`) are production and
  unfixed on `main`. They require the embeddings migration, which is on HOLD.
  This PR does not reduce or disguise them.
- The override forces `test-exclude` outside its declared dependency ranges.
  If a future `test-exclude` release widens them, the override should be
  removed. It is scoped so the removal is a one-line change.
- `security/audit-exceptions.json` `$schema` points at
  `security/schemas/audit-exceptions.schema.json`, which **does not exist** in
  the repository. The document therefore has no live schema validation. This
  is pre-existing and not addressed here; the in-code validator in
  `security/doctor.ts` is the only structural check that currently runs.
