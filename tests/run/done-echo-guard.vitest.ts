import { describe, expect, it } from "vitest";
import {
  claimsArtifactWritten,
  lastToolResultShowsClientError,
} from "../../src/run/task-loop.js";

const user = (content: string) => ({ role: "user", content });

describe("lastToolResultShowsClientError", () => {
  it("flags the most recent tool_result that is an HTTP client error", () => {
    const messages = [
      user("investigate the workspace"),
      user("<tool_result>HTTP/2 403 \r\ncache-control: private\r\nexit=0</tool_result>"),
    ];
    expect(lastToolResultShowsClientError(messages)).toBe(true);
  });

  it("flags command-failure shapes (denied / failed / timeout)", () => {
    expect(
      lastToolResultShowsClientError([user("<tool_result>Access denied: no approval store</tool_result>")]),
    ).toBe(true);
    expect(
      lastToolResultShowsClientError([user("<tool_result>command failed with exit 1</tool_result>")]),
    ).toBe(true);
    expect(
      lastToolResultShowsClientError([user("<tool_result>timed out after 180000ms</tool_result>")]),
    ).toBe(true);
  });

  it("does not flag clean tool results", () => {
    expect(
      lastToolResultShowsClientError([user("<tool_result>hi there</tool_result>")]),
    ).toBe(false);
    expect(
      lastToolResultShowsClientError([user("no tool result here")]),
    ).toBe(false);
  });

  it("only inspects the most recent tool_result (a prior error is stale)", () => {
    const messages = [
      user("<tool_result>HTTP/2 403 denied</tool_result>"),
      user("<tool_result>file written ok: 12 bytes</tool_result>"),
    ];
    expect(lastToolResultShowsClientError(messages)).toBe(false);
  });
});

describe("claimsArtifactWritten", () => {
  it("accepts when files changed this session", () => {
    expect(claimsArtifactWritten("All tasks are complete.", 3)).toBe(true);
  });

  it("accepts a reply that names the artifact it wrote", () => {
    expect(claimsArtifactWritten("I wrote response.md and verified it.", 0)).toBe(true);
    expect(claimsArtifactWritten("Created the file hello.txt", 0)).toBe(true);
  });

  it("rejects an error-echo summary with no artifact claim", () => {
    expect(
      claimsArtifactWritten("HTTP/2 403 \r\ncache-control: private, no-store\r\nexit=0", 0),
    ).toBe(false);
  });
});
