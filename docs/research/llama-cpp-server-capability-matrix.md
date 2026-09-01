# Research: llama.cpp `llama-server` capability matrix (for local-llama provider)

Researched against primary sources only: the official llama.cpp repo (`ggml-org/llama.cpp`, formerly `ggerganov/llama.cpp`) — server README, `docs/function-calling.md`, `tools/server/server.cpp` source, and the GitHub PR/issue history cited inline. Server docs have moved over time: the HTTP server is documented at `examples/server/README.md` historically and now at `tools/server/README.md`. Server changelog is maintained as issue [#9291](https://github.com/ggml-org/llama.cpp/issues/9291).

Note on names: docs/READMEs sometimes say `llama-server` and newer READMEs say `llama serve` (the `llama` CLI subcommand); the OpenAI-compatible server binary is still `llama-server` when built via CMake (`./build/bin/llama-server`).

---

## 1. Tool / function calling on `POST /v1/chat/completions`

**Supported — yes, for ~any model.** llama-server advertises "Function calling / tool use for ~any model" and "OpenAI-compatible chat completions".
Source: `tools/server/README.md` — https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md

**Required `tools` argument shape** (OpenAI function-calling format): an array of objects, each:
```json
{
  "type": "function",
  "function": {
    "name": "get_current_weather",
    "description": "Get the current weather in a given location",
    "parameters": {
      "type": "object",
      "properties": { "location": { "type": "string" } },
      "required": ["location"]
    }
  }
}
```
`parameters` is a JSON Schema (grammar-backed). This exact shape is shown verbatim in the official curl examples.
Sources: `docs/function-calling.md` — https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md ; original tool-call PR #9639 — https://github.com/ggml-org/llama.cpp/pull/9639

**Prerequisite — `--jinja` required.** Tool support is implemented through chat.h and used "in `llama-server` when started w/ `--jinja` flag". The `input_tokens`/chat docs also state `tools`: "Array of tool definitions (requires `--jinja`)". You may need a `--chat-template-file` override to get a tool-use-compatible Jinja template; worst case `--chat-template chatml` may work. Verify the loaded template has a `tool_use` variant via `GET /props` (`chat_template` / `chat_template_tool_use`).
Sources: `docs/function-calling.md`; `tools/server/README.md`

**Response shape when a tool is called:**
```json
"choices": [{
  "finish_reason": "tool_calls",
  "index": 0,
  "message": { "content": null, "tool_calls": [ { "name": "python", "arguments": "{\"code\":\"...\"}" } ], "role": "assistant" }
}]
```
Source (verbatim output): `docs/function-calling.md`

**Multiple / parallel tool calls:** "Multiple/parallel tool calling is supported on some models but disabled by default — enable it by passing `"parallel_tool_calls": true` in the completion endpoint payload." The server README lists a `parallel_tool_calls` request option: "Whether to enable parallel/multiple tool calls (only supported on some models, verification is based on jinja template)."
Sources: `docs/function-calling.md`; `tools/server/README.md`

Additional request options: `parse_tool_calls` ("Whether to parse the generated tool call") and `tool_choice` are accepted.
Sources: `tools/server/README.md`

**Caveat (ambiguity, per instructions):** Tool-call `arguments` serialization has an **open regression history** (see §7). Treat the exact `arguments` string-vs-object shape as version-sensitive; verify against the deployed build.

---

## 2. Structured output: JSON-schema adherence and grammar

Two exposure paths:

**a) Over the OpenAI API — `response_format`.** The chat completions endpoint supports:
- Plain JSON: `{"type": "json_object"}`
- Schema-constrained JSON: `{"type": "json_object", "schema": {...}}` and `{"type": "json_schema", "schema": {...}}` (Pydantic-style JSON Schema, e.g. `{"properties":{"name":{"title":"Name","type":"string"},...}}`), "similar to other OpenAI-inspired API providers".
Source: `tools/server/README.md` — https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md

**b) Server-level flags (grammar / schema).** From the server `--help` (sampling params):
- `--grammar GRAMMAR` — BNF-like grammar to constrain generations
- `--grammar-file FNAME` — read grammar from file
- `-j, --json-schema SCHEMA` — JSON schema to constrain generations (e.g. `{}` for any JSON object). Note: for schemas with external `$ref`s, use `--grammar` + `examples/json_schema_to_grammar.py` instead.
- `-jf, --json-schema-file FILE` — file containing a JSON schema

The `POST /completion` (non-OAI) endpoint also accepts a `json_schema` body field; see `tests/test-json-schema-to-grammar.cpp` for supported JSON-schema features.
Source: `tools/server/README.md` (auto-generated `--help`)

The server lists "Schema-constrained JSON response format" as a headline feature.
Source: `tools/server/README.md`

---

## 3. Chat templates & `--jinja`

- Flags: `--jinja, --no-jinja` — "whether to use jinja template engine for chat (default: enabled)". Env: `LLAMA_ARG_JINJA`.
- Default template selection: "default: template taken from model's metadata" (`tokenizer.chat_template`, and `tokenizer.chat_template.tool_use` when present and tools are requested — per PR #11016). `--chat-template JINJA_TEMPLATE` and `--chat-template-file FILE` override it (built-in template name list: bailing, chatglm3/4, chatml, command-r, deepseek2/3, gemma, llama2/3/4, mistral-v*, phi3/4, qwen? not listed, etc.). Only "commonly used" templates are accepted unless `--jinja` is set.
- When the model has no usable template / jinja is off: the chat completions doc states "By default, the ChatML template will be used", and that "Only models with a [supported chat template] can be used optimally with this endpoint".
- `--chat-template-kwargs STRING` passes extra params to the template engine (e.g. `{"enable_thinking": false}`).
Sources: `tools/server/README.md` (usage + endpoint docs); PR #11016 (Jinja support, minja engine) — https://github.com/ggml-org/llama.cpp/pull/11016

**Behavior when `--jinja` is omitted:** llama-server falls back to legacy/built-in (non-Jinja) templating. Note the server has historically defaulted `--jinja` to enabled (see §7). The Jinja engine used is minja (a Jinja subset); some non-linear templates are not fully supported in non-server tools.
Sources: `tools/server/README.md`; PR #11016

---

## 4. SSE streaming shape for chat completions

OpenAI-compatible SSE. Each event is a `data:` line followed by a blank line (`"data: " + json + "\n\n"`, RFC 8895). Terminal sentinel is `data: [DONE]\n\n` (added only when serving OAI-compatible output).
Sources: `tools/server/server.cpp` (function `server_sent_event`, and `static const std::string ev_done = "data: [DONE]\n\n"` in the streaming provider, e.g. refactor commit `dfa2400`); `tools/server/README.md`

**Chunk payload field names** (`object: "chat.completion.chunk"`), per `to_json_oaicompat_chat_stream()` in `server.cpp`:
- Top-level: `choices`, `created`, `id` (`chatcmpl-…`), `model`, `system_fingerprint`, `object`.
- `choices[0].delta` — incremental fragment. First chunk carries `delta: {"role":"assistant","content":null}` to conform to OpenAI behavior; text arrives as `delta.content`; tool calls arrive as `delta.tool_calls` where each entry has `index`, `id`, `type: "function"`, and `function.name` + incrementally-accumulated `function.arguments` (concatenate across deltas, then the final chunk sets `finish_reason`).
- `choices[0].finish_reason` is `null` during the stream and `"stop"` or `"tool_calls"` on the terminal chunk (based on whether `message.tool_calls` is empty).
- Final chunk may include an empty `choices: []` with a `usage` object (per OpenAI spec for including usage when `stream_options.include_usage`), plus an extra `timings` object.
Sources: `tools/server/server.cpp` (`to_json_oaicompat_chat_stream`, `to_json_oaicompat_chat`) — https://github.com/ggml-org/llama.cpp/blob/master/tools/server/server.cpp ; PR #12379 (tool-call/thought streaming) — https://github.com/ggml-org/llama.cpp/pull/12379 ; server changelog #9291

Documented example of a streamed tool-call (SSE capture, Gemma 4, from a real issue) shows: `{"choices":[{"finish_reason":null,"index":0,"delta":{"tool_calls":[{...}]}}],...object":"chat.completion.chunk"}` … then `{"choices":[{"finish_reason":"tool_calls","index":0,"delta":{}}],...}` (with `usage`/`timings`) … then `data: [DONE]`.
Source: https://github.com/ggml-org/llama.cpp/issues/21384

Note: the browser `EventSource` API **cannot** be used because it lacks POST support (SSE over POST).
Source: `tools/server/README.md`

---

## 5. `GET /v1/models` payload

Returns an OpenAI-style list always containing one element:
```json
{
  "object": "list",
  "data": [{
    "id": "../models/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
    "object": "model",
    "created": 1735142223,
    "owned_by": "llamacpp",
    "meta": {
      "vocab_type": 2, "n_vocab": 128256, "n_ctx_train": 131072,
      "n_embd": 4096, "n_params": 8030261312, "size": 4912898304
    }
  }]
}
```
- `id` defaults to the model file path (`-m`); override with `--alias` (e.g. `--alias gpt-4o-mini`). Multiple `--alias` values allowed (comma-separated).
- `meta` can be `null` (e.g. while the model is still loading).
- Also relevant: `GET /models` and the [`multimodal` capability flag](https://github.com/ggml-org/llama.cpp/blob/master/tools/mtmd/README.md) reported on the model object, used by clients before multimodal requests.
Source: `tools/server/README.md` (verbatim example)

---

## 6. Key server flags, defaults & units

From the auto-generated `--help` in `tools/server/README.md` (master). CLI argument takes precedence over the matching `LLAMA_ARG_*` env var.

| Flag (short / long) | Purpose | Default | Env |
|---|---|---|---|
| `-ngl, --gpu-layers, --n-gpu-layers N` | max layers to store in VRAM; `N` is an exact number, `'auto'`, or `'all'` | `auto` | `LLAMA_ARG_N_GPU_LAYERS` |
| `-fa, --flash-attn [on\|off\|auto]` | Flash Attention | `auto` | `LLAMA_ARG_FLASH_ATTN` |
| `-c, --ctx-size N` | prompt context size (tokens) | `0` (= loaded from model) | `LLAMA_ARG_CTX_SIZE` |
| `-t, --threads N` | CPU threads during generation | `-1` (= auto) | `LLAMA_ARG_THREADS` |
| `-b, --batch-size N` | logical max batch size | `2048` | `LLAMA_ARG_BATCH` |
| `-ub, --ubatch-size N` | physical max batch size | `512` | `LLAMA_ARG_UBATCH` |
| `--host HOST` | bind address (or UNIX socket if addr ends `.sock`) | `127.0.0.1` | `LLAMA_ARG_HOST` |
| `--port PORT` | listen port | `8080` | `LLAMA_ARG_PORT` |
| `--jinja, --no-jinja` | jinja template engine for chat | `enabled` | `LLAMA_ARG_JINJA` |
| `-np, --parallel N` | number of server slots/dictation | `-1` (= auto) | `LLAMA_ARG_N_PARALLEL` |
| `-e, --escape, --no-escape` | process escape sequences | `true` | — |

Other GPU/quant-relevant switches in the same help: `-sm/--split-mode {none,layer,row,tensor}`, `-ts/--tensor-split`, `-mg/--main-gpu`, `-dev/--device <dev1,dev2,..>` (default per-device offload), `-ctk/-ctv` KV cache dtype (default f16), `-kvo/--kv-offload`. Sample latency flags: `--temp` (default 0.80), `--top-p` (0.95), `--top-k` (40), `--min-p` (0.05).
Source: `tools/server/README.md` — https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md

---

## 7. Version drift / threshold implications

Facts from primary sources that imply this provider should assume a recent build and verify at runtime:

- **Jinja default changed.** `--jinja` was introduced in PR #11016 (merged ~Dec 2024) and, for the **server**, was enabled by default from an early point. A later "cli: enable jinja by default" change (#17911, ~Dec 2025) flipped the shared default to `enabled` for all examples; server-specific code that hard-set it was removed.
  Sources: PR #11016 — https://github.com/ggml-org/llama.cpp/pull/11016 ; commit `34a6d86` "cli: enable jinja by default (#17911)" — https://github.com/ryan-mangeno/llama.cpp/commit/34a6d86982b54314516fd40ef5110525247528b8
- **Tool-call streaming (deltas incl. tool_calls) is relatively new** — added in PR #12379 (2025) as a follow-up to #9639. Older servers may not stream `delta.tool_calls` correctly.
  Source: PR #12379 — https://github.com/ggml-org/llama.cpp/pull/12379
- **`tool_calls[].function.arguments` string-vs-object regression (open, important).** A 2026 parser refactor (PR #18675) briefly returned `arguments` as a parsed JSON object, breaking the official `openai` SDK (TypeError: argument must be str). It was reverted so the **OpenAI-compatible string form is the default again**, with a `--tool-args-object` flag to opt into object form (PR #20202 / commit `b283f6d5b` "Revert to OAI-compatible args (#20213)").
  Sources: issue #20198 (2026-03) — https://github.com/ggml-org/llama.cpp/issues/20198 ; referenced PRs #18675, #20202, #20213. This is version-sensitive — a downstream provider must pin/verify behavior rather than assume either shape.
- **Repo/path drift:** OpenAI server README moved `examples/server/README.md` → `tools/server/README.md`; repo org `ggerganov` → `ggml-org`; binary invoked as `llama-server` or the `llama serve` CLI subcommand. Older tutorials reference the `examples/server` path.
- **Notable model-template fragility:** tool calling depends on a tool-aware Jinja template; the docs note some official templates (e.g. DeepSeek R1) are "buggy" and need a llama.cpp-provided override. `--jinja` alone is not sufficient for reliable native tool calling on every model.
  Source: `docs/function-calling.md`

**Recommended threshold:** target a recent master/nightly (post-#12379 streaming deltas, post-#20213 arguments-as-string default). If version < the tool-streaming + arguments-string reverts, tool-calling behavior differs. Best to validate the specific build's `/v1/chat/completions` tool response and `/v1/models` on the actual deployment.

---

## Sources (primary)

- Server README (usage, flags, endpoints, `--help`): https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- Function calling docs: https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md
- Server source (`server.cpp`): https://github.com/ggml-org/llama.cpp/blob/master/tools/server/server.cpp
- Main README: https://github.com/ggml-org/llama.cpp/blob/master/README.md
- Jinja support PR: https://github.com/ggml-org/llama.cpp/pull/11016
- Tool-call support PR: https://github.com/ggml-org/llama.cpp/pull/9639
- Tool-call/thought streaming PR: https://github.com/ggml-org/llama.cpp/pull/12379
- Server changelog issue: https://github.com/ggml-org/llama.cpp/issues/9291
- Streaming deltas + `[DONE]` refactor commit: https://github.com/ggml-org/llama.cpp/commit/dfa240045dd4c903cca608743747131433d66494
- Tool-call arguments regression + revert: https://github.com/ggml-org/llama.cpp/issues/20198
- Recorded streamed tool-call SSE example: https://github.com/ggml-org/llama.cpp/issues/21384
- `cli: enable jinja by default` (#17911): https://github.com/ryan-mangeno/llama.cpp/commit/34a6d86982b54314516fd40ef5110525247528b8
