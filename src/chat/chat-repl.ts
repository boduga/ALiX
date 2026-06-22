import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { ChatSessionStore } from "./chat-session-store.js";
import type { ChatMessage } from "./chat-types.js";
import { routeMessage } from "./chat-intent-router.js";
import { handleRunSkill, handleCreateIntent, handleProposeIntent } from "./chat-skill-bridge.js";
import { inspectProposals, inspectSkills, inspectOutcomes, inspectIntents } from "./chat-inspector.js";

export interface ReplOptions {
  sessionId?: string;
  jsonMode?: boolean;
  /** If true, skip the readline loop — used for testing. */
  dryRun?: boolean;
}

export function startRepl(store: ChatSessionStore, opts: ReplOptions = {}): () => void {
  let closed = false;

  const run = async () => {
    // Load or create session
    let sessionId = opts.sessionId;
    if (sessionId) {
      const existing = await store.load(sessionId);
      if (!existing) {
        console.error(`Session ${sessionId} not found. Starting new session.`);
        const created = await store.create();
        sessionId = created.id;
      }
    } else {
      const created = await store.create();
      sessionId = created.id;
    }

    const session = await store.load(sessionId!);
    if (!session) return;

    // Print header
    if (!opts.jsonMode) {
      console.log(`\n  ╔══════════════════════════════════════╗`);
      console.log(`  ║  ALiX Chat  —  ${sessionId!}  ║`);
      console.log(`  ╠══════════════════════════════════════╣`);
      console.log(`  ║  /help    — show commands            ║`);
      console.log(`  ║  /quit    — exit chat                ║`);
      console.log(`  ╚══════════════════════════════════════╝\n`);
      if (session.messages.length > 0) {
        console.log(`  (resuming session with ${session.messages.length} previous messages)\n`);
      }
    }

    if (opts.dryRun) return;

    const rl = createInterface({ input, output, prompt: "> " });
    rl.prompt();

    for await (const line of rl) {
      const trimmed = line.trim();
      if (closed) break;

      if (!trimmed) { rl.prompt(); continue; }

      if (trimmed === "/quit" || trimmed === "/exit") break;
      if (trimmed === "/help") {
        const help = [
          "  /help                          — show this message",
          "  /quit                          — exit chat",
          "",
          "  /proposals                     — show pending proposals",
          "  /skills                        — list installed skills",
          "  /intents                       — list captured intents",
          "  /outcomes                      — recent outcomes",
          "",
          "  /run-skill <id> <input>       — run a skill",
          "  /intent <description>          — create an execution intent",
          "  /propose <intent-id>           — map intent to proposal",
          "",
          "  Anything else is answered directly.",
        ].join("\n");
        if (opts.jsonMode) {
          console.log(JSON.stringify({ type: "help", commands: help }));
        } else {
          console.log(help);
        }
        rl.prompt();
        continue;
      }

      // Store user message
      const userMsg: ChatMessage = {
        id: `msg_${Date.now()}`,
        role: "user",
        content: trimmed,
        createdAt: new Date().toISOString(),
      };
      await store.appendMessage(sessionId!, userMsg);

      // Route and respond
      let response = "";
      if (trimmed.startsWith("/")) {
        if (trimmed === "/proposals") {
          response = await inspectProposals();
        } else if (trimmed === "/skills") {
          response = await inspectSkills();
        } else if (trimmed === "/outcomes") {
          response = await inspectOutcomes();
        } else if (trimmed === "/intents") {
          response = await inspectIntents();
        } else if (trimmed.startsWith("/run-skill ")) {
          const args = trimmed.slice("/run-skill ".length).trim().split(/\s+/);
          const skillId = args[0];
          const skillInput = args.slice(1).join(" ");
          if (!skillId) {
            response = "Usage: /run-skill <skill-id> [input]";
          } else {
            response = await handleRunSkill(skillId, skillInput);
          }
        } else if (trimmed.startsWith("/intent ")) {
          const description = trimmed.slice("/intent ".length).trim();
          if (!description) {
            response = "Usage: /intent <description>";
          } else {
            response = await handleCreateIntent(description, sessionId!);
          }
        } else if (trimmed.startsWith("/propose ")) {
          const intentId = trimmed.slice("/propose ".length).trim();
          if (!intentId) {
            response = "Usage: /propose <intent-id>";
          } else {
            response = await handleProposeIntent(intentId);
          }
        } else {
          response = `[${sessionId!}] Command received: ${trimmed}. Full routing coming in P7.6c-P7.6d.`;
        }
      } else {
        const decision = routeMessage(trimmed);
        userMsg.route = decision.route;
        userMsg.routeConfidence = decision.confidence;
        if (decision.route === "unknown" && decision.confidence < 0.7) {
          response = `Not sure what to do with that. Try /help to see available commands.`;
        } else {
          response = `[${decision.route}] (confidence: ${decision.confidence.toFixed(2)}) — routing coming in P7.6c/P7.6d.`;
        }
      }

      const assistantMsg: ChatMessage = {
        id: `msg_${Date.now() + 1}`,
        role: "assistant",
        content: response,
        createdAt: new Date().toISOString(),
      };

      // Populate generatedArtifacts from intent/proposal responses
      const intentMatch = response.match(/^Intent captured: (intent:[^\s.]+)/);
      if (intentMatch) {
        assistantMsg.generatedArtifacts = [{ type: "context" as const, id: intentMatch[1], timestamp: new Date().toISOString() }];
      }
      const proposalMatch = response.match(/^Proposal created: (prop-[^\s.]+)/);
      if (proposalMatch) {
        assistantMsg.generatedArtifacts = [{ type: "proposal" as const, id: proposalMatch[1], timestamp: new Date().toISOString() }];
      }

      await store.appendMessage(sessionId!, assistantMsg);

      if (opts.jsonMode) {
        console.log(JSON.stringify({ type: "response", sessionId: sessionId!, content: response }));
      } else {
        console.log(`\n${response}\n`);
      }
      rl.prompt();
    }

    closed = true;
    rl.close();
    if (!opts.jsonMode) console.log("\nChat ended.");
  };

  run().catch((err) => {
    console.error("Chat REPL error:", err);
    closed = true;
  });

  return () => { closed = true; };
}
