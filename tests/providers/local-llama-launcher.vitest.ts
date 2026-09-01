import { describe, it, expect } from "vitest";
import {
  resolveLlamaKnobs,
  buildLlamaServerArgs,
  type ResolvedLlamaKnobs,
} from "../../src/providers/local-llama-launcher.js";

describe("resolveLlamaKnobs", () => {
  it("applies defaults when no config or env is present", () => {
    const knobs = resolveLlamaKnobs({ modelPath: "/m.gguf" }, {});
    expect(knobs).toMatchObject({
      modelPath: "/m.gguf",
      port: 8080,
      ctxSize: 4096,
      threads: 16,
      batchSize: 2048,
      ubatchSize: 512,
      gpuLayers: "auto",
      flashAttn: "auto",
      serverPath: knobs.serverPath,
    });
  });

  it("config beats env beats default", () => {
    const knobs = resolveLlamaKnobs(
      {
        modelPath: "/cfg.gguf",
        port: 9001,
        ctxSize: 8192,
        gpuLayers: 33,
        flashAttn: true,
      },
      {
        ALIX_LLAMA_MODEL_PATH: "/env.gguf",
        ALIX_LLAMA_PORT: "9999",
        ALIX_LLAMA_CTX_SIZE: "2048",
        ALIX_LLAMA_GPU_LAYERS: "1",
        ALIX_LLAMA_FLASH_ATTN: "off",
        ALIX_LLAMA_SERVER_PATH: "/env/llama-server",
      },
    );
    expect(knobs).toMatchObject({
      modelPath: "/cfg.gguf",
      port: 9001,
      ctxSize: 8192,
      gpuLayers: 33,
      flashAttn: true,
      serverPath: "/env/llama-server",
    });
  });

  it("env fills knobs a partial config leaves unset", () => {
    const knobs = resolveLlamaKnobs({}, {
      ALIX_LLAMA_MODEL_PATH: "/env.gguf",
      ALIX_LLAMA_PORT: "7070",
      ALIX_LLAMA_CTX_SIZE: "2048",
      ALIX_LLAMA_THREADS: "8",
      ALIX_LLAMA_BATCH_SIZE: "1024",
      ALIX_LLAMA_UBATCH_SIZE: "256",
      ALIX_LLAMA_GPU_LAYERS: "12",
      ALIX_LLAMA_FLASH_ATTN: "on",
      ALIX_LLAMA_SERVER_PATH: "/env/llama-server",
    });
    expect(knobs).toMatchObject({
      modelPath: "/env.gguf",
      port: 7070,
      ctxSize: 2048,
      threads: 8,
      batchSize: 1024,
      ubatchSize: 256,
      gpuLayers: 12,
      flashAttn: true,
      serverPath: "/env/llama-server",
    });
  });

  it("treats invalid env numeric values as unset (falls through to default)", () => {
    const knobs = resolveLlamaKnobs({ modelPath: "/m.gguf" }, {
      ALIX_LLAMA_PORT: "abc",
      ALIX_LLAMA_CTX_SIZE: "-5",
    });
    expect(knobs.port).toBe(8080);
    expect(knobs.ctxSize).toBe(4096);
  });

  it("flashes flashAttn env to boolean", () => {
    expect(resolveLlamaKnobs({ modelPath: "/m.gguf" }, { ALIX_LLAMA_FLASH_ATTN: "on" }).flashAttn).toBe(true);
    expect(resolveLlamaKnobs({ modelPath: "/m.gguf" }, { ALIX_LLAMA_FLASH_ATTN: "true" }).flashAttn).toBe(true);
    expect(resolveLlamaKnobs({ modelPath: "/m.gguf" }, { ALIX_LLAMA_FLASH_ATTN: "1" }).flashAttn).toBe(true);
    expect(resolveLlamaKnobs({ modelPath: "/m.gguf" }, { ALIX_LLAMA_FLASH_ATTN: "off" }).flashAttn).toBe(false);
    expect(resolveLlamaKnobs({ modelPath: "/m.gguf" }, { ALIX_LLAMA_FLASH_ATTN: "auto" }).flashAttn).toBe("auto");
  });

  it("throws when no modelPath resolves", () => {
    expect(() => resolveLlamaKnobs({}, {})).toThrow(/ALIX_LLAMA_MODEL_PATH/);
  });
});

function defaults(): ResolvedLlamaKnobs {
  return {
    modelPath: "/m.gguf",
    port: 8080,
    ctxSize: 4096,
    threads: 16,
    batchSize: 2048,
    ubatchSize: 512,
    gpuLayers: "auto",
    flashAttn: "auto",
    serverPath: "/usr/bin/llama-server",
  };
}

describe("buildLlamaServerArgs", () => {
  it("omits -ngl and --flash-attn when their knobs are auto", () => {
    const args = buildLlamaServerArgs(defaults(), "127.0.0.1");
    expect(args).toEqual([
      "-m", "/m.gguf",
      "-c", "4096",
      "-t", "16",
      "-b", "2048",
      "-ub", "512",
      "--host", "127.0.0.1",
      "--port", "8080",
      "--jinja",
    ]);
    expect(args).not.toContain("-ngl");
    expect(args).not.toContain("--flash-attn");
  });

  it("maps resolved knobs to argv incl -ngl and --flash-attn", () => {
    const args = buildLlamaServerArgs({
      ...defaults(),
      ctxSize: 8192,
      gpuLayers: 33,
      flashAttn: true,
      port: 9001,
    }, "localhost");
    expect(args).toEqual([
      "-m", "/m.gguf",
      "-c", "8192",
      "-t", "16",
      "-b", "2048",
      "-ub", "512",
      "-ngl", "33",
      "--flash-attn", "on",
      "--host", "localhost",
      "--port", "9001",
      "--jinja",
    ]);
  });

  it("passes --flash-attn off when flashAttn is false", () => {
    const args = buildLlamaServerArgs({ ...defaults(), flashAttn: false }, "127.0.0.1");
    expect(args).toContain("--flash-attn");
    expect(args).toContain("off");
  });
});