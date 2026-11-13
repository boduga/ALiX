# Provider Specifications

## Overview
Pure request/response specifications for each model provider. A `ProviderSpec` translates ALiX's normalized request, response, and stream-chunk shapes to and from a provider's native HTTP API; the unified dispatcher owns actual network execution, retries, and streaming. Most OpenAI-compatible providers inherit the shared OpenAI chat-completions base and override only the endpoint or wire-format quirks.

## Interface
- `ProviderSpec`: `baseUrl`, optional `streamUrl`/`toolCallUrl`, `authHeader`, `toRequestBody`, `fromResponse`, `fromStreamChunk`, `toErrorMessage`, and optional `resolveModel` in `spec-types.ts`.
- Shared OpenAI-compatible translator: `openaiBaseSpec` in `_openai-base.ts`, inherited by OpenAI, Groq, DeepSeek, Perplexity, MiniMax, Zhipu AI, Grok AI, OpenRouter, FreeLLMAPI, Xiaomi MiMo Token Plan, Intern, and Hive specs.
- Native specs: `anthropicSpec`, `googleSpec`, `ollamaSpec`, `localLlamaSpec`, and `mockSpec` define their own wire formats.
- Endpoint and limit exports: `DEFAULT_FREELLMAPI_BASE_URL`, `DEFAULT_HIVE_BASE_URL`, `DEFAULT_HIVE_MODEL`, `HIVE_OUTPUT_TOKEN_LIMIT`, `HIVE_MODEL_INPUT_LIMITS`, `hiveInputLimitFor`, `DEFAULT_INTERN_BASE_URL`, `DEFAULT_INTERN_MODEL`, `INTERN_OUTPUT_TOKEN_LIMIT`, `INTERN_MODEL_INPUT_LIMITS`, `internInputLimitFor`, and `DEFAULT_XIAOMI_MIMO_BASE_URL` in their respective spec files.
- Grammar-constrained tool-call schema: `buildToolCallSchema` in `_tool-schema.ts`.
- Ollama response parsing: `parseOllamaToolCalls`, `ParseToolCallOptions`, `extractOllamaContent`, `extractOllamaUsage`, and `extractOllamaFinishReason` in `ollama-tool-calls.ts`.
- Model-aware OpenAI parameter rewrite: `isOpenAIReasoningModel` and `openaiSpec` in `openai-spec.ts`.

## Invariants
- Specs are pure translators with no I/O or state; the dispatcher in `unified-complete.ts` performs HTTP, retries, and streaming: `ProviderSpec` in `spec-types.ts`.
- OpenAI-compatible request bodies request `stream_options.include_usage` when streaming so token usage remains measurable: `openaiBaseSpec.toRequestBody` in `_openai-base.ts`.
- The OpenAI base adds a `summary` property to every tool schema and only requests `parallel_tool_calls` through the capability gate: `openaiBaseSpec.toRequestBody` in `_openai-base.ts`.
- OpenAI reasoning models with an `o<digit>` id rename `max_tokens` to `max_completion_tokens`; non-reasoning models retain `max_tokens`: `openaiSpec.toRequestBody` and `isOpenAIReasoningModel` in `openai-spec.ts`.
- Xiaomi MiMo renames `max_tokens` to `max_completion_tokens` unconditionally because that provider documents only the newer field: `xiaomiMimoTokenPlanSpec.toRequestBody` in `xiaomi-mimo-token-plan-spec.ts`.
- Tool-bearing Ollama requests use the `/api/chat` message format and `toolCallUrl`; tool-free requests use `/api/generate` prompt format: `ollamaSpec.toRequestBody` and `ollamaSpec.toolCallUrl` in `ollama-spec.ts`.
- Ollama tool calls are parsed only from native or OpenAI-compatible structures by default; arbitrary textual JSON becomes a call only when `allowTextFallback` is explicitly enabled: `parseOllamaToolCalls` in `ollama-tool-calls.ts`.
- The Ollama parser skips malformed calls, caps calls at 16 and argument payloads at 64,000 bytes by default, strips `__proto__`/`prototype`/`constructor` keys, and returns `[]` instead of throwing: `parseOllamaToolCalls` and `normalizeArgs` in `ollama-tool-calls.ts`.
- Ollama fallback call ids are deterministic DJB2-based hashes rather than random or crypto values: `stableHash` and `parseNativeToolCalls` in `ollama-tool-calls.ts`.
- Local llama filters `mcp.`/`mcp_` tools out, constrains tool names to the remaining enum, and forces non-streaming when tools are present: `localLlamaSpec.toRequestBody` and `buildToolCallSchema` in `local-llama-spec.ts`/`_tool-schema.ts`.
- Anthropic streaming emits text deltas but not tool-use starts, because streamed arguments arrive later as fragments and are reconstructed by `unified-complete.ts`: `anthropicSpec.fromStreamChunk` in `anthropic-spec.ts`.
- Google maps assistant messages to the `model` role and uses `streamGenerateContent?alt=sse` for streaming: `googleSpec.toRequestBody` and `googleSpec.streamUrl` in `google-spec.ts`.
- Hive and Intern convert `ContentPart[]` to OpenAI content parts; Intern adds the vendor-required `image_url.detail: "auto"`, while Hive omits `detail`: `hiveSpec.toRequestBody` and `internSpec.toRequestBody` in `hive-spec.ts`/`intern-spec.ts`.
- Hive resolves unknown model context limits to 1,048,576, and Intern resolves unknown limits to 262,144: `hiveInputLimitFor` and `internInputLimitFor` in `hive-spec.ts`/`intern-spec.ts`.
- The mock spec returns `text` from the response or `"mock response"` and no tool calls, allowing tests without a network: `mockSpec.fromResponse` in `mock-spec.ts`.

## Side Effects
- None. These specifications perform no disk, network, lock, or process operations; `ProviderSpec` methods only transform values: `ProviderSpec` in `spec-types.ts`.
- HTTP, retry, timeout, and stream execution are delegated to the unified dispatcher rather than performed by a spec: `ProviderSpec` in `spec-types.ts`.

## Verification
- Run: `pnpm test`
