// src/contracts/index.ts
//
// Effect Schema runtime contracts for ALiX boundaries.
// Schema-only — no Effect runtime, no orchestration changes.
//
// Each domain has its own file; this barrel re-exports everything.

export * from "./tool-schemas.js";
export * from "./plan-schemas.js";
export * from "./proposal-schemas.js";
export * from "./llm-schemas.js";
export * from "./helpers.js";
export * from "./provider-tool-schemas.js";

// R1 boundary-freeze ports — authority boundaries, types only.
export * from "./runtime-fact-port.js";
export * from "./runtime-state-reader.js";
export * from "./authorized-execution-port.js";
export * from "./approval-decision-port.js";
export * from "./ownership-authority.js";
export * from "./agent-lifecycle-port.js";
export * from "./model-resolver.js";
export * from "./context-compiler.js";
export * from "./tool-capability-registry.js";
export * from "./metrics-sink.js";
