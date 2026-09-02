# Configuration

ALiX configuration lives in `.alix/config.json` (per-project) and `~/.alix/config.json` (global). Per-project overrides global.

## Config file format

```json
{
  "model": {
    "provider": "google",
    "name": "gemini-2.5-flash"
  },
  "ui": {
    "port": 4137
  },
  "permissions": {
    "protectedPaths": [".git/**", ".env"]
  },
  "mcpServers": [...],
  "subagents": {...},
  "skills": {...}
}
```

## CLI commands

```bash
# Show current config
alix config show

# Set model
alix models set-default   # interactive provider + model selection

# Set API key (writes to .alix/config.json)
alix config set-key <provider> <key>

# Doctor: diagnose config issues
alix config doctor
```

## Model tiers

ALiX uses 3 model tiers for subagents:

- **fast** (Ollama) — simple lookups, file reads
- **thinking** (configurable) — analysis, planning
- **coding** (configurable) — code generation, edits

Override in config:

```json
{
  "subagents": {
    "modelTiers": {
      "fast": { "provider": "ollama", "name": "llama3.2" },
      "thinking": { "provider": "anthropic", "name": "claude-opus-4-8" },
      "coding": { "provider": "anthropic", "name": "claude-opus-4-8" }
    }
  }
}
```

## Providers

ALiX supports multiple providers. Keyed providers require an API key; keyless local providers run without one.

| Provider | Key env var | Notes |
|----------|-------------|-------|
| `anthropic` | `ANTHROPIC_API_KEY` | |
| `openai` | `OPENAI_API_KEY` | |
| `google` | `GEMINI_API_KEY` | |
| `openrouter` | `OPENROUTER_API_KEY` | |
| `groq` | `GROQ_API_KEY` | |
| `deepseek` | `DEEPSEEK_API_KEY` | |
| `perplexity` | `PERPLEXITY_API_KEY` | |
| `minimax` / `minimax-token-plan` | `MINIMAX_API_KEY` / `MINIMAX_TOKEN_PLAN_KEY` | |
| `zhipuai` | `ZHIPUAI_API_KEY` | |
| `grokai` | `GROKAI_API_KEY` | |
| `ollama` | — (keyless) | Uses local Ollama server |
| `local-llama` | — (keyless) | Local llama.cpp server; see below |

Env vars take precedence over config file values. See [Local LLM setup](local-llama-setup.md) for the full local-llama walkthrough.

### Local-llama provider (`local-llama`)

Keyless local provider backed by `llama-server` (llama.cpp). No API key; ALiX auto-starts the server if it is not already running.

**Model selection:**

```json
{
  "model": {
    "provider": "local-llama",
    "name": "phi-3-mini-4k-instruct-q4_K_M.gguf"
  }
}
```

`name` is the GGUF filename (as discovered by `listModels("local-llama")`). `alix models` scans `~/llama.cpp/models` by default.

**Model path:**

Single-file GGUF path for the file loaded at server start (`-m`):

```json
{
  "model": {
    "provider": "local-llama",
    "name": "phi-3-mini-4k-instruct-q4_K_M.gguf",
    "localModelPath": "~/llama.cpp/models/phi-3-mini-4k-instruct-q4_K_M.gguf"
  }
}
```

Resolution for both the scan directory and the launched model: `localModelPath` (config) > `ALIX_LLAMA_MODEL_PATH` (env) > `~/llama.cpp/models` (default directory). An empty/missing scan directory returns `[]` and falls back to the default model entry.

**Launcher knobs (`localLlama` block):**

Tune `llama-server` without hand-editing argv. Precedence: config `localLlama` block > env `ALIX_LLAMA_*` > default. `gpuLayers`/`flashAttn` default to `"auto"` (corresponding `-ngl`/`--flash-attn` flags omitted).

```json
{
  "model": {
    "provider": "local-llama",
    "name": "phi-3-mini-4k-instruct-q4_K_M.gguf",
    "localModelPath": "~/llama.cpp/models/phi-3-mini-4k-instruct-q4_K_M.gguf",
    "localLlama": {
      "ctxSize": 4096,
      "threads": 16,
      "batchSize": 2048,
      "ubatchSize": 512,
      "gpuLayers": "auto",
      "flashAttn": "auto",
      "port": 8080,
      "serverPath": "~/llama.cpp/build/bin/llama-server"
    }
  }
}
```

| Knob | Env var | Default | Notes |
|------|---------|---------|-------|
| `ctxSize` | `ALIX_LLAMA_CTX_SIZE` | `4096` | `-c` |
| `threads` | `ALIX_LLAMA_THREADS` | `16` | `-t` |
| `batchSize` | `ALIX_LLAMA_BATCH_SIZE` | `2048` | `-b` |
| `ubatchSize` | `ALIX_LLAMA_UBATCH_SIZE` | `512` | `-ub` |
| `gpuLayers` | `ALIX_LLAMA_GPU_LAYERS` | `auto` | `-ngl` omitted when `auto` |
| `flashAttn` | `ALIX_LLAMA_FLASH_ATTN` | `auto` | `--flash-attn` omitted when `auto`; `on`/`off`/`true`/`false`/`1`/`0`/`auto` |
| `port` | `ALIX_LLAMA_PORT` | `8080` | `--port` |
| `serverPath` | `ALIX_LLAMA_SERVER_PATH` | `~/llama.cpp/build/bin/llama-server` | binary path |

Additional env: `ALIX_LLAMA_BASE_URL` (default `http://localhost:8080/v1/chat/completions`) overrides the server URL.

Capabilities: `supportsTools: true` (grammar-constrained `response_format: json_schema` over `{"type":"text"|"tool","name","arguments"}`), `supportsStructuredOutput: true` (caller `response_format` `json_object`/`json_schema` passed through), `supportsStreaming: true`. See [Local LLM setup](local-llama-setup.md) and the [llama.cpp capability matrix](research/llama-cpp-server-capability-matrix.md).

**llama.cpp version requirement:**

The provider assumes a recent llama.cpp build with Jinja enabled by default (`--jinja` always passed; server default `-ngl auto` and `tools/server` layout). Use a build newer than ~2024-11 (post `ggml-org` rename) with patch `b3542`+ where `--jinja` defaults on. The server's tool `arguments` serialization has a string-vs-object drift across versions — verify against your deployed build.

## Environment variables

Keyed providers above use `*_API_KEY` env vars. Local-llama extras are listed in the table above.

## Inspector security

By default the Inspector binds to `127.0.0.1` (loopback only) with authentication
disabled for local development. The security configuration is controlled via
`ui.security` in your config file.

```json
{
  "ui": {
    "host": "127.0.0.1",
    "port": 4137,
    "security": {
      "authentication": "disabled-loopback-development",
      "remoteAccess": false,
      "allowedHosts": ["127.0.0.1", "::1", "localhost"],
      "allowedOrigins": [],
      "trustedProxyCidrs": [],
      "requireTlsForRemote": true
    }
  }
}
```

See [Inspector Security](security/inspector-security.md) for full details.

## Supply chain

ALiX pins all direct dependencies. Verify with:

```bash
pnpm verify:deps
```

See [Supply-Chain Policy](../README.md#supply-chain-policy) for details.