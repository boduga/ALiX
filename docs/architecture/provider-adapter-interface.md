# Provider Adapter Interface

## Purpose

Provider adapters normalize model APIs without pretending all models behave the same. ALiX should expose one internal interface while preserving provider-specific capability differences such as token limits, tool call formats, streaming formats, system prompt handling, multimodal input, and edit format reliability.

## Core Types

```ts
type ModelCapabilities = {
  provider: string;
  model: string;
  inputTokenLimit: number;
  outputTokenLimit: number;
  effectiveContextBudget?: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsStructuredOutput: boolean;
  supportsVision: boolean;
  costProfile?: CostProfile;
};

type CostProfile = {
  currency: "USD";
  tiers: Array<{
    upToInputTokens?: number;
    inputPerMToken: number;
    outputPerMToken: number;
  }>;
};

type ModelAdapter = {
  id: string;
  capabilities: ModelCapabilities;
  editFormatPreference: "structured_patch" | "unified_diff" | "search_replace" | "full_file";
  longContextStrategy: "expanded_context" | "trimmed_context";
  complete(request: NormalizedRequest): Promise<NormalizedResponse>;
  stream(request: NormalizedRequest): AsyncIterable<StreamChunk>;
};
```

## Normalized Request

```ts
type NormalizedRequest = {
  apiKey?: string;
  systemPrompt: string;
  messages: NormalizedMessage[];
  tools: NormalizedTool[];
  toolResults: NormalizedToolResult[];
  responseFormat?: ResponseFormat;
  temperature?: number;
  maxOutputTokens?: number;
  attachments?: NormalizedAttachment[];
};

type NormalizedMessage = {
  role: "user" | "assistant";
  content: Array<TextPart | ImagePart | FilePart>;
};

type NormalizedTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};
```

System prompt is separate from messages because providers differ in how system content is represented.

## Normalized Response

```ts
type NormalizedResponse = {
  text: string;
  toolCalls: ToolCall[];
  usage?: TokenUsage;
  finishReason?: string;
  rawRef?: string;
};

type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

type StreamChunk =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "usage"; usage: TokenUsage }
  | { type: "done"; finishReason?: string }
  | { type: "error"; error: string };
```

## Adapter Responsibilities

Each adapter must:

- Compile system prompt into the provider's correct field.
- Convert normalized messages into provider content.
- Convert normalized tool declarations into provider tool schema.
- Parse text and mixed tool-call responses.
- Parse streaming chunks into normalized stream events.
- Report token usage when available.
- Preserve a raw response artifact reference for debugging.
- Surface unsupported feature errors before request execution.

## Capability Negotiation

```ts
type NegotiatedCapabilities = {
  contextBudget: number;
  outputBudget: number;
  editFormat: "structured_patch" | "unified_diff" | "search_replace" | "full_file";
  toolsEnabled: boolean;
  structuredOutputEnabled: boolean;
  visionEnabled: boolean;
};
```

Negotiation inputs:

- Model capabilities.
- Task type.
- User config.
- Provider hints.
- Policy.
- Patch engine constraints.

Rules:

- Context budget must reserve output headroom.
- Edit format preference cannot bypass patch safety policy.
- Vision is enabled only if task input includes images or screenshot debugging.
- Structured output is used for plans and verification reports when supported.

## Provider Profiles

### Anthropic

Expected strengths:

- Strong coding-agent behavior.
- Strong instruction following.
- Good fit for structured patch or diff workflows after validation.

Adapter concerns:

- Preserve tool-use IDs if provided.
- Keep system content in the provider-specific system field.
- Test actual edit format reliability before setting default to `structured_patch`.

### OpenAI

Expected strengths:

- Tool calling.
- Structured outputs.
- Strong fit for patch-oriented coding loops.

Adapter concerns:

- Normalize tool calls and streaming deltas.
- Use structured output where useful for plans and verifier reports.
- Keep provider-specific built-in tools separate from ALiX tools.

### Google Gemini

Expected strengths:

- Very large context.
- Multimodal input.
- Exploration, explanation, review, and screenshot debugging.

Adapter concerns:

- Use `@google/genai` for new JS/TS implementation.
- System instructions are top-level config, not normal turns.
- Streaming chunks are `GenerateContentResponse` objects with parts.
- Responses can mix text and function calls in the same content parts.
- Default edit format is `search_replace`; large context does not permit unsafe rewrites.

### OpenRouter

Expected strengths:

- Access to many hosted models behind one API.

Adapter concerns:

- Capabilities vary by selected upstream model.
- Capability metadata should be configured per model, not assumed from provider.
- Cost tracking requires model-specific pricing metadata.

### Ollama / Local

Expected strengths:

- Local execution and privacy.
- Useful for simple exploration, summarization, and low-risk tasks.

Adapter concerns:

- Tool calling may be unavailable or inconsistent.
- Default to text-mediated tool requests if native tools are absent.
- Default edit format is `search_replace`.
- Keep context budgets conservative unless model metadata is known.

## MVP Acceptance Tests

- A normalized request with system prompt compiles correctly for two providers.
- A response with mixed text and tool calls normalizes into both text and tool calls.
- A streaming response emits ordered `text_delta` chunks.
- Unsupported vision input fails before provider request when `supportsVision` is false.
- Gemini negotiation selects expanded context and `search_replace`.
- Local provider negotiation selects trimmed context and `search_replace`.
