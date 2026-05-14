import type { McpServerCapabilities, Tool } from "./types.js";

export type MappedPolicyRule = {
  id: string;
  capability: string;
  effect: "allow" | "ask" | "deny";
  reason: string;
};

export function mapServerCapabilities(
  serverName: string,
  capabilities: McpServerCapabilities,
  tools: Tool[]
): MappedPolicyRule[] {
  const rules: MappedPolicyRule[] = [];

  // Default rule for the entire server — always "ask"
  rules.push({
    id: `mcp:${serverName}:default`,
    capability: `mcp.${serverName}.*`,
    effect: "ask",
    reason: `MCP server '${serverName}' — requires explicit approval`
  });

  // Per-tool rules
  if (capabilities.tools) {
    for (const tool of tools) {
      const safeName = tool.name.replace(/[^a-zA-Z0-9_]/g, "_");
      rules.push({
        id: `mcp:${serverName}:tool:${safeName}`,
        capability: `mcp.${serverName}.${safeName}`,
        effect: "ask",
        reason: `Tool '${tool.name}' from MCP server '${serverName}'`
      });
    }
  }

  return rules;
}