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

let generation = 0;
let cached: { gen: number; manifests: SkillManifest[] } | null = null;
let inFlight: Promise<SkillManifest[]> | null = null;
let loader: Loader | null = null;
/** Project root for project-local discovery (<dir>/.alix/skills, first priority). */
let projectDir: string | null = null;

async function defaultLoader(): Promise<SkillManifest[]> {
  const { loadDiscoveredSkillManifests } = await import("./discovery.js");
  // loadDiscoveredSkillManifests returns { manifest, path }[] — the catalog
  // caches bare manifests, so unwrap each entry.
  return (await loadDiscoveredSkillManifests(undefined, projectDir)).map((s) => s.manifest);
}

/**
 * Point slash completion at a project root (or back to null). Bumps the
 * generation only on actual change, so per-tick syncing is cheap. The TUI
 * calls this from its refresh path with the snapshot cwd.
 */
export function setSlashCatalogProjectDir(dir: string | null): void {
  const next = dir ? dir : null;
  if (next === projectDir) return;
  projectDir = next;
  invalidateSlashCatalog();
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
