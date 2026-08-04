import { join } from "node:path";
import { homedir } from "node:os";
import type { SkillManifest } from "./types.js";

/**
 * Generation-based cache for the installed-skill manifest list. The TUI reads
 * this for slash-command completion so typing never touches the filesystem.
 *
 * Lifecycle:
 *   startup              → build once (gen N)
 *   skill install/remove → invalidateSlashCatalog() (gen N+1)
 *   completion / enter   → read cached list (pure in-memory)
 *
 * Race-safety: every build captures the generation it was built at. If a build
 * started before an invalidation and resolves after it, its captured
 * generation ≠ current, so it is discarded and the caller reloads.
 */

type Loader = () => Promise<SkillManifest[]>;

const skillsHome = () => join(homedir(), ".alix", "skills");

let generation = 0;
let cached: { gen: number; manifests: SkillManifest[] } | null = null;
let inFlight: Promise<SkillManifest[]> | null = null;
let loader: Loader | null = null;

async function defaultLoader(): Promise<SkillManifest[]> {
  const { loadSkillManifests } = await import("./loader.js");
  // loadSkillManifests returns { manifest, path }[] — the catalog caches bare
  // manifests, so unwrap each entry.
  return (await loadSkillManifests(skillsHome())).map((s) => s.manifest);
}

/** Test seam — replace the loader (or restore the default with null). */
export function setSlashCatalogLoaderForTest(fn: Loader | null): void {
  loader = fn;
  invalidateSlashCatalog();
}

export function invalidateSlashCatalog(): void {
  generation++;
  cached = null;
  inFlight = null;
}

export async function getSlashCatalog(): Promise<SkillManifest[]> {
  if (cached && cached.gen === generation) return cached.manifests;
  // Serialize concurrent builds so the filesystem is touched at most once per
  // generation, even under bursts.
  if (!inFlight) {
    const buildGen = generation;
    inFlight = (loader ?? defaultLoader)()
      .then(async (manifests) => {
        // Discard a result that resolves after the generation moved while we
        // built, and reload under the current generation.
        if (buildGen !== generation) return getSlashCatalog();
        cached = { gen: buildGen, manifests };
        return cached.manifests;
      })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}
