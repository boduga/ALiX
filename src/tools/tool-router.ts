import type { ToolResult } from "./types.js";

export type ToolCallRequest = {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
};

export interface ToolRouter {
  canHandle(name: string): boolean;
  execute(request: ToolCallRequest): Promise<ToolResult>;
}

export class FileToolRouter implements ToolRouter {
  private static readonly SUPPORTED_TOOLS = [
    "file.read",
    "file.create",
    "file.delete",
    "file.exists",
    "dir.search",
  ];

  canHandle(name: string): boolean {
    return FileToolRouter.SUPPORTED_TOOLS.includes(name);
  }

  async execute(_request: ToolCallRequest): Promise<ToolResult> {
    throw new Error("Not implemented yet");
  }
}

export class ShellToolRouter implements ToolRouter {
  canHandle(name: string): boolean {
    return name === "shell.run";
  }

  async execute(_request: ToolCallRequest): Promise<ToolResult> {
    throw new Error("Not implemented yet");
  }
}

export class PatchToolRouter implements ToolRouter {
  canHandle(name: string): boolean {
    return name === "patch.apply";
  }

  async execute(_request: ToolCallRequest): Promise<ToolResult> {
    throw new Error("Not implemented yet");
  }
}

export class McpToolRouter implements ToolRouter {
  canHandle(name: string): boolean {
    return name.startsWith("mcp.");
  }

  async execute(_request: ToolCallRequest): Promise<ToolResult> {
    throw new Error("Not implemented yet");
  }
}

export class DelegateToolRouter implements ToolRouter {
  canHandle(name: string): boolean {
    return name === "delegate";
  }

  async execute(_request: ToolCallRequest): Promise<ToolResult> {
    throw new Error("Not implemented yet");
  }
}

export class CompositeToolRouter implements ToolRouter {
  constructor(private readonly routers: ToolRouter[]) {}

  canHandle(_name: string): boolean {
    return true; // Composite router always matches; delegation decides
  }

  async execute(request: ToolCallRequest): Promise<ToolResult> {
    const router = this.routers.find((r) => r.canHandle(request.name));
    if (!router) {
      return {
        kind: "error",
        message: `No router found for tool: ${request.name}`,
      };
    }
    return router.execute(request);
  }
}