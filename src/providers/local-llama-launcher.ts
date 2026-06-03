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
  /** llama-server binary path (auto-detected if not set) */
  serverPath?: string;
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

const PROBE_TIMEOUT_MS = 60_000;  // max wait for server to be ready

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

  // 2. Need to start it — resolve model path
  const modelPath = options?.modelPath ?? process.env.ALIX_LLAMA_MODEL_PATH;
  if (!modelPath) {
    throw new Error(
      "ALIX_LLAMA_MODEL_PATH not set and llama-server is not running. " +
      "Set the env var: export ALIX_LLAMA_MODEL_PATH=~/llama.cpp/models/your-model.gguf"
    );
  }
  const resolved = modelPath.startsWith("~")
    ? join(homedir(), modelPath.slice(1))
    : modelPath;
  if (!existsSync(resolved)) {
    throw new Error(`Model not found at: ${resolved}. Check ALIX_LLAMA_MODEL_PATH.`);
  }

  // 3. Find the llama-server binary
  const serverBin = options?.serverPath
    ?? process.env.ALIX_LLAMA_SERVER_PATH
    ?? LLAMA_SERVER_DEFAULT;
  if (!existsSync(serverBin)) {
    throw new Error(`llama-server not found at: ${serverBin}. Set ALIX_LLAMA_SERVER_PATH or build llama.cpp.`);
  }

  // 4. Start the server
  const port = options?.port ?? 8080;
  const ctxSize = options?.ctxSize ?? 4096;
  const threads = options?.threads ?? 16;
  const batchSize = options?.batchSize ?? 2048;
  const ubatchSize = options?.ubatchSize ?? 512;
  const host = new URL(baseUrl).hostname ?? "127.0.0.1";

  const child = spawn(serverBin, [
    "-m", resolved,
    "--jinja", "-fa", "on",
    "-c", String(ctxSize),
    "-t", String(threads),
    "-b", String(batchSize),
    "-ub", String(ubatchSize),
    "--host", host,
    "--port", String(port),
  ], {
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
