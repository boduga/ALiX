import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { _setHomedirOverride, loadConfig } from "../../src/config/loader.js";

const dirs: string[] = [];

afterEach(async () => {
  _setHomedirOverride(undefined);
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function emptyWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-warning-"));
  dirs.push(dir);
  _setHomedirOverride(dir);
  return dir;
}

describe("config warning presentation policy", () => {
  it("emits validation warnings by default", async () => {
    const cwd = await emptyWorkspace();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await loadConfig(cwd, { requireModel: false });

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[Config WARN] ui.security.authentication"),
    );
  });

  it("suppresses warnings for presentation-owned composition roots", async () => {
    const cwd = await emptyWorkspace();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await loadConfig(cwd, { requireModel: false, suppressWarnings: true });

    expect(warn).not.toHaveBeenCalled();
  });
});
