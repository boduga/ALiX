#!/usr/bin/env bash
# Manual live verification for local-llama provider (not part of CI).
# Requires: llama-server binary + GGUF model. See docs/manual-tests/local-llama-live.md
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# --- resolve model path (config > env > default) mirrors provider ---
MODEL_PATH="${ALIX_LLAMA_MODEL_PATH:-$HOME/llama.cpp/models/phi-3-mini-4k-instruct-q4_K_M.gguf}"
BASE_URL="${ALIX_LLAMA_BASE_URL:-http://localhost:8080/v1/chat/completions}"
SERVER_PATH="${ALIX_LLAMA_SERVER_PATH:-$HOME/llama.cpp/build/bin/llama-server}"

echo "local-llama live check"
echo "  model: $MODEL_PATH"
echo "  server: $SERVER_PATH"
echo "  baseUrl: $BASE_URL"
echo ""

if [[ ! -f "$MODEL_PATH" ]]; then
  echo "SKIP: model not found at $MODEL_PATH"
  echo "Set ALIX_LLAMA_MODEL_PATH to a real GGUF, or: ls ~/llama.cpp/models/*.gguf"
  exit 0
fi
if [[ ! -x "$SERVER_PATH" && ! -f "$SERVER_PATH" ]]; then
  echo "SKIP: llama-server not found at $SERVER_PATH"
  echo "Set ALIX_LLAMA_SERVER_PATH or build llama.cpp"
  exit 0
fi

# Ensure build exists
if [[ ! -f "dist/src/providers/specs/local-llama-spec.js" ]]; then
  echo "Building..."
  pnpm build -q
fi

# Run the three checks via node (imports built spec + provider directly)
node --input-type=module <<'NODE'
import { localLlamaSpec } from "./dist/src/providers/specs/local-llama-spec.js";
import { LocalLlamaProvider } from "./dist/src/providers/local-llama-provider.js";

const baseUrl = process.env.ALIX_LLAMA_BASE_URL || "http://localhost:8080/v1/chat/completions";
const model = process.env.ALIX_LLAMA_MODEL || "phi-3-mini-4k-instruct-q4_K_M.gguf";

function fail(msg, extra) {
  console.error(`FAIL: ${msg}`);
  if (extra) console.error(extra);
  process.exit(1);
}

async function check(label, fn) {
  try {
    await fn();
    console.log(`${label} PASS`);
  } catch (e) {
    fail(label, e?.stack || String(e));
  }
}

// 1. Plain chat via spec body + direct fetch (proves server + model)
await check("[1/3] Plain chat", async () => {
  const body = localLlamaSpec.toRequestBody({
    systemPrompt: "You are a helpful assistant. Reply concisely.",
    messages: [{ role: "user", content: "Say hello in one short sentence." }],
    model,
  });
  if (body.response_format) fail("plain chat should not set response_format");
  // Use provider complete (auto-starts server)
  const provider = new LocalLlamaProvider({ model, baseUrl });
  const res = await provider.complete({
    systemPrompt: "You are helpful. Reply concisely.",
    messages: [{ role: "user", content: "Say hello in one short sentence." }],
  });
  if (!res.text || res.text.trim().length === 0) fail("plain chat returned empty text", JSON.stringify(res));
  if (res.toolCalls.length !== 0) console.warn("  note: plain chat returned toolCalls (unexpected but non-fatal)");
  console.log(`       text: ${res.text.slice(0, 120)}`);
});

// 2. Tool calling (grammar-constrained)
await check("[2/3] Tool calling (grammar)", async () => {
  const body = localLlamaSpec.toRequestBody({
    systemPrompt: "", messages: [{ role: "user", content: "Read src/providers/catalog.ts" }], model,
    tools: [{ name: "file.read", description: "Read a file", input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }],
  });
  if (!body.response_format || body.response_format.type !== "json_schema") fail("tool calling must set response_format json_schema", JSON.stringify(body.response_format));
  const schema = body.response_format.json_schema.schema;
  if (!schema.properties?.name?.enum?.includes("file.read")) fail("tool schema missing file.read enum", JSON.stringify(schema));

  const provider = new LocalLlamaProvider({ model, baseUrl });
  const res = await provider.complete({
    systemPrompt: "",
    messages: [{ role: "user", content: "Use file.read to read src/providers/catalog.ts" }],
    tools: [{ name: "file.read", description: "Read a file", input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }],
  });
  // Bespoke scheme: either text or tool call; tool call is the expected path for this prompt
  if (res.toolCalls.length === 0 && (!res.text || res.text.length === 0)) fail("tool calling returned neither text nor toolCalls", JSON.stringify(res));
  if (res.toolCalls.length > 0) {
    if (res.toolCalls[0].name !== "file.read") fail(`expected file.read, got ${res.toolCalls[0].name}`, JSON.stringify(res.toolCalls));
    console.log(`       tool: ${res.toolCalls[0].name} ${JSON.stringify(res.toolCalls[0].args).slice(0, 100)}`);
  } else {
    console.log(`       text (no tool): ${res.text.slice(0, 120)}`);
  }
});

// 3. Structured output passthrough
await check("[3/3] Structured output (response_format)", async () => {
  const schemaProps = { greeting: { type: "string", description: "A greeting" } };
  const body = localLlamaSpec.toRequestBody({
    systemPrompt: "", messages: [{ role: "user", content: "Return JSON with a greeting." }], model,
    structuredOutputSchema: { name: "greeting_schema", properties: schemaProps, required: ["greeting"] },
  });
  if (!body.response_format || body.response_format.json_schema.name !== "greeting_schema") fail("structured output must passthrough name", JSON.stringify(body.response_format));
  if (JSON.stringify(body.response_format.json_schema.schema.properties) !== JSON.stringify(schemaProps)) fail("structured output properties not passed through");

  const provider = new LocalLlamaProvider({ model, baseUrl });
  const res = await provider.complete({
    systemPrompt: "",
    messages: [{ role: "user", content: "Return JSON with greeting='hello'." }],
    structuredOutputSchema: { name: "greeting_schema", properties: schemaProps, required: ["greeting"] },
  });
  let parsed;
  try { parsed = JSON.parse(res.text); } catch { fail("structured output did not return valid JSON", res.text); }
  if (!parsed.greeting) fail("structured output missing required field greeting", JSON.stringify(parsed));
  console.log(`       json: ${JSON.stringify(parsed).slice(0, 120)}`);
});

console.log("\nAll checks passed.");
NODE

echo ""
