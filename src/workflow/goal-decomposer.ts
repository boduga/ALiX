import type { GoalPlan, OutcomeNode } from "./goal-types.js";

export class GoalDecomposer {
  async decompose(goal: string): Promise<GoalPlan> {
    const nodes = this.decomposeNodes(goal);
    const caps = this.extractCapabilities(goal, nodes);
    const risks = this.detectRisks(goal, caps);

    return {
      goal,
      outcomeNodes: nodes,
      requiredCapabilities: [...new Set(caps)],
      riskFlags: risks,
      requiresApproval: true,
      reasoning: this.buildReasoning(goal, nodes, risks),
    };
  }

  private decomposeNodes(goal: string): OutcomeNode[] {
    const nodes: OutcomeNode[] = [];
    const lower = goal.toLowerCase();

    // Detect domain from keywords and generate appropriate nodes
    const domains = this.detectDomains(lower);

    let nodeId = 0;
    for (const domain of domains) {
      nodes.push(this.buildNode(++nodeId, domain, goal));
    }

    // Always include a review node
    nodes.push(this.buildNode(++nodeId, "review", goal));

    return nodes;
  }

  private detectDomains(lower: string): string[] {
    const domains: string[] = [];

    if (/dashboard|ui|page|view|component|frontend/.test(lower)) domains.push("frontend");
    if (/api|endpoint|route|backend|server/.test(lower)) domains.push("backend");
    if (/query|database|store|data|migration|schema/.test(lower)) domains.push("data");
    if (/test|testing|coverage|spec/.test(lower)) domains.push("testing");
    if (/deploy|ci|cd|pipeline|infra/.test(lower)) domains.push("infrastructure");
    if (/doc|readme|documentation|comment/.test(lower)) domains.push("documentation");
    if (/security|auth|permission|encrypt/.test(lower)) domains.push("security");
    if (/config|configuration|setting/.test(lower)) domains.push("configuration");

    // Default to general if nothing matched
    if (domains.length === 0) domains.push("general");

    return domains;
  }

  private buildNode(id: number, domain: string, goal: string): OutcomeNode {
    const capMap: Record<string, string[]> = {
      frontend: ["ui.development", "ui.testing"],
      backend: ["api.development", "api.testing"],
      data: ["data.modeling", "data.migration", "data.testing"],
      testing: ["test.unit", "test.integration"],
      infrastructure: ["infra.config", "infra.deploy"],
      documentation: ["docs.writing"],
      security: ["security.review", "security.testing"],
      configuration: ["config.management"],
      review: ["code.review", "governance.check"],
      general: ["analysis", "implementation", "testing"],
    };

    return {
      id: `node-${id}`,
      description: `${domain}: ${goal.slice(0, 80)}`,
      requiredCapabilities: capMap[domain] ?? ["analysis"],
      estimatedEffort: "medium",
      acceptanceCriteria: [`Verify ${domain} changes meet requirements`],
    };
  }

  private extractCapabilities(goal: string, nodes: OutcomeNode[]): string[] {
    const caps = new Set<string>();
    for (const node of nodes) {
      for (const c of node.requiredCapabilities) caps.add(c);
    }

    const lower = goal.toLowerCase();
    if (/test|testing|coverage/.test(lower)) caps.add("test.execution");
    if (/deploy|release/.test(lower)) caps.add("deploy.management");
    if (/doc|readme/.test(lower)) caps.add("docs.generation");

    return [...caps];
  }

  private detectRisks(goal: string, capabilities: string[]): string[] {
    const risks: string[] = [];
    const lower = goal.toLowerCase();

    if (/migrate|migration/.test(lower)) risks.push("data migration risk");
    if (/rewrite|refactor|redesign/.test(lower)) risks.push("significant refactor");
    if (/security|auth|permission/.test(lower)) risks.push("security relevant");
    if (/database|schema/.test(lower)) risks.push("data schema change");
    if (/api|breaking/.test(lower)) risks.push("API change");
    if (/deadline|urgent|critical/.test(lower)) risks.push("time sensitive");
    if (/fix|bug|error|crash|500|exception|broken/.test(lower)) risks.push("bug fix required");
    if (capabilities.length > 5) risks.push("cross-domain scope");

    return risks;
  }

  private buildReasoning(goal: string, nodes: OutcomeNode[], risks: string[]): string {
    const parts = [`Decomposed goal into ${nodes.length} outcome node(s).`];
    if (risks.length > 0) parts.push(`Identified ${risks.length} risk factor(s): ${risks.join(", ")}.`);
    return parts.join(" ");
  }
}
