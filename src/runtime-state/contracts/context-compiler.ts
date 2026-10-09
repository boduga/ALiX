// src/runtime-state/contracts/context-compiler.ts
//
// R1 boundary freeze — OutboundContextCompiler.
// Provenance-aware outbound context. Redaction before remote
// inference is enforced by implementers; this port makes the
// redaction claim explicit rather than silent.
//
// Named `OutboundContextCompiler` (not `ContextCompiler`) to avoid colliding
// with the repo-context `ContextCompiler` class in `src/context/repomap/`.

export interface OutboundProvenance {
  source: string;
  redacted: boolean;
  at: string;
}

export interface OutboundContext {
  content: string;
  provenance: OutboundProvenance[];
  redacted: boolean;
}

export interface OutboundContextCompiler {
  compile(input: unknown): Promise<OutboundContext>;
}
