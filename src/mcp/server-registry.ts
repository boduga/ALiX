// src/mcp/server-registry.ts

export type KnownServer = {
  name: string;
  package: string;
  description: string;
  command: string;
  args: string[];
  homepage?: string;
};

export const KNOWN_MCP_SERVERS: KnownServer[] = [
  {
    name: "github",
    package: "@modelcontextprotocol/server-github",
    description: "GitHub API: issues, PRs, repos",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    homepage: "https://github.com/modelcontextprotocol/servers",
  },
  {
    name: "filesystem",
    package: "@modelcontextprotocol/server-filesystem",
    description: "Filesystem operations: read, write, list",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    homepage: "https://github.com/modelcontextprotocol/servers",
  },
  {
    name: "fetch",
    package: "@modelcontextprotocol/server-fetch",
    description: "HTTP fetch: GET, POST URLs",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-fetch"],
    homepage: "https://github.com/modelcontextprotocol/servers",
  },
  {
    name: "git",
    package: "@modelcontextprotocol/server-git",
    description: "Git operations: log, diff, status",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-git"],
  },
  {
    name: "postgres",
    package: "@modelcontextprotocol/server-postgres",
    description: "PostgreSQL: query, schema, list tables",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
  },
  {
    name: "puppeteer",
    package: "@modelcontextprotocol/server-puppeteer",
    description: "Browser automation via Puppeteer",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
  },
  {
    name: "slack",
    package: "@modelcontextprotocol/server-slack",
    description: "Slack: channels, messages, users",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
  },
];

export function findServer(name: string): KnownServer | undefined {
  return KNOWN_MCP_SERVERS.find((s) => s.name === name);
}
