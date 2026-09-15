import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { resolveDaemonSocketAddress, isNamedPipe } from "../../src/daemon/daemon-paths.js";

test("resolveDaemonSocketAddress: POSIX is a Unix socket file under the dir", () => {
  const addr = resolveDaemonSocketAddress("/home/u/.alix", "linux");
  assert.equal(addr, join("/home/u/.alix", "alixd.sock"));
  assert.equal(isNamedPipe(addr), false);
});

test("resolveDaemonSocketAddress: Windows is a named pipe, not a file path", () => {
  const addr = resolveDaemonSocketAddress("C:\\Users\\u\\.alix", "win32");
  assert.ok(addr.startsWith("\\\\.\\pipe\\alixd-"), addr);
  assert.equal(isNamedPipe(addr), true);
});

test("resolveDaemonSocketAddress: distinct dirs get distinct Windows pipes", () => {
  const a = resolveDaemonSocketAddress("C:\\Users\\u\\.alix", "win32");
  const b = resolveDaemonSocketAddress("C:\\Users\\other\\.alix", "win32");
  assert.notEqual(a, b);
  // stable for the same input
  assert.equal(a, resolveDaemonSocketAddress("C:\\Users\\u\\.alix", "win32"));
});

test("isNamedPipe recognizes both slash forms", () => {
  assert.equal(isNamedPipe("\\\\.\\pipe\\x"), true);
  assert.equal(isNamedPipe("//./pipe/x"), true);
  assert.equal(isNamedPipe("/home/u/.alix/alixd.sock"), false);
});
