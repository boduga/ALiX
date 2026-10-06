import { join } from "node:path";
import { existsSync, rmSync, mkdirSync } from "node:fs";

const originalHome = process.env.HOME;

/**
 * Point HOME at a test dir and ensure ~/.alix/skills exists. Shared by the
 * install and marketplace test files so every HOME-dependent describe uses the
 * same isolation pattern (save original HOME, set per-test, restore after).
 */
export function useTestHome(testDir: string): void {
  process.env.HOME = testDir;
  mkdirSync(join(testDir, ".alix", "skills"), { recursive: true });
}

/** Remove the test dir and restore the original HOME so no state leaks across describes. */
export function restoreTestHome(testDir: string): void {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
}

/** Minimal valid SKILL.md body for a skill named `name`. */
export function skillBody(name: string): string {
  return `---\nname: ${name}\ndescription: ${name} test skill\n---\nBody.\n`;
}

/** GitHub trees-API response bearing the given blob paths. */
export function treeResponse(entries: { path: string }[]): Response {
  return new Response(
    JSON.stringify({
      sha: "abc",
      url: "u",
      tree: entries.map((e) => ({
        path: e.path,
        mode: "100644",
        type: "blob",
        sha: "s",
        url: "u",
        size: 1,
      })),
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/**
 * Mock fetch so api.github.com returns `tree` and raw URLs return `raw`
 * bodies (404 otherwise). Pass `counter` to count calls.
 */
export function mockFetch(
  tree: { path: string }[],
  raw: Record<string, string>,
  counter?: { calls: number },
): void {
  globalThis.fetch = (async (input: unknown) => {
    if (counter) counter.calls++;
    const url = String(input);
    if (url.includes("api.github.com")) return treeResponse(tree);
    for (const [key, body] of Object.entries(raw)) {
      if (url.includes(key)) {
        return new Response(body, { status: 200, headers: { "content-type": "text/markdown" } });
      }
    }
    return new Response("404: Not Found", { status: 404, headers: { "content-type": "text/plain" } });
  }) as typeof fetch;
}
