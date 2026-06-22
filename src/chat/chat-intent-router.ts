import type { ChatRoute, ChatRouteDecision } from "./chat-types.js";

interface RoutePattern {
  route: ChatRoute;
  patterns: RegExp[];
  baseConfidence: number;
}

const ROUTE_PATTERNS: RoutePattern[] = [
  {
    route: "inspect_state",
    baseConfidence: 0.9,
    patterns: [
      /show\s+(pending\s+)?(proposals|queue)/i,
      /(pending|open)\s+proposals/i,
      /pipeline\s+health/i,
      /decision\s+(status|queue)/i,
    ],
  },
  {
    route: "run_skill",
    baseConfidence: 0.85,
    patterns: [
      /run\s+skill/i,
      /use\s+(the\s+)?(.+?)\s+skill/i,
      /execute\s+skill/i,
    ],
  },
  {
    route: "create_intent",
    baseConfidence: 0.85,
    patterns: [
      /create\s+(an\s+)?intent/i,
      /capture\s+(this|that|it)/i,
      /make\s+(this|that|it)\s+an?\s+intent/i,
      /turn\s+(this|that|it)\s+into\s+an?\s+intent/i,
    ],
  },
  {
    route: "propose_intent",
    baseConfidence: 0.85,
    patterns: [
      /\bpropose\b/i,
      /make\s+(this|that|it)\s+a\s+proposal/i,
      /create\s+a\s+proposal/i,
      /submit\s+proposal/i,
    ],
  },
  {
    route: "run_task",
    baseConfidence: 0.75,
    patterns: [
      /^build\s+(me\s+)?(a|an)/i,
      /^create\s+(a|an)\s+(app|cli|tool|service)/i,
      /implement/i,
      /write\s+(a|an|the)\s+(function|class|module)/i,
    ],
  },
];

const ANSWER_PATTERNS = [
  /^(hello|hi|hey|help|what can you do)/i,
  /^(who|what)\s+(are|is)\s+(you|this)/i,
  /how\s+(do|does|can|should)/i,
];

export function routeMessage(input: string): ChatRouteDecision {
  const trimmed = input.trim();
  if (!trimmed) return { route: "unknown", confidence: 0, reasons: ["Empty input"] };

  for (const pattern of ANSWER_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { route: "answer", confidence: 0.9, reasons: ["Greeting or help question"] };
    }
  }

  for (const { route, patterns, baseConfidence } of ROUTE_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(trimmed)) {
        return { route, confidence: baseConfidence, reasons: [`Matched pattern: ${pattern.source}`] };
      }
    }
  }

  return { route: "unknown", confidence: 0.2, reasons: ["No pattern matched"] };
}
