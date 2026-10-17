#!/usr/bin/env node
/**
 * SRAP-G3-ACCEPT fixture — deterministic, offline, tool-capable model server.
 *
 * The acceptance fixture must reach a *genuine* approval-gated worker without
 * network access, provider credentials, or non-determinism. `local-llama` is
 * the keyless, OpenAI-compatible adapter (`src/models/providers/local-llama-
 * provider.ts`); pointed at this server it satisfies `ensureLlamaServer`'s
 * `/v1/models` probe (so llama.cpp is NEVER spawned) and answers
 * `/v1/chat/completions` with a fixed response.
 *
 * Response selection is deterministic and request-driven:
 *   - request carries OpenAI-style `tools`            -> emit ONE `tool_calls[]` entry
 *   - request carries the local-llama grammar
 *     `response_format` (name "agent_response")       -> emit the grammar JSON envelope
 *                                                         `{"type":"tool","name":...,"arguments":{...}}`
 *   - otherwise                                       -> emit fixed plan text
 *
 * The local-llama adapter (`src/models/providers/specs/local-llama-spec.ts`)
 * does NOT send OpenAI-style `tools`; when tools are present it sets a
 * grammar-constrained `response_format` and parses a JSON envelope from
 * `content`. Both protocols are supported here so the fixture reaches a genuine
 * approval-gated tool call through the keyless `local-llama` path.
 *
 * The tool name/arguments are configurable so the exact coordination-fixture
 * action can be pinned without editing this file:
 *   SRAP_MOCK_TOOL_NAME   (default "alix_file_create")
 *   SRAP_MOCK_TOOL_ARGS   (JSON, default {"path":"srap-fixture-output.txt","content":"srap-d3\n"})
 *
 * This is inert fixture infrastructure: no product logic, never imported by
 * `src/**`.
 *
 * Env:
 *   SRAP_MOCK_MODEL_PORT   listen port (default 8080)
 *   SRAP_MOCK_MODEL_NAME   model id advertised (default "fixture-mock-model")
 */
import { createServer } from "node:http";

const HOST = "127.0.0.1";
const PORT = Number(process.env.SRAP_MOCK_MODEL_PORT ?? 8080);
const MODEL = process.env.SRAP_MOCK_MODEL_NAME ?? "fixture-mock-model";
const TOOL_NAME = process.env.SRAP_MOCK_TOOL_NAME ?? "alix_file_create";
const TOOL_ARGS = process.env.SRAP_MOCK_TOOL_ARGS ?? '{"path":"srap-fixture-output.txt","content":"srap-d3\\n"}';
const PLAN_TEXT =
  "Plan:\n1. Produce exactly one capability-gated action for the fixture goal.\n";

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

function buildMessage(body) {
  const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
  const rf = body.response_format;
  const grammarMode =
    !!rf && rf.type === "json_schema" && rf.json_schema && rf.json_schema.name === "agent_response";

  if (hasTools) {
    return {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_srap_fixture_1",
          type: "function",
          function: { name: TOOL_NAME, arguments: TOOL_ARGS },
        },
      ],
    };
  }

  if (grammarMode) {
    // local-llama grammar protocol: `content` is a JSON envelope the adapter
    // parses into toolCalls (see local-llama-spec.ts `fromResponse`).
    let args;
    try {
      args = JSON.parse(TOOL_ARGS);
    } catch {
      args = {};
    }
    return {
      role: "assistant",
      content: JSON.stringify({ type: "tool", name: TOOL_NAME, arguments: args }),
    };
  }

  return { role: "assistant", content: PLAN_TEXT };
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url?.split("?")[0] === "/v1/models") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: [{ id: MODEL, object: "model", owned_by: "srap-fixture" }] }));
    return;
  }

  if (req.method === "POST" && req.url?.split("?")[0] === "/v1/chat/completions") {
    const raw = await readBody(req);
    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {
      /* default */
    }
    const message = buildMessage(body);

    if (body.stream) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const chunk = {
        id: "chatcmpl-srap-fixture",
        object: "chat.completion.chunk",
        model: MODEL,
        choices: [{ index: 0, delta: message, finish_reason: "tool_calls" }],
      };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    res.writeHead(200, { "content-type": "application/json" });
    const emitsTool =
      !!message.tool_calls ||
      (typeof message.content === "string" && message.content.includes('"type":"tool"'));
    res.end(
      JSON.stringify({
        id: "chatcmpl-srap-fixture",
        object: "chat.completion",
        model: MODEL,
        choices: [{ index: 0, message, finish_reason: emitsTool ? "tool_calls" : "stop" }],
      }),
    );
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { message: "not found" } }));
});

server.listen(PORT, HOST, () => {
  const addr = server.address();
  console.log(
    JSON.stringify({
      role: "srap-accept-mock-model",
      listening: `${addr.address}:${addr.port}`,
      model: MODEL,
      toolName: TOOL_NAME,
    }),
  );
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
