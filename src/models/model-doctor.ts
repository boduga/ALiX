/**
 * model-doctor.ts — Diagnose system health, provider status, and profile compatibility.
 */

import type { ProfileData } from "../config/profile-types.js";
import { matchHardware, type SystemInfo } from "../config/profile-registry.js";

export type DoctorSection = { title: string; items: string[] };
export type DoctorIssue = { severity: "error" | "warning" | "info"; message: string };
export type ProfileCompatEntry = { id: string; name: string; status: "compatible" | "partial" | "incompatible"; reason?: string };

export type DoctorReport = {
  sections: DoctorSection[];
  profileCompatibility: ProfileCompatEntry[];
  issues: DoctorIssue[];
  nextStep?: string;
};

export function runDoctor(
  system: SystemInfo,
  config: Record<string, unknown>,
  profiles: ProfileData[],
  activeProfileId?: string,
): DoctorReport {
  const sections: DoctorSection[] = [];
  const issues: DoctorIssue[] = [];
  const profileCompatibility: ProfileCompatEntry[] = [];

  const hwItems = [
    `OS: ${system.os === "macos" ? "macOS" : system.os} ${system.cpu}`,
    `RAM: ${system.ramGb > 0 ? `${system.ramGb} GB` : "unknown"}`,
  ];
  if (system.hasGpu) {
    hwItems.push(`GPU: ${system.gpuName || "detected"}`);
    if (system.vramGb) hwItems.push(`VRAM: ${system.vramGb} GB`);
  } else {
    hwItems.push("GPU: none detected");
  }
  sections.push({ title: "Hardware", items: hwItems });
  if (system.ramGb <= 0) issues.push({ severity: "warning", message: "Could not detect system RAM." });

  const rtItems: string[] = [];
  if (system.ollamaInstalled) {
    rtItems.push(system.ollamaRunning ? "Ollama: running" : "Ollama: installed but not running");
    if (system.installedModels.length > 0) {
      rtItems.push("Installed models:");
      rtItems.push(...system.installedModels.map(m => `  ${m}`));
    } else {
      rtItems.push("  No models installed.");
    }
  } else {
    rtItems.push("Ollama: not found");
  }
  sections.push({ title: "Local Runtime", items: rtItems });
  if (!system.ollamaInstalled) {
    issues.push({ severity: "info", message: "Ollama not detected. Install from https://ollama.com for local model support." });
  } else if (!system.ollamaRunning) {
    issues.push({ severity: "warning", message: "Ollama is installed but not running. Start it with: ollama serve" });
  }

  const provItems: string[] = [];
  for (const [name, info] of Object.entries(system.apiProviders)) {
    const status = !info.configured ? "not configured" : !info.hasKey ? "missing key" : "configured";
    provItems.push(`${name}: ${status}`);
    if (info.configured && !info.hasKey) {
      issues.push({ severity: "warning", message: `${name} provider referenced in config but ${name.toUpperCase()}_API_KEY is missing.` });
    }
  }
  if (Object.keys(system.apiProviders).length > 0) sections.push({ title: "API Providers", items: provItems });

  for (const profile of profiles) {
    const match = matchHardware(profile, system);
    let reason: string | undefined;
    if (match === "compatible" && (profile.mode === "cloud-only" || profile.mode === "cloud-first")) reason = "API keys configured";
    else if (match === "partial") {
      if (profile.mode === "local-first" && !system.ollamaRunning) reason = "Ollama not running";
      else if (system.ramGb < profile.hardware.recommendedRamGb) reason = `RAM below recommended ${profile.hardware.recommendedRamGb} GB`;
    } else if (match === "incompatible") {
      if (system.ramGb < profile.hardware.minRamGb) reason = `Requires ${profile.hardware.minRamGb} GB RAM (detected ${system.ramGb} GB)`;
      else if (profile.hardware.requiresGpu && !system.hasGpu) reason = "Requires GPU";
    }
    profileCompatibility.push({ id: profile.id, name: profile.name, status: match, reason });
  }

  if (activeProfileId) {
    const active = profiles.find(p => p.id === activeProfileId);
    if (active && matchHardware(active, system) === "incompatible") {
      issues.push({ severity: "warning", message: `Active profile "${activeProfileId}" is incompatible with current hardware. Consider switching.` });
    }
  }

  return { sections, profileCompatibility, issues, nextStep: issues.length === 0 ? undefined : "Run: alix models fit" };
}
