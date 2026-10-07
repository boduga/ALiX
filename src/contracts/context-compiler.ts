// src/contracts/context-compiler.ts
//
// R1 boundary freeze — ContextCompiler.
// Provenance-aware outbound context. Redaction before remote
// inference is enforced by implementers; this port makes the
// redaction claim explicit rather than silent.

export interface ContextProvenance {
  source: string;
  redacted: boolean;
  at: string;
}

export interface OutboundContext {
  content: string;
  provenance: ContextProvenance[];
  redacted: boolean;
}

export interface ContextCompiler {
  compile(input: unknown): Promise<OutboundContext>;
}
