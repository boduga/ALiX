import type { BridgeEnvelope } from "./bridge-envelope.js";
import { buildBridgeEnvelope } from "./bridge-envelope.js";
import type { SignalFrame } from "./signal-frame.js";
import type { OfferingPlan } from "./offering-planner.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type BridgeValidationResult = {
  valid: boolean;
  errors: string[];
};

export type BridgeMessage = {
  envelope: BridgeEnvelope;
  payload: unknown;
};

/* ------------------------------------------------------------------ */
/*  Valid value sets                                                   */
/* ------------------------------------------------------------------ */

const VALID_DOMAINS: readonly string[] = [
  "task", "tool", "policy", "memory", "research",
  "replay", "rollback", "workspace", "agent", "tui",
  "daemon", "chronicle",
];

const VALID_POLARITIES: readonly string[] = [
  "ire", "ibi", "mixed", "neutral",
];

const VALID_ACTIONS: readonly string[] = [
  "ask_approval", "run_policy_check", "fetch_memory", "run_test",
  "replay_preview", "rollback_preview", "pause", "proceed",
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

/* ------------------------------------------------------------------ */
/*  BridgeGateway                                                      */
/* ------------------------------------------------------------------ */

export class BridgeGateway {
  /**
   * Validate a `BridgeEnvelope` against all structural rules.
   *
   * Returns all discovered errors in a single pass (no short-circuiting).
   * If the envelope itself is null or undefined the check returns immediately
   * with a single error since no further validation is possible.
   */
  validateEnvelope(envelope: BridgeEnvelope): BridgeValidationResult {
    const errors: string[] = [];

    if (envelope == null) {
      return { valid: false, errors: ["envelope is null or undefined"] };
    }

    /* 1. envelopeId — non-empty string */
    if (!isNonEmptyString(envelope.envelopeId)) {
      errors.push("envelopeId must be a non-empty string");
    }

    /* 2. signal — required with sub-fields */
    if (envelope.signal == null) {
      errors.push("signal is missing or null");
    } else {
      const s = envelope.signal;

      if (!isNonEmptyString(s.signalId)) {
        errors.push("signal.signalId must be a non-empty string");
      }

      if (typeof s.code !== "string" || !/^[01]{8}$/.test(s.code)) {
        errors.push("signal.code must be an 8-character binary string");
      }

      if (!VALID_DOMAINS.includes(s.domain as string)) {
        errors.push(
          `signal.domain must be a valid SignalDomain (received "${String(s.domain)}")`,
        );
      }

      if (!VALID_POLARITIES.includes(s.polarity as string)) {
        errors.push(
          `signal.polarity must be one of: ire, ibi, mixed, neutral (received "${String(s.polarity)}")`,
        );
      }

      if (!isNonEmptyString(s.createdAt)) {
        errors.push("signal.createdAt must be a non-empty string");
      }
    }

    /* 3. offering — required with sub-fields */
    if (envelope.offering == null) {
      errors.push("offering is missing or null");
    } else {
      const o = envelope.offering;

      if (!isNonEmptyString(o.offeringId)) {
        errors.push("offering.offeringId must be a non-empty string");
      }

      if (!isNonEmptyString(o.signalId)) {
        errors.push("offering.signalId must be a non-empty string");
      }

      if (!VALID_ACTIONS.includes(o.action as string)) {
        errors.push(
          `offering.action must be a valid OfferingAction (received "${String(o.action)}")`,
        );
      }

      if (!isNonEmptyString(o.createdAt)) {
        errors.push("offering.createdAt must be a non-empty string");
      }

      if (!isArray(o.requiredEvidence)) {
        errors.push("offering.requiredEvidence must be an array");
      }

      if (!isArray(o.successCriteria)) {
        errors.push("offering.successCriteria must be an array");
      }

      if (!isArray(o.constraints)) {
        errors.push("offering.constraints must be an array");
      }

      if (!isArray(o.taboos)) {
        errors.push("offering.taboos must be an array");
      }
    }

    /* 4. safety — required with sub-fields */
    if (envelope.safety == null) {
      errors.push("safety is missing or null");
    } else {
      const sf = envelope.safety;

      if (!isBoolean(sf.requiresPolicyGate)) {
        errors.push("safety.requiresPolicyGate must be a boolean");
      }

      if (!isBoolean(sf.requiresApproval)) {
        errors.push("safety.requiresApproval must be a boolean");
      }

      if (!isBoolean(sf.mutationPossible)) {
        errors.push("safety.mutationPossible must be a boolean");
      }

      if (!isArray(sf.taboos)) {
        errors.push("safety.taboos must be an array");
      }
    }

    /* 5. chronicleRefs — must be array (allow empty) */
    if (!isArray(envelope.chronicleRefs)) {
      errors.push("chronicleRefs must be an array");
    }

    /* 6. createdAt — non-empty string */
    if (!isNonEmptyString(envelope.createdAt)) {
      errors.push("createdAt must be a non-empty string");
    }

    return errors.length === 0
      ? { valid: true, errors: [] }
      : { valid: false, errors };
  }

  /**
   * Factory method: wraps a SignalFrame, OfferingPlan, and opaque payload
   * into a BridgeMessage by first building a BridgeEnvelope via
   * `buildBridgeEnvelope`, then pairing it with the payload.
   */
  wrapMessage(input: {
    signal: SignalFrame;
    offering: OfferingPlan;
    payload: unknown;
  }): BridgeMessage {
    const envelope = buildBridgeEnvelope({
      signal: input.signal,
      offering: input.offering,
    });

    return { envelope, payload: input.payload };
  }

  /**
   * Destructure a BridgeMessage back into its constituent parts.
   */
  unwrapMessage(message: BridgeMessage): {
    signal: SignalFrame;
    offering: OfferingPlan;
    payload: unknown;
  } {
    if (message?.envelope == null || message?.envelope.signal == null || message?.envelope.offering == null) {
      throw new Error("Cannot unwrap a malformed or null BridgeMessage");
    }
    return {
      signal: message.envelope.signal,
      offering: message.envelope.offering,
      payload: message.payload,
    };
  }
}
