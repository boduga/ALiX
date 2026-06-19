/**
 * P5.1e — AgentCardApplier.
 *
 * Applies an approved AdaptationProposal whose action targets an agent card:
 *   - `create_agent_card`  → write proposal.payload to <cardsDir>/<id>.json
 *   - `update_agent_card`  → read existing, deep-merge payload, write back
 *   - `add_capability`     → read existing, append capability, write back
 *
 * Invariant: the proposal MUST be in `"approved"` status. Other statuses throw.
 * This applier does NOT record evidence or update proposal status — the
 * ApprovalGate (P5.1d) is the single point that wraps applier calls with
 * evidence recording and status transitions. This module is intentionally
 * side-effect-minimal: it just writes the card file.
 *
 * The agent id is taken from `proposal.target.id` (when `target.kind` is
 * `"agent_card"`) — this is the source of truth for the filename, not
 * `proposal.payload.id`. Using the target id keeps the applier consistent
 * with the rest of the registry which keys on agent id.
 *
 * @module
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateAgentCard, type AgentCard } from "../../registry/agent-card.js";
import type { AdaptationProposal, ProposalTarget } from "../adaptation-types.js";

/** Path to the agent card file for a given agent id. */
function cardPath(cardsDir: string, id: string): string {
  return join(cardsDir, `${id}.json`);
}

/** Extract the agent id from a `ProposalTarget`. Throws if the target isn't an agent card. */
function agentIdFromTarget(target: ProposalTarget): string {
  if (target.kind !== "agent_card") {
    throw new Error(
      `AgentCardApplier requires target.kind="agent_card", got "${target.kind}"`,
    );
  }
  if (!target.id || typeof target.id !== "string") {
    throw new Error("AgentCardApplier requires target.id to be a non-empty string");
  }
  return target.id;
}

/** Read a JSON file and parse it. Throws with a helpful message if missing. */
function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    throw new Error(`Agent card not found: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

/** Recursively merge `patch` into `base` and return a new object. */
function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const existing = result[key];
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      existing !== null &&
      typeof existing === "object" &&
      !Array.isArray(existing)
    ) {
      result[key] = deepMerge(existing as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export class AgentCardApplier {
  constructor(private readonly cardsDir: string) {}

  /**
   * Apply an approved proposal. Validates status, then dispatches to the
   * correct handler by `proposal.action`. Throws for unsupported actions.
   */
  async apply(proposal: AdaptationProposal): Promise<void> {
    if (proposal.status !== "approved") {
      throw new Error(
        `AgentCardApplier: proposal status is "${proposal.status}", expected "approved"`,
      );
    }

    const agentId = agentIdFromTarget(proposal.target);
    const path = cardPath(this.cardsDir, agentId);

    switch (proposal.action) {
      case "create_agent_card":
        this.create(path, proposal.payload);
        return;
      case "update_agent_card":
        this.update(path, proposal.payload);
        return;
      case "add_capability":
        this.addCapability(path, proposal.payload);
        return;
      default:
        throw new Error(
          `AgentCardApplier: unsupported action "${proposal.action}"`,
        );
    }
  }

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  /**
   * Create a new agent card. Fails if the file already exists or if the
   * payload is not a valid AgentCard (validated before writing, matching the
   * registry's "cards are validated before registration" contract).
   */
  private create(path: string, payload: Record<string, unknown>): void {
    if (existsSync(path)) {
      throw new Error(`Agent card already exists: ${path}`);
    }
    const result = validateAgentCard(payload as unknown as AgentCard);
    if (!result.valid) {
      throw new Error(
        `AgentCardApplier.create_agent_card: invalid payload — ${result.errors.join("; ")}`,
      );
    }
    this.writeCard(path, payload);
  }

  /** Read an existing card, deep-merge `payload` into it, write back. */
  private update(path: string, payload: Record<string, unknown>): void {
    const existing = readJson(path);
    const merged = deepMerge(existing, payload);
    this.writeCard(path, merged);
  }

  /** Append a capability to an existing card's capabilities array. */
  private addCapability(path: string, payload: Record<string, unknown>): void {
    const capability = payload.capability;
    if (typeof capability !== "string" || capability.length === 0) {
      throw new Error(
        'AgentCardApplier.add_capability: payload must include a non-empty "capability" string',
      );
    }
    const existing = readJson(path);
    const capabilities = Array.isArray(existing.capabilities)
      ? [...(existing.capabilities as unknown[]), capability]
      : [capability];
    const merged = { ...existing, capabilities };
    this.writeCard(path, merged);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Ensure the cards directory exists, then write the card as pretty JSON. */
  private writeCard(path: string, card: Record<string, unknown>): void {
    if (!existsSync(this.cardsDir)) {
      mkdirSync(this.cardsDir, { recursive: true });
    }
    writeFileSync(path, JSON.stringify(card, null, 2), "utf-8");
  }
}
