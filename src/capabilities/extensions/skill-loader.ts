import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export type LoadedSkill = {
  id: string;
  name: string;
  content: string;
  variables: string[];
};

export class SkillLoader {
  private skillsDir: string;
  private variablePattern: RegExp;

  constructor(skillsDir: string, options?: { variablePattern?: RegExp }) {
    this.skillsDir = skillsDir;
    this.variablePattern = options?.variablePattern ?? /\{\{(\w+)\}\}/g;
  }

  async load(skillId: string, context?: Record<string, string>): Promise<LoadedSkill | undefined> {
    const filePath = join(this.skillsDir, `${skillId}.md`);

    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      return undefined;
    }

    const name = this.extractName(content);
    const variables = this.extractVariables(content);
    const injectedContent = this.injectContext(content, context);

    return {
      id: skillId,
      name,
      content: injectedContent,
      variables,
    };
  }

  async list(): Promise<string[]> {
    const files = await readdir(this.skillsDir);
    return files
      .filter((file) => file.endsWith(".md"))
      .map((file) => file.replace(/\.md$/, ""));
  }

  private extractName(content: string): string {
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1] : "Untitled";
  }

  private extractVariables(content: string): string[] {
    const variables: string[] = [];
    const pattern = new RegExp(this.variablePattern.source, "g");
    let match;

    while ((match = pattern.exec(content)) !== null) {
      const variable = match[1];
      if (!variables.includes(variable)) {
        variables.push(variable);
      }
    }

    return variables;
  }

  private injectContext(content: string, context?: Record<string, string>): string {
    if (!context) {
      return content;
    }

    let result = content;
    for (const [key, value] of Object.entries(context)) {
      // Build pattern by matching the exact variable name
      // Extract prefix and suffix from the variable pattern
      const source = this.variablePattern.source;
      const prefix = source.slice(0, source.indexOf("\\w+"));
      const suffix = source.slice(source.indexOf("\\w+") + 3);
      const pattern = new RegExp(prefix + key + suffix, "g");
      result = result.replace(pattern, value);
    }

    return result;
  }
}