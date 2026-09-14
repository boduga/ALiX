import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  JsonlStore,
  parseJsonl,
  parseJsonlLine,
  streamJsonlLines,
  writeJsonFileAtomic,
  readJsonFile,
  writeJsonFileAtomicSync,
  readJsonFileSync,
} from "../../src/storage/jsonl-store.js";

describe("jsonl-store (#712)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "jsonl-store-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("parseJsonl skips blanks and counts malformed", () => {
    const { records, malformed } = parseJsonl<{ a: number }>(
      '{"a":1}\n\nnot-json\n{"a":2}\n',
    );
    assert.deepEqual(records, [{ a: 1 }, { a: 2 }]);
    assert.equal(malformed, 1);
  });

  it("parseJsonlLine applies an optional validator", () => {
    const isA = (v: unknown): v is { a: number } =>
      typeof v === "object" && v !== null && typeof (v as any).a === "number";
    assert.deepEqual(parseJsonlLine('{"a":1}', isA), { record: { a: 1 } });
    assert.deepEqual(parseJsonlLine('{"a":"x"}', isA), { malformed: true });
  });

  it("JsonlStore roundtrips records, creating dirs on demand", async () => {
    const store = new JsonlStore(join(dir, "sub", "log.jsonl"));
    await store.appendRecord({ id: 1 });
    await store.appendRecord({ id: 2 });
    const { records, malformed } = await store.readRecords<{ id: number }>();
    assert.deepEqual(records, [{ id: 1 }, { id: 2 }]);
    assert.equal(malformed, 0);
  });

  it("readRecords returns empty on a missing file", async () => {
    const store = new JsonlStore(join(dir, "nope.jsonl"));
    assert.deepEqual(await store.readRecords(), { records: [], malformed: 0 });
    assert.equal(await store.readText(), null);
    assert.equal(await store.readLastLine(), null);
  });

  it("readLastLine returns the final non-blank line", async () => {
    const store = new JsonlStore(join(dir, "log.jsonl"));
    await store.appendRecord({ n: 1 });
    await store.appendRecord({ n: 2 });
    const last = await store.readLastLine();
    assert.ok(last?.includes('"n":2'));
  });

  it("streamJsonlLines yields physical lines with numbers", async () => {
    const path = join(dir, "s.jsonl");
    writeFileSync(path, '{"a":1}\n\nbroken\n{"a":2}\n');
    const seen: Array<{ line: string; lineNumber: number }> = [];
    for await (const entry of streamJsonlLines(path)) seen.push(entry);
    assert.equal(seen.length, 4);
    assert.deepEqual(seen.map((s) => s.lineNumber), [1, 2, 3, 4]);
  });

  it("writeJsonFileAtomic/readJsonFile roundtrip", async () => {
    const path = join(dir, "deep", "doc.json");
    await writeJsonFileAtomic(path, { x: [1, 2] });
    assert.deepEqual(await readJsonFile(path), { x: [1, 2] });
    assert.equal(await readJsonFile(join(dir, "missing.json")), null);
  });

  it("sync variants roundtrip and throw on corrupt content", async () => {
    const path = join(dir, "sync.json");
    writeJsonFileAtomicSync(path, { y: true });
    assert.deepEqual(readJsonFileSync(path), { y: true });
    assert.equal(readJsonFileSync(join(dir, "missing.json")), null);
    writeFileSync(path, "{oops");
    assert.throws(() => readJsonFileSync(path), SyntaxError);
  });
});
