/**
 * hardware-detect.ts — Detect system hardware, local runtime, and API providers.
 *
 * All probe failures are graceful (return "unknown" or zero, never throw).
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { platform } from "node:os";
import type { SystemInfo } from "./profile-registry.js";

function exec(cmd: string, args: string[], timeout = 5000): string | null {
  try { return execFileSync(cmd, args, { encoding: "utf-8", timeout }).trim(); }
  catch { return null; }
}

function readFirstFile(paths: string[]): string | null {
  for (const p of paths) { try { return readFileSync(p, "utf-8").trim(); } catch {} }
  return null;
}

function detectOS(): { os: string; cpu: string } {
  const p = platform();
  const os = p === "darwin" ? "macos" : p === "win32" ? "windows" : "linux";
  let cpu = "x64";
  if (p === "darwin") cpu = (exec("uname", ["-m"]) || "x86_64").includes("arm") ? "arm64" : "x64";
  else if (p === "linux") cpu = (exec("uname", ["-m"]) || "x86_64").includes("aarch64") ? "arm64" : "x64";
  return { os, cpu };
}

function detectRAM(): number {
  if (platform() === "darwin") {
    const out = exec("sysctl", ["-n", "hw.memsize"]);
    if (out) return Math.round(parseInt(out, 10) / (1024 ** 3) * 10) / 10;
  }
  if (platform() === "linux") {
    const meminfo = readFirstFile(["/proc/meminfo"]);
    if (meminfo) {
      for (const line of meminfo.split("\n")) {
        if (line.startsWith("MemTotal:")) {
          const kb = parseInt(line.replace(/[^0-9]/g, ""), 10);
          if (kb) return Math.round(kb / (1024 * 1024) * 10) / 10;
        }
      }
    }
  }
  if (platform() === "win32") {
    const out = exec("wmic", ["OS", "get", "TotalVisibleMemorySize", "/Value"]);
    if (out) { const m = out.match(/TotalVisibleMemorySize=(\d+)/); if (m) return Math.round(parseInt(m[1], 10) / (1024 * 1024) * 10) / 10; }
  }
  return 0;
}

function detectGPU(): { gpuName?: string; vramGb?: number; hasGpu: boolean } {
  const nvOut = exec("nvidia-smi", ["--query-gpu=memory.total,name", "--format=csv,noheader,nounits"]);
  if (nvOut) {
    const lines = nvOut.split("\n").filter(Boolean);
    if (lines.length > 0) {
      const parts = lines[0].split(",").map(s => s.trim());
      return { gpuName: parts[1] || "NVIDIA GPU", vramGb: Math.round(parseFloat(parts[0]) / 1024 * 10) / 10, hasGpu: true };
    }
  }
  if (platform() === "darwin") {
    const brand = exec("sysctl", ["-n", "machdep.cpu.brand_string"]);
    if (brand?.includes("Apple")) {
      const memsize = exec("sysctl", ["-n", "hw.memsize"]);
      const totalGb = memsize ? parseInt(memsize, 10) / (1024 ** 3) : 0;
      return { gpuName: brand, vramGb: totalGb > 0 ? Math.round(totalGb * 0.75 * 10) / 10 : undefined, hasGpu: true };
    }
  }
  return { hasGpu: false };
}

function detectOllama(): { installed: boolean; running: boolean; models: string[] } {
  if (!(exec("which", ["ollama"]) || exec("where", ["ollama"]))) return { installed: false, running: false, models: [] };
  const list = exec("ollama", ["list"], 3000);
  if (!list) return { installed: true, running: false, models: [] };
  return { installed: true, running: true, models: list.split("\n").slice(1).map(l => l.split(/\s+/)[0]).filter(Boolean) };
}

function detectAPIProviders(config: Record<string, unknown>): Record<string, { configured: boolean; hasKey: boolean }> {
  const providers: Record<string, { configured: boolean; hasKey: boolean }> = {};
  const known = ["anthropic", "openai", "google", "perplexity", "groq", "mistral", "cohere", "deepseek"];
  const apiKeys = (config.apiKeys as Record<string, string>) || {};
  const model = config.model as Record<string, unknown> | undefined;
  const models = config.models as Record<string, Record<string, unknown>> | undefined;

  for (const p of known) {
    const envKey = `${p.toUpperCase()}_API_KEY`;
    const hasKey = !!apiKeys[p] || !!process.env[envKey];
    const configured = model?.provider === p || (models && Object.values(models).some((m: any) => m?.provider === p)) || !!apiKeys[p];
    providers[p] = { configured, hasKey };
  }
  return providers;
}

export function detectSystem(config?: Record<string, unknown>): SystemInfo {
  const { os, cpu } = detectOS();
  const ramGb = detectRAM();
  const gpu = detectGPU();
  const ollama = detectOllama();
  const apiProviders = config ? detectAPIProviders(config) : {};
  return { os, cpu, ramGb, ...gpu, ollamaInstalled: ollama.installed, ollamaRunning: ollama.running, installedModels: ollama.models, apiProviders };
}
