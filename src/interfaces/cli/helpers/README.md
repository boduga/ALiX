# CLI Helpers

## Overview
Shared parsing and selection helpers for CLI commands. They keep argument validation, approval-store access, provider availability, model discovery, and interactive prompting out of individual command entry points.

## Interface
- `parseInitArgs(argv)`, `ParsedInitArgs`, `InitArgsError`, and `InitArgsErrorCode` [init-args.ts:parseInitArgs]
- `parseKeyValueArgs(args, keys, flags)` [parse-args.ts:parseKeyValueArgs]
- `openApprovalStores(cwd)` and `ApprovalStores` with `stores`, `union`, and `owner` [approval-stores.ts:openApprovalStores]
- `ProviderAvailability`, `resolveProviders()`, `getAvailableModels()`, `selectFromList()`, `selectProviderInteractive()`, `selectModelInteractive()`, and `resolveInitialProviderAndModel()` [provider-selection.ts:resolveProviders]

## Invariants
- Init parsing supports only `--provider`, `--model`, and `--help`/`-h`; missing values and unexpected positionals raise typed `InitArgsError` codes instead of exiting [init-args.ts:parseInitArgs]
- Generic key/value parsing consumes a following token only for listed value keys and only when it does not start with `--`; listed bare flags become `true` [parse-args.ts:parseKeyValueArgs]
- Approval queries concatenate project and global stores and de-duplicate by record id; an unknown owner falls back to the project store [approval-stores.ts:openApprovalStores]
- Provider discovery reports every provider with availability and key source rather than filtering the list [provider-selection.ts:resolveProviders]
- Model discovery retries transient failures once, does not retry permanent failures, caches by provider id, and emits fallback warnings at most once per provider per process [provider-selection.ts:getAvailableModels]
- An explicit `--provider` wins in TTY and non-TTY modes; no provider on a non-TTY uses detection, while a TTY prompts for an available provider and model [provider-selection.ts:resolveInitialProviderAndModel]
- Interactive model selection shows at most 50 models with free models ordered first [provider-selection.ts:selectModelInteractive]

## Side Effects
- Provider availability resolves API keys through the credential store and probes installed Ollama models [provider-selection.ts:resolveProviders]
- Model discovery calls live provider catalogs and writes fallback warnings to stderr [provider-selection.ts:getAvailableModels]
- Interactive flows prompt on stdin, may write cancellation or truncation notices to stderr, and exit with status 130 on cancellation [provider-selection.ts:resolveInitialProviderAndModel]

## Verification
- Run: `pnpm test`
