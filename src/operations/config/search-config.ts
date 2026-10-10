// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * search-config.ts — web-search provider selection (user-local infra).
 *
 * Read from the `search` section of the user config
 * (`~/.config/alix/config.json`), e.g.:
 *
 *   { "search": { "provider": "searxng", "searxngBaseUrl": "http://10.1.1.160:8080" } }
 *
 * Defaults to `{ provider: "brave" }`. Unknown provider values fall back to
 * Brave so a typo never breaks search entirely. Never throws — missing files /
 * malformed JSON resolve to the default.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolveUserConfigPath } from "./user-config-path.js";

export type SearchProvider = "brave" | "searxng";

export type SearchConfig = {
  provider: SearchProvider;
  searxngBaseUrl?: string;
  /** Optional engine pin, e.g. "bing,wikipedia" (instance defaults when unset). */
  searxngEngines?: string;
};

export async function getSearchConfig(): Promise<SearchConfig> {
  const path = resolveUserConfigPath();
  if (!existsSync(path)) return { provider: "brave" };
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as { search?: Partial<SearchConfig> };
    const provider = parsed.search?.provider;
    return {
      provider: provider === "searxng" ? "searxng" : "brave",
      ...(typeof parsed.search?.searxngBaseUrl === "string" && parsed.search.searxngBaseUrl.length > 0
        ? { searxngBaseUrl: parsed.search.searxngBaseUrl.replace(/\/+$/, "") }
        : {}),
      ...(typeof parsed.search?.searxngEngines === "string" && parsed.search.searxngEngines.length > 0
        ? { searxngEngines: parsed.search.searxngEngines }
        : {}),
    };
  } catch {
    return { provider: "brave" };
  }
}
