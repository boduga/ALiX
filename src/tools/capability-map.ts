type Capability =
  | "file.read"
  | "file.write"
  | "file.delete"
  | "shell.run"
  | "shell.readonly"
  | "git.diff"
  | "git.commit"
  | "git.push"
  | "network.fetch"
  | "secret.read"
  | "browser.open"
  | "mcp.invoke"
  | "tool.invoke";

type ApprovalLevel = "allow" | "ask" | "deny";

interface PolicyConfig {
  tools: Partial<Record<Capability, ApprovalLevel>>;
  default: ApprovalLevel;
}

const LEGACY_TO_CANONICAL: Record<string, string> = {
  "file.read": "filesystem.read",
  "file.write": "filesystem.write",
  "file.search": "filesystem.search",
  "file.delete": "filesystem.write",
  "shell.run": "shell.exec",
  "shell.readonly": "shell.exec",
  "git.diff": "repo.read",
  "git.commit": "repo.write",
  "git.push": "repo.write",
  "network.fetch": "network.fetch",
  "secret.read": "secret.read",
  "browser.open": "browser.open",
  "patch.apply": "patch.apply",
  "delegate": "agent.delegate",
  "task.complete": "task.complete",
  "web.search": "web.search",
  "web.fetch": "web.fetch",
  "mcp.invoke": "mcp.invoke",
  "tool.invoke": "tool.invoke",
};

export function legacyCapabilityToCanonical(legacy: string): string {
  return LEGACY_TO_CANONICAL[legacy] ?? legacy;
}

const TOOL_CAPABILITY_MAP: Record<string, Capability> = {
  "alix_file_read": "file.read",
  "alix_file_write": "file.write",
  "alix_file_create": "file.write",
  "alix_shell_run": "shell.run",
  "alix_shell_readonly": "shell.readonly",
  "alix_git_diff": "git.diff",
  "alix_git_commit": "git.commit",
  "alix_git_push": "git.push",
  "mcp_tool": "mcp.invoke",
};

export function inferCapability(toolName: string): Capability {
  return TOOL_CAPABILITY_MAP[toolName] ?? "tool.invoke";
}

const READONLY_CAPABILITIES: readonly Capability[] = ["file.read", "shell.readonly", "git.diff"];

export function isReadonlyCapability(capability: Capability): boolean {
  return READONLY_CAPABILITIES.includes(capability);
}

export function requiresApproval(capability: Capability, policy: PolicyConfig): ApprovalLevel {
  return policy.tools[capability] ?? policy.default;
}

export type { Capability, ApprovalLevel, PolicyConfig };