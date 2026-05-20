export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface ToolCapability {
  name: string;
  description: string;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  patterns?: RegExp[];
  category?: string;
  dependencies?: string[];
  metadata?: Record<string, unknown>;
}

export interface CapabilityRegistryOptions {
  strictMode?: boolean;
  defaultRiskLevel?: RiskLevel;
}

export class CapabilityRegistry {
  private capabilities = new Map<string, ToolCapability>();
  private options: Required<CapabilityRegistryOptions>;

  constructor(options: CapabilityRegistryOptions = {}) {
    this.options = {
      strictMode: options.strictMode ?? true,
      defaultRiskLevel: options.defaultRiskLevel ?? "medium",
    };
    this.registerDefaults();
  }

  register(name: string, capability: Omit<ToolCapability, "name">): void {
    this.capabilities.set(name, { ...capability, name });
  }

  get(name: string): ToolCapability | undefined {
    return this.capabilities.get(name);
  }

  getByRiskLevel(level: RiskLevel): ToolCapability[] {
    return [...this.capabilities.values()].filter(c => c.riskLevel === level);
  }

  filter(predicate: (cap: ToolCapability) => boolean): ToolCapability[] {
    return [...this.capabilities.values()].filter(predicate);
  }

  getDefaults(): ToolCapability[] {
    return [...this.capabilities.values()];
  }

  requiresApproval(name: string): boolean {
    const cap = this.get(name);
    return cap?.requiresApproval ?? this.options.strictMode;
  }

  getRiskLevel(name: string): RiskLevel {
    return this.get(name)?.riskLevel ?? this.options.defaultRiskLevel;
  }

  private registerDefaults(): void {
    const defaults: [string, Omit<ToolCapability, "name">][] = [
      ["file.read", { description: "Read file contents", riskLevel: "low", requiresApproval: false, category: "filesystem" }],
      ["file.write", { description: "Write file contents", riskLevel: "medium", requiresApproval: true, category: "filesystem" }],
      ["file.delete", { description: "Delete files", riskLevel: "high", requiresApproval: true, category: "filesystem" }],
      ["shell.exec", { description: "Execute shell commands", riskLevel: "critical", requiresApproval: true, category: "system" }],
      ["shell.read", { description: "Read shell output", riskLevel: "low", requiresApproval: false, category: "system" }],
      ["git.commit", { description: "Create git commits", riskLevel: "medium", requiresApproval: true, category: "vcs" }],
      ["git.push", { description: "Push to remote", riskLevel: "high", requiresApproval: true, category: "vcs" }],
      ["network.request", { description: "Make network requests", riskLevel: "medium", requiresApproval: true, category: "network" }],
    ];

    for (const [name, cap] of defaults) {
      this.register(name, cap);
    }
  }
}