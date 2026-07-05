/**
 * P12.3 — Autonomous governance approval workflow.
 *
 * Pure gate-state machine: given policy + risk, determine what approval gates
 * are required and manage their state. No ledger writes, no persistence,
 * no P11 orchestration coupling.
 *
 * Core invariant: gate-state machine, not storage layer. P12.4 owns durable storage.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApprovalGateName =
  | "proposal"
  | "file_scope"
  | "verification"
  | "pr"
  | "merge";

export type ApprovalGateStatus =
  | "pending"
  | "approved"
  | "denied";

export interface ApprovalGate {
  gate: ApprovalGateName;
  status: ApprovalGateStatus;
  approvedBy?: string;
  approvedAt?: string;
  reason?: string;
}

export type PolicyDecision = "allow" | "deny" | "requires_approval";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface ApprovalWorkflowInput {
  policyDecision: PolicyDecision;
  riskLevel: RiskLevel;
}

export interface ApprovalWorkflowResult {
  required: boolean;
  gates: ApprovalGate[];
  reason: string;
}

// ---------------------------------------------------------------------------
// Gate rules
// ---------------------------------------------------------------------------

/** Risk thresholds for each gate. Gates are included when risk >= threshold. */
const GATE_THRESHOLDS: Record<ApprovalGateName, RiskLevel> = {
  proposal: "medium",
  file_scope: "high",
  verification: "low",
  pr: "low",
  merge: "low", // always included
};

const GATE_ORDER: ApprovalGateName[] = [
  "proposal",
  "file_scope",
  "verification",
  "pr",
  "merge",
];

const RISK_ORDER: RiskLevel[] = ["low", "medium", "high", "critical"];

function riskLevelAtLeast(level: RiskLevel, threshold: RiskLevel): boolean {
  return RISK_ORDER.indexOf(level) >= RISK_ORDER.indexOf(threshold);
}

function createGate(gate: ApprovalGateName, status: ApprovalGateStatus = "pending"): ApprovalGate {
  return { gate, status };
}

// ---------------------------------------------------------------------------
// Workflow building
// ---------------------------------------------------------------------------

/**
 * Build an approval workflow from policy decision + risk level.
 *
 * Pure function — no side effects, no mutation, no storage.
 */
export function buildApprovalWorkflow(input: ApprovalWorkflowInput): ApprovalWorkflowResult {
  const { policyDecision, riskLevel } = input;

  // Deny blocks everything — no approval gates needed
  if (policyDecision === "deny") {
    return {
      required: false,
      gates: [],
      reason: "Blocked by policy — action denied",
    };
  }

  const gates: ApprovalGate[] = [];

  for (const gateName of GATE_ORDER) {
    const threshold = GATE_THRESHOLDS[gateName];
    // When policy requires approval, include all gates regardless of risk
    if (policyDecision === "requires_approval" || riskLevelAtLeast(riskLevel, threshold)) {
      gates.push(createGate(gateName));
    }
  }

  return {
    required: gates.length > 0,
    gates,
    reason: `${gates.length} approval gate(s) required`,
  };
}

// ---------------------------------------------------------------------------
// Gate state transitions
// ---------------------------------------------------------------------------

/**
 * Mark a gate as approved. Returns a new result (immutable).
 *
 * Merge gate cannot be approved via this function — merges are never autonomous.
 * Approving an already-approved or non-existent gate is a no-op.
 */
export function approveGate(
  result: ApprovalWorkflowResult,
  gateName: ApprovalGateName,
  approvedBy: string,
): ApprovalWorkflowResult {
  // Merge is never auto-approvable
  if (gateName === "merge") {
    return result;
  }

  const gateIdx = result.gates.findIndex((g) => g.gate === gateName);
  if (gateIdx === -1) {
    return result; // no-op for non-existent gate
  }

  const existing = result.gates[gateIdx];
  if (existing.status === "approved") {
    return result; // no-op for already approved
  }

  const newGates = result.gates.map((g, i) =>
    i === gateIdx
      ? { ...g, status: "approved" as ApprovalGateStatus, approvedBy }
      : { ...g },
  );

  return { ...result, gates: newGates };
}

/**
 * Mark a gate as denied. Returns a new result (immutable).
 * Denying an already-denied or non-existent gate is a no-op.
 */
export function denyGate(
  result: ApprovalWorkflowResult,
  gateName: ApprovalGateName,
  reason?: string,
): ApprovalWorkflowResult {
  const gateIdx = result.gates.findIndex((g) => g.gate === gateName);
  if (gateIdx === -1) {
    return result;
  }

  const existing = result.gates[gateIdx];
  if (existing.status === "denied") {
    return result;
  }

  const newGates = result.gates.map((g, i) =>
    i === gateIdx
      ? { ...g, status: "denied" as ApprovalGateStatus, reason: reason ?? g.reason }
      : { ...g },
  );

  return { ...result, gates: newGates };
}

/**
 * Check if all gates in the workflow are approved.
 * Empty gates → false (nothing to approve).
 */
export function isWorkflowApproved(result: ApprovalWorkflowResult): boolean {
  if (result.gates.length === 0) {
    return false;
  }
  return result.gates.every((g) => g.status === "approved");
}

// ---------------------------------------------------------------------------
// CLI handler
// ---------------------------------------------------------------------------

const VALID_POLICIES = ["allow", "deny", "requires_approval"];
const VALID_RISKS = ["low", "medium", "high", "critical"];

export function approvalCLI(args: string[]): void {
  let policyDecision = "allow";
  let riskLevel = "low";
  let jsonMode = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--policy") {
      const val = args[++i] ?? "";
      if (!VALID_POLICIES.includes(val)) {
        console.error(`Error: Invalid policy decision "${val}". Valid: ${VALID_POLICIES.join(", ")}`);
        process.exit(1);
      }
      policyDecision = val;
      continue;
    }
    if (args[i] === "--risk") {
      const val = args[++i] ?? "";
      if (!VALID_RISKS.includes(val)) {
        console.error(`Error: Invalid risk level "${val}". Valid: ${VALID_RISKS.join(", ")}`);
        process.exit(1);
      }
      riskLevel = val;
      continue;
    }
    if (args[i] === "--json") {
      jsonMode = true;
      continue;
    }
  }

  const wf = buildApprovalWorkflow({
    policyDecision: policyDecision as PolicyDecision,
    riskLevel: riskLevel as RiskLevel,
  });

  if (jsonMode) {
    console.log(JSON.stringify(wf, null, 2));
    return;
  }

  console.log(`Approval Workflow — ${policyDecision} / ${riskLevel}`);
  console.log(`Required: ${wf.required}`);
  console.log(`Reason: ${wf.reason}`);
  console.log(`\nGates (${wf.gates.length}):`);
  for (const g of wf.gates) {
    const icon = g.status === "approved" ? "✅" : g.status === "denied" ? "❌" : "⏳";
    const by = g.approvedBy ? ` by ${g.approvedBy}` : "";
    const reason = g.reason ? ` — ${g.reason}` : "";
    console.log(`  ${icon} [${g.status}] ${g.gate}${by}${reason}`);
  }
}
