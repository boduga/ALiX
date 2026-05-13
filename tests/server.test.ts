import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../src/server/server.js";

test("serves inspector html", async () => {
  const server = await startServer(process.cwd(), 0);
  try {
    const response = await fetch(server.url);
    const text = await response.text();
    assert.match(text, /ALiX Inspector/);
  } finally {
    await server.close();
  }
});
