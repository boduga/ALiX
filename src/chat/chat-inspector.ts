/**
 * P7.6d — Chat State Inspector.
 *
 * Read-only handlers that inspect ALiX state (proposals, skills, outcomes,
 * intents) and return human-readable summaries.  Designed for use by the
 * chat REPL `/proposals`, `/skills`, `/outcomes`, and `/intents` commands,
 * and reusable by future `alix ask` commands.
 *
 * Each function delegates to the same stores that the CLI uses — no
 * reimplementation of formatting or query logic.
 *
 * @module
 */

import { join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// inspectProposals
// ---------------------------------------------------------------------------

/**
 * Return a human-readable summary of all proposals in the proposal store.
 *
 * Proposals are read from `<cwd>/.alix/adaptation/proposals` by default.
 * Pass `proposalsDir` to override the directory path (useful in tests).
 */
export async function inspectProposals(proposalsDir?: string): Promise<string> {
  try {
    const { ProposalStore } = await import("../adaptation/proposal-store.js");
    const dir = proposalsDir ?? join(process.cwd(), ".alix", "adaptation", "proposals");
    const store = new ProposalStore(dir);
    const all = await store.list();
    if (all.length === 0) return "No proposals found.";
    return all
      .map((p) => `${p.id} [${p.status}] ${p.reason ? p.reason.slice(0, 120) : "(no reason)"}`)
      .join("\n");
  } catch (err) {
    return `Error reading proposals: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ---------------------------------------------------------------------------
// inspectSkills
// ---------------------------------------------------------------------------

/**
 * Return a human-readable summary of installed skill extensions.
 *
 * Skills are read from `~/.alix/extensions` by default.
 * Pass `skillsHome` to override the registry directory (useful in tests).
 */
export async function inspectSkills(skillsHome?: string): Promise<string> {
  try {
    const { ExtensionRegistry } = await import("../extensions/registry.js");
    const dir = skillsHome ?? join(homedir(), ".alix", "extensions");
    const registry = new ExtensionRegistry(dir);
    const skills = registry.list({ type: "skill" });
    if (skills.length === 0) return "No skills installed.";
    return skills
      .map((s) => {
        const m = s.manifest;
        const trigger = "trigger" in m && m.trigger ? ` [${m.trigger as string}]` : "";
        const desc = m.description ? m.description.slice(0, 80) : "(no description)";
        return `${m.name} v${m.version}${trigger} — ${desc}`;
      })
      .join("\n");
  } catch (err) {
    return `Error reading skills: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ---------------------------------------------------------------------------
// inspectOutcomes
// ---------------------------------------------------------------------------

/**
 * Return a human-readable summary of the most recent 10 outcome records.
 *
 * Outcomes are read from `<cwd>/.alix/adaptation/outcomes` by default.
 * Pass `outcomeDir` to override the store directory (useful in tests).
 */
export async function inspectOutcomes(outcomeDir?: string): Promise<string> {
  try {
    const { OutcomeStore } = await import("../adaptation/outcome-store.js");
    const dir = outcomeDir ?? join(process.cwd(), ".alix", "adaptation", "outcomes");
    const store = new OutcomeStore(dir);
    const all = await store.list();
    if (all.length === 0) return "No outcomes recorded.";
    const recent = all.slice(-10);
    return recent
      .map((o) => `${o.id} [${o.outcome}] ${o.actionTaken ? o.actionTaken.slice(0, 120) : "(no action)"}`)
      .join("\n");
  } catch (err) {
    return `Error reading outcomes: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ---------------------------------------------------------------------------
// inspectIntents
// ---------------------------------------------------------------------------

/**
 * Return a human-readable summary of all captured execution intents.
 *
 * Intents are read from `~/.alix/execution/intents` by default.
 * Pass `intentDir` to override the store directory (useful in tests).
 */
export async function inspectIntents(intentDir?: string): Promise<string> {
  try {
    const { IntentStore } = await import("../adaptation/intent-store.js");
    const dir = intentDir ?? join(homedir(), ".alix", "execution", "intents");
    const store = new IntentStore(dir);
    const all = await store.list();
    if (all.length === 0) return "No intents found.";
    return all
      .map((i) => `${i.id} [${i.status}] ${i.rationale ? i.rationale.slice(0, 120) : "(no rationale)"}`)
      .join("\n");
  } catch (err) {
    return `Error reading intents: ${err instanceof Error ? err.message : String(err)}`;
  }
}
