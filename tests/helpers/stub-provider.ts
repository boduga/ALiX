/**
 * Shared stub ModelAdapter for skill/eval tests (no network, no model).
 * Sequences response texts across complete() calls; records user contents.
 */
import type { ModelAdapter } from "../../src/providers/types.js";

export function stubProvider(texts: string[], onCalls?: string[]): ModelAdapter {
  const queue = [...texts];
  return {
    complete: async (req: { messages?: Array<{ content?: string }> }) => {
      onCalls?.push(req.messages?.[0]?.content ?? "");
      const text = queue.length > 1 ? queue.shift()! : queue[0] ?? "";
      return { text } as unknown as Awaited<ReturnType<ModelAdapter["complete"]>>;
    },
  } as unknown as ModelAdapter;
}
