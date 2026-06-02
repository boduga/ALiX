# Local LLM with llama-server

Run ALiX against a local llama.cpp server with full tool-calling support.

## 1. Install llama.cpp

Already done — you have `/home/babasola/llama.cpp/build/bin/llama-server`.

## 2. Download a model

```bash
# Create models directory
mkdir -p ~/models

# Download a small but capable model (Phi-3 mini, ~2.3GB)
huggingface-cli download microsoft/Phi-3-mini-4k-instruct-gguf \
  --include "Phi-3-mini-4k-instruct-q4.gguf" \
  --local-dir ~/models

# Or TinyLlama (smaller, ~700MB, less capable)
huggingface-cli download TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF \
  --include "tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf" \
  --local-dir ~/models
```

## 3. Start llama-server

```bash
cd /home/babasola/llama.cpp/build/bin
./llama-server -m ~/models/Phi-3-mini-4k-instruct-q4.gguf \
               -c 4096 \
               --port 8080
```

You should see: `HTTP server listening on port 8080`

## 4. Configure ALiX

Edit `.alix/config.json`:
```json
{
  "model": {
    "provider": "local-llama",
    "name": "phi-3"
  }
}
```

## 5. Test

```bash
alix run "list the files in src/"
```

The model should call `shell.run` with `ls src/` and return the result.

## How tool calling works

ALiX's `local-llama` spec uses llama-server's grammar-constrained generation:

1. Tool definitions are converted to a JSON schema
2. Schema is sent in `response_format.json_schema` field
3. llama-server forces model output to match schema
4. Output is parsed back to ALiX's `ToolCall[]` format

Works with any model that can produce JSON. Phi-3 and Qwen2.5 are recommended.

## Troubleshooting

- **Model outputs invalid JSON**: try a larger/better model (Phi-3 mini is the minimum)
- **Tool name not recognized**: the model picked a name not in your tool list
- **Slow inference**: reduce context size (`-c 2048`) or use a smaller quantization