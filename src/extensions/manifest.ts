export const EXTENSION_TYPES = ["skill", "hook", "mcp", "recipe", "subagent"] as const;
export type ExtensionType = typeof EXTENSION_TYPES[number];

export const HOOK_TRIGGERS = ["pre_task", "post_task", "on_change"] as const;
export type HookTrigger = typeof HOOK_TRIGGERS[number];

// --- Permission types ---
export type PermissionLevel = "none" | "read" | "write" | "dangerous";

export type ExtensionPermission = {
  level: PermissionLevel;
  description: string;
  reason?: string;
};

export type ExtensionManifestV2 = {
  permissions?: ExtensionPermission[];
  requires_confirmation?: boolean;
};

// --- Shared fields ---
type BaseExtension = {
  name: string;
  version: string;
  description: string;
  author?: string;
  tags?: string[];
  is_core?: boolean;
  permissions?: ExtensionPermission[];
  requires_confirmation?: boolean;
  license?: string;
  homepage?: string;
  installed_at?: string;
};

// --- Skill extension ---
export type SkillExtension = BaseExtension & {
  type: "skill";
  trigger?: string;       // slash command, e.g. "/tdd"
  pattern?: string;        // regex pattern
  auto_load?: boolean;    // load on startup
};

// --- Hook extension ---
export type HookExtension = BaseExtension & {
  type: "hook";
  trigger: "pre_task" | "post_task" | "on_change";
  command: string;
  env?: Record<string, string>;
  cwd?: string;
};

// --- MCP extension ---
export type McpExtension = BaseExtension & {
  type: "mcp";
  transport: "stdio" | "http" | "websocket";
  command?: string;       // for stdio
  args?: string[];
  env?: Record<string, string>;
  url?: string;           // for http/websocket
  headers?: Record<string, string>;
  tools?: string[];       // explicit tool allowlist (empty = all)
};

// --- Recipe extension ---
// Note: steps are expressed as flat arrays of tool names in the manifest.
// Full step objects are used when recipes are compiled at runtime.
// e.g. "steps: [bash, npm-test]" not nested objects.
export type RecipeExtension = BaseExtension & {
  type: "recipe";
  steps: string[];          // flat array of tool names, not nested objects
  prerequisites?: string[];
  estimated_tokens?: number;
};

// --- Subagent extension ---
export type SubagentExtension = BaseExtension & {
  type: "subagent";
  model?: string;
  readonly?: boolean;
  system_prompt?: string;
  files?: string[];      // owned file patterns
};

export type ExtensionManifest =
  | SkillExtension
  | HookExtension
  | McpExtension
  | RecipeExtension
  | SubagentExtension;

// Minimal YAML parser (no new dependency)
function yamlToObject(yaml: string): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  const lines = yaml.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) { i++; continue; }
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    if (value === "") {
      // look ahead for block value
      const items: string[] = [];
      i++;
      while (i < lines.length && lines[i].startsWith("  ")) {
        const item = lines[i].trim();
        if (item.startsWith("-")) items.push(item.slice(1).trim());
        else items.push(item);
        i++;
      }
      if (items.length > 0) { obj[key] = items; continue; }
      i--; // back up so outer loop processes this
    } else if (value.startsWith("[") && value.endsWith("]")) {
      obj[key] = value.slice(1, -1).split(",").map(t => t.trim()).filter(Boolean);
    } else if (value === "true") obj[key] = true;
    else if (value === "false") obj[key] = false;
    else if (!isNaN(Number(value)) && value !== "") obj[key] = Number(value);
    else obj[key] = value.replace(/^["']|["']$/g, "");
    i++;
  }
  return obj;
}

export function parseExtensionManifest(yaml: string, type: ExtensionType): ExtensionManifest | null {
  const raw = yamlToObject(yaml);
  if (!raw.name || !raw.description) return null;

  const base = {
    name: String(raw.name),
    version: String(raw.version ?? "1.0.0"),
    description: String(raw.description),
    author: raw.author != null ? String(raw.author) : undefined,
    tags: (raw.tags as string[] | undefined),
    is_core: raw.is_core === true,
    license: raw.license != null ? String(raw.license) : undefined,
    homepage: raw.homepage != null ? String(raw.homepage) : undefined,
    installed_at: raw.installed_at != null ? String(raw.installed_at) : undefined,
  };

  switch (type) {
    case "skill":
      return { ...base, type: "skill", trigger: raw.trigger as any, pattern: raw.pattern as any, auto_load: raw.auto_load === true };
    case "hook":
      const validHookTrigger = raw.trigger as string;
      if (validHookTrigger && !HOOK_TRIGGERS.includes(validHookTrigger as any)) {
        return null; // invalid hook trigger
      }
      return { ...base, type: "hook", trigger: raw.trigger as any, command: String(raw.command ?? ""), env: raw.env as any, cwd: raw.cwd as any };
    case "mcp":
      const validTransport = raw.transport as string;
      if (validTransport && !["stdio", "http", "websocket"].includes(validTransport)) {
        return null; // invalid transport type
      }
      return { ...base, type: "mcp", transport: (raw.transport as any) ?? "stdio", command: raw.command as any, args: raw.args as any, env: raw.env as any, url: raw.url as any, headers: raw.headers as any, tools: raw.tools as any };
    case "recipe":
      return { ...base, type: "recipe", steps: (raw.steps as string[] | undefined) ?? [], prerequisites: raw.prerequisites as any, estimated_tokens: raw.estimated_tokens as any };
    case "subagent":
      return { ...base, type: "subagent", model: raw.model as any, readonly: raw.readonly === true, system_prompt: raw.system_prompt as any, files: raw.files as any };
  }
}

export function getExtensionId(manifest: ExtensionManifest): string {
  return `${manifest.type}/${manifest.name}`;
}

export function isCoreExtension(manifest: ExtensionManifest): boolean {
  return manifest.is_core === true;
}
