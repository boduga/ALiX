import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/providers/local-llama-launcher.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/providers/local-llama-launcher.js")>("../../src/providers/local-llama-launcher.js");
  return {
    ...actual,
    ensureLlamaServer: vi.fn().mockResolvedValue({ process: null, didStart: false }),
  };
});

import { LocalLlamaProvider } from "../../src/providers/local-llama-provider.js";
import { ensureLlamaServer } from "../../src/providers/local-llama-launcher.js";

describe("LocalLlamaProvider launcher knobs", () => {
  beforeEach(() => {
    vi.mocked(ensureLlamaServer).mockClear();
  });

  it("passes the resolved knob set to ensureLlamaServer on auto-start", async () => {
    const provider = new LocalLlamaProvider({
      localModelPath: "/cfg.gguf",
      localLlama: {
        port: 9001,
        ctxSize: 8192,
        gpuLayers: 33,
        flashAttn: true,
      },
    });
    // @ts-expect-error private field access for test
    await provider.ensureRunning();
    expect(ensureLlamaServer).toHaveBeenCalledWith(
      "http://localhost:8080/v1/chat/completions",
      {
        modelPath: "/cfg.gguf",
        port: 9001,
        ctxSize: 8192,
        gpuLayers: 33,
        flashAttn: true,
      },
    );
  });

  it("reads localModelPath from env when not supplied", async () => {
    const provider = new LocalLlamaProvider();
    // @ts-expect-error private field access for test
    expect(provider.localModelPath).toBe(process.env.ALIX_LLAMA_MODEL_PATH);
  });
});