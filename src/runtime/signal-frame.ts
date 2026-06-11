import { randomUUID } from "node:crypto";

/**
 * Polarity of a signal — whether it represents a blessed/safe, taboo/dangerous,
 * mixed, or neutral state.
 */
export type SignalPolarity = "ire" | "ibi" | "mixed" | "neutral";

/**
 * Domain the signal belongs to.
 */
export type SignalDomain =
  | "task" | "tool" | "policy" | "memory" | "research"
  | "replay" | "rollback" | "workspace" | "agent" | "tui"
  | "daemon" | "chronicle";

/**
 * Eight boolean fields representing the bits of an 8-bit signal.
 * Bit order follows field declaration order (intentClear = bit 0,
 * replayRollbackContext = bit 7).
 */
export type SignalBits = {
  intentClear: boolean;
  policyRisk: boolean;
  toolRequired: boolean;
  memoryRequired: boolean;
  freshnessRequired: boolean;
  mutationPossible: boolean;
  approvalRequired: boolean;
  replayRollbackContext: boolean;
};

/**
 * A complete signal frame with metadata.
 */
export type SignalFrame = {
  signalId: string;
  code: string;
  polarity: SignalPolarity;
  domain: SignalDomain;
  intent: string;
  cause?: string;
  constraints: string[];
  taboos: string[];
  evidenceRefs: string[];
  traceId?: string;
  replayId?: string;
  rollbackId?: string;
  createdAt: string;
};

/* ------------------------------------------------------------------ */
/*  Bit encoding / decoding                                            */
/* ------------------------------------------------------------------ */

/**
 * Convert the 8 boolean fields of `bits` into an 8-character string
 * of '0' and '1'.  Bit order follows the field declaration order
 * (intentClear = bit 0, replayRollbackContext = bit 7).
 */
export function encodeSignalBits(bits: SignalBits): string {
  const b = bits;
  return [
    b.intentClear,
    b.policyRisk,
    b.toolRequired,
    b.memoryRequired,
    b.freshnessRequired,
    b.mutationPossible,
    b.approvalRequired,
    b.replayRollbackContext,
  ]
    .map((v) => (v ? "1" : "0"))
    .join("");
}

/**
 * Reverse {@link encodeSignalBits} — turn an 8-character '0'/'1' string
 * back into a `SignalBits` object.  Any character that is not '1' is
 * treated as '0'.
 */
export function decodeSignalCode(code: string): SignalBits {
  // Normalise to exactly 8 characters, padding with '0' if shorter.
  const padded = code.padEnd(8, "0").slice(0, 8);

  const bit = (i: number): boolean => padded[i] === "1";

  return {
    intentClear: bit(0),
    policyRisk: bit(1),
    toolRequired: bit(2),
    memoryRequired: bit(3),
    freshnessRequired: bit(4),
    mutationPossible: bit(5),
    approvalRequired: bit(6),
    replayRollbackContext: bit(7),
  };
}

/* ------------------------------------------------------------------ */
/*  Polarity inference                                                 */
/* ------------------------------------------------------------------ */

/**
 * Determine the polarity of the signal based on the bits.
 *
 * - All three of policyRisk, mutationPossible, approvalRequired → "ibi"
 * - All eight bits false → "neutral"
 * - Any of policyRisk, mutationPossible, approvalRequired true → "mixed"
 * - Otherwise → "ire"
 */
export function inferSignalPolarity(bits: SignalBits): SignalPolarity {
  const allFalse =
    !bits.intentClear &&
    !bits.policyRisk &&
    !bits.toolRequired &&
    !bits.memoryRequired &&
    !bits.freshnessRequired &&
    !bits.mutationPossible &&
    !bits.approvalRequired &&
    !bits.replayRollbackContext;

  if (allFalse) return "neutral";

  if (
    bits.policyRisk &&
    bits.mutationPossible &&
    bits.approvalRequired
  ) {
    return "ibi";
  }

  if (bits.policyRisk || bits.mutationPossible || bits.approvalRequired) {
    return "mixed";
  }

  return "ire";
}

/* ------------------------------------------------------------------ */
/*  Defaults for constraints / taboos                                  */
/* ------------------------------------------------------------------ */

function defaultConstraints(polarity: SignalPolarity): string[] {
  const c: string[] = [];

  if (polarity === "ibi") {
    c.push("require_approval");
    c.push("require_policy_check");
  }

  if (polarity === "ire") {
    c.push("proceed_with_confidence");
  }

  return c;
}

/** Default taboos based on signal domain. */
function defaultTaboos(domain: SignalDomain): string[] {
  const t: string[] = [];

  if (domain === "replay" || domain === "rollback") {
    t.push("no_side_effects_without_approval");
  }

  if (domain === "chronicle" || domain === "research") {
    t.push("no_mutation");
  }

  return t;
}

/* ------------------------------------------------------------------ */
/*  Frame factory                                                      */
/* ------------------------------------------------------------------ */

/**
 * Create a complete `SignalFrame` with auto-generated id, timestamp,
 * code, polarity, and sensible defaults for constraints and taboos.
 */
export function createSignalFrame(input: {
  bits: SignalBits;
  domain: SignalDomain;
  intent: string;
  cause?: string;
  evidenceRefs?: string[];
  traceId?: string;
  replayId?: string;
  rollbackId?: string;
}): SignalFrame {
  const code = encodeSignalBits(input.bits);
  const polarity = inferSignalPolarity(input.bits);

  return {
    signalId: randomUUID(),
    code,
    polarity,
    domain: input.domain,
    intent: input.intent,
    cause: input.cause,
    constraints: defaultConstraints(polarity),
    taboos: defaultTaboos(input.domain),
    evidenceRefs: input.evidenceRefs ?? [],
    traceId: input.traceId,
    replayId: input.replayId,
    rollbackId: input.rollbackId,
    createdAt: new Date().toISOString(),
  };
}
