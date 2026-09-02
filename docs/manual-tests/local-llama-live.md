# Local-llama Live Manual Verification

> **Manual — not part of CI.** Requires a real `llama-server` + GGUF model. Do not add to `pnpm test` / CI. Run on demand.

Verifies the `local-llama` provider end-to-end against a real llama.cpp build: plain chat, grammar-constrained tool calling, and structured-output (`response_format`) passthrough.

Related: [Local LLM setup](../local-llama-setup.md) · [Configuration](../configuration.md#local-llama-provider-local-llama) · [llama.cpp capability matrix](../research/llama-cpp-server-capability-matrix.md)

## Prerequisites

- llama.cpp built: `~/llama.cpp/build/bin/llama-server` exists (or set `ALIX_LLAMA_SERVER_PATH`)
- A GGUF model (default: `/home/babasola/.models/Gemma-4-E4B-Uncensored-HauhauCS-Aggressive-Q2_K_P.gguf`)
  ```bash
  ls /home/babasola/.models/*.gguf
  ls ~/llama.cpp/models/*.gguf
  # or set ALIX_LLAMA_MODEL_PATH=/home/babasola/.models/Gemma-4-E4B-Uncensored-HauhauCS-Aggressive-Q2_K_P.gguf
  ```
- `pnpm build` has been run (`dist/` exists)
- Recent llama.cpp build (Jinja default-on, `b3542`+); see config reference version note

## 1. Start llama-server (or let ALiX auto-start)

ALiX auto-starts the server on first `local-llama` call (probe → spawn with resolved knobs). For explicit control:

```bash
# Option A — let ALiX auto-start (no manual server needed)
export ALIX_LLAMA_MODEL_PATH="/home/babasola/.models/Gemma-4-E4B-Uncensored-HauhauCS-Aggressive-Q2_K_P.gguf"
# alix will spawn ~/llama.cpp/build/bin/llama-server -m $ALIX_LLAMA_MODEL_PATH -c 4096 --jinja ...

# Option B — start server manually
~/llama.cpp/build/bin/llama-server \
  -m /home/babasola/.models/Gemma-4-E4B-Uncensored-HauhauCS-Aggressive-Q2_K_P.gguf \
  -c 4096 --port 8080 --jinja &
curl -s http://localhost:8080/v1/models | jq .
# expect: {"data":[{"id":"...","object":"model"}]} and HTTP 200
```

Configure ALiX to use the provider (project or global):

```bash
cat .alix/config.json | jq .model
# {"provider":"local-llama","name":"Gemma-4-E4B-Uncensored-HauhauCS-Aggressive-Q2_K_P.gguf"}
# or: alix models set-default  # pick local-llama + GGUF filename discovered via listModels
```

## 2. Run the manual script

```bash
bash docs/manual-tests/local-llama-live.sh
# or: ALIX_LLAMA_MODEL_PATH=~/llama.cpp/models/tiny.gguf bash docs/manual-tests/local-llama-live.sh
```

Expected output (all three checks `PASS`):

```
[1/3] Plain chat ......................... PASS (text non-empty)
[2/3] Tool calling (grammar) ............. PASS (tool name=file.read)
[3/3] Structured output (response_format)  PASS (valid JSON, required field present)
All checks passed.
```

The script exercises:

1. **Plain chat** — `complete()` with no tools, no `response_format`; asserts `text` non-empty, `toolCalls` empty.
2. **Tool calling** — `complete()` with `file.read` tool; grammar-constrained `response_format: json_schema` must route through bespoke `{"type":"tool","name":"file.read","arguments":{...}}` path (name enum anti-hallucination guard).
3. **Structured output** — `complete()` with `structuredOutputSchema` (`json_schema` passthrough); asserts response is valid JSON containing the required property (not the tool grammar schema).

Failure modes print the raw `llama-server` stderr tail (startup probe) and the `ALIX_LLAMA_*` resolution for debugging.

## 3. Ad-hoc ALiX run

```bash
alix run --mode bypass "list the files in src/ -- just say hi if tools unavailable"
# expect: either plain text or a file.read/shell tool call, then text
```

## Cleanup

```bash
# If you started llama-server manually
pkill llama-server
# or: kill %1
```

## Notes

- Model discovery: `alix models` scans the resolved model directory (`localModelPath` > `ALIX_LLAMA_MODEL_PATH` > `~/llama.cpp/models`) for direct-child `*.gguf` (no recursion, no symlink follow). Empty/missing dir falls back to `DEFAULT_MODELS["local-llama"]`.
- Version ceiling: `arguments` may be string-vs-object across llama.cpp versions; verify against your build if tool args appear as JSON strings.
