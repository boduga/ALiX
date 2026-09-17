import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelAdapter, NormalizedRequest } from "../../src/providers/types.js";
import { streamToResponse } from "../../src/run/helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function provider(): ModelAdapter {
  return {
    stream: async function* () {
      yield { type: "text_delta", text: "streamed answer" } as const;
      yield { type: "done", finish_reason: "stop" } as const;
    },
  } as unknown as ModelAdapter;
}

const request = {
  systemPrompt: "test",
  messages: [{ role: "user", content: "hello" }],
} as NormalizedRequest;

describe("stream stdout ownership", () => {
  it("forwards tokens without writing raw stdout when disabled", async () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as typeof process.stdout.write);
    const tokens: string[] = [];

    const result = await streamToResponse(provider(), request, {
      writeToStdout: false,
      onStream: (chunk) => {
        if (chunk.type === "text" && chunk.text) tokens.push(chunk.text);
      },
    });

    expect(result.text).toBe("streamed answer");
    expect(tokens).toEqual(["streamed answer"]);
    expect(write).not.toHaveBeenCalled();
  });

  it("preserves raw stdout streaming by default for CLI callers", async () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as typeof process.stdout.write);

    await streamToResponse(provider(), request);

    expect(write).toHaveBeenCalledWith("streamed answer");
  });
});
