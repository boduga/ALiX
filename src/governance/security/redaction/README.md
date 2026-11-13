# Redaction

## Overview
Structural redaction foundation for ALiX security surfaces. It defines a closed set of secret classifications, four named redaction profiles, and bounded global limits; detects secret spans in strings with pattern and optional entropy heuristics; and walks arbitrary object graphs to replace sensitive values without throwing. Values crossing an external security boundary (logs, CLI output, UI, egress prompts) are expected to pass through one of these profiles.

## Interface
- `RedactionClassification` — closed union of `api_key`, `aws_access_key`, `aws_secret_key`, `private_key`, `bearer_token`, `basic_auth`, `jwt`, `auth_header`, `cookie`, `credential_url`, `password`, `generic_secret`, `connection_string` [classifications.ts:RedactionClassification]
- `ClassificationProfile` — profile shape with `redactedClassifications`, `preservedClassifications`, `markerTemplate`, and `maxRedactedValueChars` [classifications.ts:ClassificationProfile]
- `PUBLIC_PROFILE` (redacts all), `OPERATIONAL_PROFILE` (preserves headers/cookies/URLs/private keys), `ADMINISTRATIVE_PROFILE` (preserves headers/cookies), `SUPPORT_BUNDLE_PROFILE` (redacts none) [classifications.ts:PUBLIC_PROFILE], [classifications.ts:OPERATIONAL_PROFILE], [classifications.ts:ADMINISTRATIVE_PROFILE], [classifications.ts:SUPPORT_BUNDLE_PROFILE]
- Global limits `MAX_DEPTH` (12), `MAX_PROPERTIES` (200), `MAX_ARRAY_ITEMS` (1000), `MAX_STRING_SCAN` (65536), `MAX_OUTPUT_BYTES` (262144), `MAX_SAFE_STRING_LENGTH` (512), `MAX_PREVIEW_LENGTH` (128) [classifications.ts:MAX_DEPTH], [classifications.ts:MAX_STRING_SCAN], [classifications.ts:MAX_OUTPUT_BYTES]
- `DEFAULT_PROFILE = "public"` [profiles.ts:DEFAULT_PROFILE]
- `RedactionPolicy` and `createRedactionPolicy(profileName, opts?)` [redaction-policy.ts:createRedactionPolicy]
- `resolveProfile(name)` — profile-name lookup from the built-in registry [redaction-policy.ts:resolveProfile]
- `keyIsSensitive(key)` — exact normalized sensitive-key predicate [redaction-policy.ts:keyIsSensitive]
- `SecretSpan`, `SecretDetectorOptions`, `createDefaultPatterns()`, `SecretDetector.detect(input)`, `SecretDetector.getDefaultPatterns()` [secret-detector.ts:SecretSpan], [secret-detector.ts:createDefaultPatterns], [secret-detector.ts:SecretDetector]
- `redactText(value, policy, detector)` — in-place span replacement preserving surrounding text [redactor.ts:redactText]
- `redactValue(value, policy, detector)` — structural graph walk returning a redacted copy [redactor.ts:redactValue]

## Invariants
- Profile names resolve case-insensitively; an unknown name throws with the valid profile list [redaction-policy.ts:resolveProfile]
- `redactText`/`redactString` only replace spans whose classification is in the active profile's `redactedClassifications`; preserved classifications pass through unchanged [redactor.ts:shouldRedact]
- Markers are rendered from `markerTemplate` by uppercasing the classification into `{classification}`, e.g. `[REDACTED_API_KEY]` [redactor.ts:markerFor]
- `keyIsSensitive` is exact set membership only — `token` is sensitive, `keyboardLayout` is not; no substring matching [redaction-policy.ts:keyIsSensitive]
- A string under an exact sensitive key becomes `[REDACTED]` regardless of pattern match [redactor.ts:redactInternal]
- Redaction happens before truncation: a redacted string longer than `MAX_SAFE_STRING_LENGTH` is cut to `MAX_PREVIEW_LENGTH` plus a deterministic DJB2 `<hash>` suffix [redactor.ts:redactString], [redactor.ts:truncatedSuffix]
- `redactText` deliberately does not truncate, so a full outbound prompt survives with only secret spans replaced [redactor.ts:redactText]
- `SecretDetector.detect` never throws: non-string or empty input returns `[]`, and internal errors return `[]` [secret-detector.ts:SecretDetector]
- Detector input is truncated to `MAX_STRING_SCAN` before scanning [secret-detector.ts:SecretDetector]
- Each pattern runs under a 1000-iteration ceiling and zero-length matches advance `lastIndex`, preventing runaway matching [secret-detector.ts:runPattern]
- Overlapping or adjacent spans are merged, extending the end offset and keeping the highest-confidence classification [secret-detector.ts:mergeSpans]
- High-entropy detection is opt-in (`enableHighEntropy`, default `false`) and emits `generic_secret` at `low` confidence above Shannon entropy 4.0 [secret-detector.ts:SecretDetector]
- Custom patterns are appended with `medium` confidence [secret-detector.ts:SecretDetector]
- `redactValue` never throws; top-level failure returns `[REDACTION_FAILED]` [redactor.ts:redactValue]
- Limit violations surface as sentinels: `[MAX_DEPTH_REACHED]`, `[MAX_OUTPUT_EXCEEDED]`, `[CIRCULAR_REFERENCE]` [redactor.ts:redactInternal]
- Object traversal never invokes `toJSON()`; Dates become `new Date(NaN)`, Errors are reduced to redacted `message`/`name`/`stack`/`cause`, and Buffers/TypedArrays/ArrayBuffers become `[REDACTED_BINARY]` [redactor.ts:redactInternal]
- Symbols become `[REDACTED_SYMBOL]`; non-finite numbers are stringified; bigints gain an `n` suffix [redactor.ts:redactInternal]
- Throwing property getters yield `[REDACTION_ERROR]` for that property instead of aborting the walk [redactor.ts:redactInternal]
- Cyclic references are detected with a `WeakSet` and replaced with `[CIRCULAR_REFERENCE]` [redactor.ts:redactValue]
- Effective limits come from the policy when set, otherwise 12/200/1000/262144 [redactor.ts:redactValue]

## Side Effects
- Pure in-memory CPU and regex work: no disk, network, subprocess, or global state mutation [redactor.ts:redactValue], [secret-detector.ts:SecretDetector]
- Allocates a `WeakSet` per call for cycle tracking and returns new object/array graphs rather than mutating input [redactor.ts:redactValue]
- Output byte accounting can short-circuit a large result to `[MAX_OUTPUT_EXCEEDED]` [redactor.ts:redactValue]
- Detector recompiles each regex with `new RegExp(...)` and resets `lastIndex` per call, leaving registered pattern objects untouched [secret-detector.ts:runPattern]

## Verification
- Run: `pnpm test`
