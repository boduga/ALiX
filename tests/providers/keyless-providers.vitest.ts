/**
 * keyless-providers.vitest.ts — Unit tests for the single source of truth
 * that decides which providers run without an API key.
 *
 * Verifies: the shared set already contains the known local/mock providers;
 * isKeylessProvider is true for members and false for keyed providers.
 */

import { describe, it, expect } from "vitest";
import {
  KEYLESS_PROVIDERS,
  isKeylessProvider,
} from "../../src/providers/keyless-providers.js";

describe("keyless-providers", () => {
  it("includes the known keyless providers", () => {
    expect(KEYLESS_PROVIDERS).toContain("ollama");
    expect(KEYLESS_PROVIDERS).toContain("local-llama");
    expect(KEYLESS_PROVIDERS).toContain("mock");
  });

  it("returns true for keyless providers", () => {
    expect(isKeylessProvider("local-llama")).toBe(true);
    expect(isKeylessProvider("ollama")).toBe(true);
  });

  it("returns false for api-key providers", () => {
    expect(isKeylessProvider("openai")).toBe(false);
    expect(isKeylessProvider("anthropic")).toBe(false);
  });
});
