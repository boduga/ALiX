/**
 * models-doctor.ts — Measure alix models doctor end-to-end.
 */
export async function runModelsDoctorBenchmark(): Promise<void> {
  const { detectSystem } = await import("../../config/hardware-detect.js");
  const { runDoctor } = await import("../../models/model-doctor.js");
  const { loadProfiles } = await import("../../config/profile-registry.js");
  const system = detectSystem();
  const profiles = loadProfiles();
  runDoctor(system, {}, profiles);
}
