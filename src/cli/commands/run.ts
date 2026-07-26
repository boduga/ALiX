import { homedir } from "node:os";
import { join } from "node:path";
import { EXIT_CODES } from "../../run.js";
import { createAgentSession, type AgentTurnResult } from "../../agent/session.js";
import { ApiError } from "../../providers/base.js";
import { parseRunArgs } from "../run-args.js";

export async function handler(args: string[]): Promise<number> {
  const { task, noStream, noPlan, sessionMode, resumeSessionId, planFilePath, intent: intentFlag, propose: proposeFlag, readOnly, chat } = parseRunArgs(args);

  if (!task && !resumeSessionId && !chat) {
    console.error("Usage: alix run \"<task>\" [--no-stream] [--no-plan] [--mode=auto|ask|bypass] [--resume <session-id>] [--plan-file <path>] [--intent] [--propose]");
    return 1;
  }

  // Skill route detection (best-effort): check if input matches an installed skill
  let matchedSkillId: string | undefined;
  if (task) {
    try {
      const skillsHome = join(homedir(), ".alix", "skills");
      const { loadSkillManifests } = await import("../../skills/loader.js");
      const { buildSkillCatalog } = await import("../../skills/catalog.js");
      const manifests = await loadSkillManifests(skillsHome);
      const catalog = buildSkillCatalog(manifests);
      const matched = catalog.match(task);
      if (matched.length > 0) {
        matchedSkillId = matched[0].manifest.name;
      }
    } catch {
      // Skill detection is best-effort; fall through to runTask
    }
  }

  try {
    const { createReplRenderer, createReplEvents } = await import("../renderers/repl.js");
    const { JsonlSessionStore } = await import("../../agent/session-store-jsonl.js");
    let result: AgentTurnResult | undefined;
    let session: ReturnType<typeof createAgentSession>;
    if (chat) {
      // Wire a streaming events subscription into both the session and the
      // renderer (spec 13) so the REPL renders tokens/tool calls as they
      // arrive instead of waiting for the final summary.
      const events = createReplEvents();
      const sessionsRoot = join(process.cwd(), ".alix", "sessions");
      const store = new JsonlSessionStore(sessionsRoot);
      session = createAgentSession({ cwd: process.cwd(), task, sessionMode, readOnly, streaming: noStream ? false : undefined, planMode: noPlan ? false : undefined, resumeSessionId, planFilePath, events, store });
      const renderer = createReplRenderer(session, { events, store });
      await renderer.start();
    } else {
      session = createAgentSession({ cwd: process.cwd(), task, sessionMode, readOnly, streaming: noStream ? false : undefined, planMode: noPlan ? false : undefined, resumeSessionId, planFilePath });
      result = await session.processTurn(task);
      if (!result.streamed) {
        console.log(result.summary);
      }
      if (result.sessionId) {
        console.log(`Session: ${result.sessionId}`);
      }
    }

    // --intent / --propose: capture execution as an ExecutionIntent artifact
    // --propose is a superset of --intent: it also maps the intent to a proposal
    if (result && (intentFlag || proposeFlag)) {
      const { IntentStore } = await import("../../adaptation/intent-store.js");
      const intentDir = join(homedir(), ".alix", "execution", "intents");
      const store = new IntentStore(intentDir);

      const outputSummary = result.summary.slice(0, 200);
      const source = matchedSkillId ? "skill_run" as const : "cli_run" as const;

      const intent: Record<string, unknown> = {
        source,
        input: task,
        outputSummary,
        status: "captured" as const,
        confidence: 1,
        rationale: matchedSkillId
          ? `Skill run: ${matchedSkillId} via alix run`
          : "Task executed via alix run",
        sourceArtifacts: [
          { type: "context" as const, id: `session:${result.sessionId}` },
        ],
        subject: matchedSkillId ? `Skill run: ${matchedSkillId}` : `Task: ${task.slice(0, 80)}`,
        outcome: "captured",
        reasons: matchedSkillId
          ? [`Skill "${matchedSkillId}" executed via alix run`]
          : [`Task executed via alix run`],
      };

      if (matchedSkillId) {
        intent.skillId = matchedSkillId;
      }

      // --propose: attach proposedAction + proposedTarget for proposal mapping
      if (proposeFlag) {
        if (matchedSkillId) {
          intent.proposedAction = "adjust_skill_definition";
          intent.proposedTarget = { kind: "skill", id: matchedSkillId };
        }
        // For generic tasks without a skill match, proposedAction/target are
        // intentionally left unset — the mapper will report the error and we
        // suggest --intent as the alternative.
      }

      await store.append(intent as any);

      // Terminal output — intent captured
      console.log(`\nIntent captured: ${(intent as any).id || "(id pending)"}`);
      console.log(`  Source:  ${source}${matchedSkillId ? ` (${matchedSkillId})` : ""}`);
      console.log(`  Status:  captured`);
      console.log(`  Summary: ${outputSummary.slice(0, 80)}${outputSummary.length > 80 ? "..." : ""}`);

      // --propose: map intent to proposal
      if (proposeFlag) {
        if (!intent.proposedAction || !intent.proposedTarget) {
          console.error(`\n  Cannot create proposal: this task has no proposedAction or proposedTarget.`);
          console.error(`  Use --intent instead of --propose for generic task capture.`);
          console.error(`  For skill-matched runs, --propose works automatically.`);
        } else {
          const { ProposalStore } = await import("../../adaptation/proposal-store.js");
          const { IntentProposalMapper } = await import("../../adaptation/intent-proposal-mapper.js");

          const proposalsDir = join(process.cwd(), ".alix", "adaptation", "proposals");
          const proposalStore = new ProposalStore(proposalsDir);
          const mapper = new IntentProposalMapper(proposalStore);

          const mappingResult = await mapper.mapToProposal(intent as any, store);

          if (!mappingResult.success) {
            console.error(`\n  Proposal mapping failed: ${mappingResult.errors.join("; ")}`);
          } else {
            console.log(`\n  Proposal created: ${mappingResult.proposal!.id}`);
            console.log(`  Action: ${intent.proposedAction}`);
            console.log(`  Target: ${JSON.stringify(intent.proposedTarget)}`);
            console.log();
            console.log(`  Use \`alix decision approve ${mappingResult.proposal!.id}\` and \`alix decision apply ${mappingResult.proposal!.id}\` to execute.`);
          }
        }
      }
    }

    if (result?.reason === "rejected_scope_expansion") {
      return EXIT_CODES.REJECTED_SCOPE_EXPANSION;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof ApiError) {
      if (msg.includes("credit balance") || msg.includes("upgrade")) {
        console.error(`\n⚠️  API: Insufficient credits.\n    ${err.detail}\n\nFix: Add credits or switch providers:\n     alix config set-default-model openai gpt-4o`);
      } else if (msg.includes("invalid_request_error") || err.status === 401) {
        console.error(`\n⚠️  API: Authentication failed.\n    ${err.detail}\n\nFix: Check your API key.`);
      } else {
        console.error(`\n⚠️  API error (${err.status}):\n    ${err.detail}`);
      }
    } else {
      console.error(`\n⚠️  ${msg}`);
    }
    return 1;
  }
  return 0;
}
