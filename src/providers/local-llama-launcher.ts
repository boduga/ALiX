// src/providers/local-llama-launcher.ts
// Auto-starts llama-server if it's not already running.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type LlamaServerOptions = {
  /** Path to the GGUF model file */
  modelPath: string;
  /** Port to listen on (default: 8080) */
  port?: number;
  /** Context size (default: 4096) */
  ctxSize?: number;
  /** CPU threads (default: 16) */
  threads?: number;
  /** Batch size (default: 2048) */
  batchSize?: number;
  /** Microbatch size (default: 512) */
  ubatchSize?: number;
  /** Offload layers to GPU (`-ngl`). Omitted from argv when "auto". */
  gpuLayers?: number | "auto";
  /** Flash attention (`--flash-attn`). Omitted from argv when "auto". */
  flashAttn?: boolean | "auto";
  /** llama-server binary path (auto-detected if not set) */
  serverPath?: string;
};

/** Fully-resolved launcher knobs after config > env > default precedence. */
export type ResolvedLlamaKnobs = {
  modelPath: string;
  port: number;
  ctxSize: number;
  threads: number;
  batchSize: number;
  ubatchSize: number;
  gpuLayers: number | "auto";
  flashAttn: boolean | "auto";
  serverPath: string;
};

type LauncherResult = {
  /** The spawned child process, or null if reusing an existing server */
  process: ChildProcess | null;
  /** Whether we just started the server */
  didStart: boolean;
};

const LLAMA_SERVER_DEFAULT = join(
  homedir(), "llama.cpp", "build", "bin", "llama-server"
);

const KNOB_DEFAULTS = {
  port: 8080,
  ctxSize: 4096,
  threads: 16,
  batchSize: 2048,
  ubatchSize: 512,
  gpuLayers: "auto" as const,
  flashAttn: "auto" as const,
};

const PROBE_TIMEOUT_MS = 60_000;  // max wait for server to be ready

/** Parse a numeric env override; undefined/invalid → undefined (falls through to default). */
function envNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Parse the flash-attn env override; accepts on/off/true/false/1/0. */
function envFlashAttn(value: string | undefined): boolean | "auto" | undefined {
  if (value === undefined) return undefined;
  if (value === "auto") return "auto";
  if (["on", "true", "1"].includes(value)) return true;
  if (["off", "false", "0"].includes(value)) return false;
  return undefined;
}

/**
 * Resolve launcher knobs with config > env > default precedence (spec decision 3).
 *
 * `env` is an injectable seam (defaults to `process.env`) so tests can pin
 * precedence without mutating the real environment. `modelPath` has no default:
 * it must come from config or `ALIX_LLAMA_MODEL_PATH`.
 */
export function resolveLlamaKnobs(
  options: Partial<LlamaServerOptions>,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedLlamaKnobs {
  const modelPath = options.modelPath
    ?? env.ALIX_LLAMA_MODEL_PATH;
  if (!modelPath) {
    throw new Error(
      "ALIX_LLAMA_MODEL_PATH not set and llama-server is not running. " +
      "Set the env var: export ALIX_LLAMA_MODEL_PATH=~/llama.cpp/models/your-model.gguf"
    );
  }
  return {
    modelPath,
    port: options.port ?? envNumber(env.ALIX_LLAMA_PORT) ?? KNOB_DEFAULTS.port,
    ctxSize: options.ctxSize ?? envNumber(env.ALIX_LLAMA_CTX_SIZE) ?? KNOB_DEFAULTS.ctxSize,
    threads: options.threads ?? envNumber(env.ALIX_LLAMA_THREADS) ?? KNOB_DEFAULTS.threads,
    batchSize: options.batchSize ?? envNumber(env.ALIX_LLAMA_BATCH_SIZE) ?? KNOB_DEFAULTS.batchSize,
    ubatchSize: options.ubatchSize ?? envNumber(env.ALIX_LLAMA_UBATCH_SIZE) ?? KNOB_DEFAULTS.ubatchSize,
    gpuLayers: options.gpuLayers ?? (env.ALIX_LLAMA_GPU_LAYERS === "auto" ? "auto" : envNumber(env.ALIX_LLAMA_GPU_LAYERS) ?? KNOB_DEFAULTS.gpuLayers),
    flashAttn: options.flashAttn ?? envFlashAttn(env.ALIX_LLAMA_FLASH_ATTN) ?? KNOB_DEFAULTS.flashAttn,
    serverPath: options.serverPath
      ?? env.ALIX_LLAMA_SERVER_PATH
      ?? LLAMA_SERVER_DEFAULT,
  };
}

/**
 * Build llama-server argv from resolved knobs (spec decision 4).
 *
 * `-ngl`/`--flash-attn` are omitted when their knob is `"auto"`; `--jinja` is
 * always passed (llama.cpp owns chat-template application). Pure — lets tests
 * assert the omit-when-auto mapping without spawning a server.
 */
export function buildLlamaServerArgs(knobs: ResolvedLlamaKnobs, host: string): string[] {
  const args: string[] = [
    "-m", knobs.modelPath,
    "-c", String(knobs.ctxSize),
    "-t", String(knobs.threads),
    "-b", String(knobs.batchSize),
    "-ub", String(knobs.ubatchSize),
  ];
  if (knobs.gpuLayers !== "auto") {
    args.push("-ngl", String(knobs.gpuLayers));
  }
  if (knobs.flashAttn !== "auto") {
    args.push("--flash-attn", knobs.flashAttn ? "on" : "off");
  }
  args.push("--host", host, "--port", String(knobs.port), "--jinja");
  return args;
}

/**
 * Probe a URL until it responds or timeout.
 * Returns true if the server is reachable.
 */
async function probeUrl(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch {
      // server not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * Ensure llama-server is reachable at `baseUrl`.
 * If not, start it with the given options.
 */
export async function ensureLlamaServer(
  baseUrl: string,
  options?: Partial<LlamaServerOptions>
): Promise<LauncherResult> {
  // 1. Try probing first — maybe it's already running
  const probeUrl_ = `${baseUrl.replace(/\/v1\/chat\/completions$/, "")}/v1/models`;
  const alreadyRunning = await probeUrl(probeUrl_, 3000);
  if (alreadyRunning) {
    return { process: null, didStart: false };
  }

// 2. Need to start it — resolve model path + knobs (config > env > default)
  const knobs = resolveLlamaKnobs(options ?? {});

  // 3. Validate the resolved model file + llama-server binary
  const resolved = knobs.modelPath.startsWith("~")
    ? join(homedir(), knobs.modelPath.slice(1))
    : knobs.modelPath;
  if (!existsSync(resolved)) {
    throw new Error(`Model not found at: ${resolved}. Check ALIX_LLAMA_MODEL_PATH.`);
  }
  if (!existsSync(knobs.serverPath)) {
    throw new Error(`llama-server not found at: ${knobs.serverPath}. Set ALIX_LLAMA_SERVER_PATH or build llama.cpp.`);
  }

  // 4. Build argv from the resolved knobs and start the server
  const host = new URL(baseUrl).hostname ?? "127.0.0.1";
  const args = buildLlamaServerArgs({ ...knobs, modelPath: resolved }, host);

  const child = spawn(knobs.serverPath, args, {
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  child.on("exit", (code) => {
    if (code !== 0) {
      console.error(`[llama-server] exited with code ${code}`);
      console.error(output);
    }
  });

  // 5. Wait for it to be ready
  const ready = await probeUrl(probeUrl_, PROBE_TIMEOUT_MS);
  if (!ready) {
    child.kill();
    throw new Error(
      `llama-server failed to start within ${PROBE_TIMEOUT_MS / 1000}s.\n` +
      output.split("\n").slice(-5).join("\n")
    );
  }

  return { process: child, didStart: true };
}
