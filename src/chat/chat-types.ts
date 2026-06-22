import type { DecisionArtifact, SourceArtifact } from "../adaptation/decision-types.js";

export type ChatRoute =
  | "answer"
  | "inspect_state"
  | "run_skill"
  | "invoke_agent"       // reserved — wired in P8/P9+
  | "create_intent"
  | "propose_intent"
  | "run_task"
  | "unknown";

export interface ChatRouteDecision {
  route: ChatRoute;
  confidence: number;
  reasons: string[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  createdAt: string;
  /** Route classification, set when the message is processed by the router (P7.6b+). */
  route?: ChatRoute;
  /** Confidence of the route classification (0-1). */
  routeConfidence?: number;
  /** Artifacts that informed this message (what the assistant read). */
  sourceArtifacts?: SourceArtifact[];
  /** Artifacts this message produced (intents, proposals, outcomes). */
  generatedArtifacts?: SourceArtifact[];
}

export interface ChatSession extends DecisionArtifact {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
}
