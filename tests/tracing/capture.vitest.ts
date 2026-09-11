/**
 * CapturePolicy — pure redaction + truncation semantics (design §6-8).
 *
 * Verifies:
 *   - capture levels: full / truncated / off
 *   - security-critical ordering: mandatory redaction BEFORE truncation
 *   - mandatory redaction cannot be bypassed by `full`
 *   - copy semantics: caller-owned objects/arrays are never mutated
 *   - pattern breadth for the initial detector (sk-/pk-, api_key/api-key/
 *     apikey, Authorization, Bearer, cred://, PEM, OpenAI/Langfuse prefixes)
 *
 * Design: docs/superpowers/specs/2026-09-06-langfuse-tracing-design.md
 * Task: Task 5 of
 *   docs/superpowers/plans/2026-09-06-langfuse-tracing-implementation-plan.md
 */
import { describe, it, expect } from "vitest";
import {
  captureMessages,
  captureString,
  captureToolArgs,
  captureValue,
  redactString,
  type CaptureLevel,
} from "../../src/tracing/capture.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** OpenAI-style key (`sk-proj-` prefix, generic `sk-` shape). */
const SK_PROJ_KEY = `sk-proj-${"A".repeat(40)}`;
/** Anthropic-style key. */
const SK_ANT_KEY = `sk-ant-api03-${"B".repeat(40)}`;
/** Generic `sk-` token without a known prefix label. */
const SK_PLAIN_KEY = `sk-${"C".repeat(36)}`;
/** Langfuse-style keys. */
const SK_LF_KEY = `sk-lf-${"D".repeat(40)}`;
const PK_LF_KEY = `pk-lf-${"E".repeat(40)}`;
/** Bare long token for assignment/header patterns. */
const BARE_TOKEN = "abcdefghijklmnopqrstuvwxyz0123456789";

const PEM_PRIVATE = [
  "-----BEGIN PRIVATE KEY-----",
  "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDa",
  "AA6qAUCXmJqqK9B1Qh1Hp5pPZ3zQaT5R6yUjQm==",
  "-----END PRIVATE KEY-----",
].join("\n");

const PEM_PUBLIC = [
  "-----BEGIN PUBLIC KEY-----",
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu1SU1LfV",
  "wIDAQAB",
  "-----END PUBLIC KEY-----",
].join("\n");

function longText(filler: string, secret: string, secretAt: number): string {
  const head = filler.repeat(secretAt);
  return head + secret + filler.repeat(64);
}

/** Deep-freeze so any mutation by the policy throws in strict mode. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

// ---------------------------------------------------------------------------
// full capture
// ---------------------------------------------------------------------------

describe("captureValue · full", () => {
  it("returns an equal but independent deep copy for benign payloads", () => {
    const input = deepFreeze({
      role: "user",
      content: [
        { type: "text", text: "hello" },
        { type: "image", source: "data:image/png;base64,AAAA", mediaType: "image/png" },
      ],
      nested: { arr: [1, 2, { three: true }] },
    });

    const out = captureValue(input, "full");

    expect(out).toEqual(input);
    expect(out).not.toBe(input);
    const typed = out as typeof input;
    expect(typed.content).not.toBe(input.content);
    expect(typed.content[0]).not.toBe(input.content[0]);
    expect(typed.nested.arr).not.toBe(input.nested.arr);
    // Caller-owned input is untouched (and frozen) — mutating the copy is safe.
    typed.nested.arr.push(4);
    expect(input.nested.arr).toHaveLength(3);
  });

  it("returns primitives unchanged when no secret is present", () => {
    expect(captureValue("plain text", "full")).toBe("plain text");
    expect(captureValue(42, "full")).toBe(42);
    expect(captureValue(true, "full")).toBe(true);
    expect(captureValue(null, "full")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// truncated capture
// ---------------------------------------------------------------------------

describe("captureValue · truncated", () => {
  it("caps each string leaf at maxChars", () => {
    const input = { a: "x".repeat(400), b: ["y".repeat(200)], c: "short" };
    const out = captureValue(input, "truncated", { maxChars: 64 }) as typeof input;

    expect(out.a).toHaveLength(64);
    expect(out.b[0]).toHaveLength(64);
    expect(out.c).toBe("short");
  });

  it("caps arrays at maxItems", () => {
    const out = captureValue([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], "truncated", {
      maxItems: 3,
    }) as number[];
    expect(out).toEqual([0, 1, 2]);
  });

  it("caps object keys at maxProperties", () => {
    const big: Record<string, number> = {};
    for (let i = 0; i < 10; i++) big[`k${i}`] = i;
    const out = captureValue(big, "truncated", { maxProperties: 4 }) as Record<
      string,
      number
    >;
    expect(Object.keys(out)).toEqual(["k0", "k1", "k2", "k3"]);
  });

  it("does not mutate frozen inputs while truncating", () => {
    const input = deepFreeze(["x".repeat(300), { nested: "y".repeat(300) }]);
    const out = captureValue(input, "truncated", { maxChars: 40 }) as string[];

    expect((out[0] as string)).toHaveLength(40);
    expect(((out[1] as unknown) as { nested: string }).nested).toHaveLength(40);
    expect(input[0]).toHaveLength(300);
    expect(input[1]).toEqual({ nested: "y".repeat(300) });
  });
});

// ---------------------------------------------------------------------------
// off capture
// ---------------------------------------------------------------------------

describe("capture · off", () => {
  it("returns undefined for every value shape", () => {
    expect(captureValue({ anything: "sk-xyz" }, "off")).toBeUndefined();
    expect(captureValue("some text", "off")).toBeUndefined();
    expect(captureValue([1, 2, 3], "off")).toBeUndefined();
    expect(captureString("some text", "off")).toBeUndefined();
    expect(
      captureMessages(
        [{ role: "user", content: "hi" }],
        "off",
      ),
    ).toBeUndefined();
    expect(captureToolArgs({ a: 1 }, "off")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// maximum lengths
// ---------------------------------------------------------------------------

describe("maximum lengths", () => {
  it("truncates at exactly maxChars when the string is longer", () => {
    expect(captureString("z".repeat(10_000), "truncated", { maxChars: 123 })).toHaveLength(123);
    expect(captureString("short", "truncated", { maxChars: 123 })).toBe("short");
  });

  it("never exceeds maxChars on nested structures", () => {
    const input = { messages: [{ text: "q".repeat(500) }], flat: "w".repeat(250) };
    const out = captureValue(input, "truncated", { maxChars: 100 }) as typeof input;
    expect(out.messages[0].text).toHaveLength(100);
    expect(out.flat).toHaveLength(100);
  });
});

// ---------------------------------------------------------------------------
// redaction (mandatory, non-disableable)
// ---------------------------------------------------------------------------

describe("redactString · initial pattern coverage", () => {
  const cases: Array<[string, string]> = [
    ["generic sk- token", `use ${SK_PLAIN_KEY} now`],
    ["OpenAI sk-proj- token", `key=${SK_PROJ_KEY}`],
    ["Anthropic sk-ant token", SK_ANT_KEY],
    ["Langfuse secret key", `langfuse secret ${SK_LF_KEY}`],
    ["Langfuse public key", `langfuse public ${PK_LF_KEY}`],
    ["api_key= assignment", `api_key=${BARE_TOKEN}`],
    ["api-key assignment", `api-key = ${BARE_TOKEN}`],
    ["apikey assignment", `apikey: ${BARE_TOKEN}`],
    ["quoted JSON api_key assignment", `{"api_key": "${BARE_TOKEN}"}`],
    ["Authorization header", `Authorization: Bearer ${BARE_TOKEN}`],
    ["proxy-authorization header", `Proxy-Authorization: ${BARE_TOKEN}`],
    ["standalone Bearer token", `please send Bearer ${BARE_TOKEN}`],
    ["cred:// credential reference", `use cred://anthropic/apiKey here`],
    ["PEM private key block", `begin ${PEM_PRIVATE} end`],
    ["PEM public key block", `begin ${PEM_PUBLIC} end`],
  ];

  it.each(cases)("redacts: %s", (_label, input) => {
    const out = redactString(input);
    expect(out).toContain("<redacted>");
    expect(out).not.toBe(input);
  });

  it.each(cases)("does not leak the secret for: %s", (_label, input) => {
    const out = redactString(input);
    // No fixture token substring survives in the output.
    for (const secret of [SK_PROJ_KEY, SK_ANT_KEY, SK_PLAIN_KEY, SK_LF_KEY, PK_LF_KEY, BARE_TOKEN]) {
      expect(out).not.toContain(secret);
    }
  });

  it("leaves benign prose untouched", () => {
    const benign = [
      "The quick brown fox jumps over the lazy dog.",
      "settings: enabled",
      "reference sk-abc (placeholder)",
      "please review the docs and reply",
    ].join("\n");
    expect(redactString(benign)).toBe(benign);
  });
});

describe("redactString · marker", () => {
  it("uses the <redacted> replacement", () => {
    expect(redactString(`token is ${SK_PLAIN_KEY}`)).toContain("<redacted>");
    expect(redactString(`token is ${SK_PLAIN_KEY}`)).not.toContain("[");
  });
});

// ---------------------------------------------------------------------------
// `full` still redacts (mandatory redaction is non-disableable)
// ---------------------------------------------------------------------------

describe("full capture · redaction", () => {
  it("redacts secrets in full capture", () => {
    const out = captureString(`the key is ${SK_PROJ_KEY}`, "full");
    expect(out).toBe(`the key is <redacted>`);
    expect(out).not.toContain(SK_PROJ_KEY);
  });

  it("redacts secrets inside nested objects at full", () => {
    const input = deepFreeze({
      args: { api_key: BARE_TOKEN, note: "hello" },
      headers: { authorization: `Bearer ${BARE_TOKEN}` },
    });
    const out = captureValue(input, "full") as typeof input;
    expect(out).toEqual({
      args: { api_key: "<redacted>", note: "hello" },
      headers: { authorization: "<redacted>" },
    });
    expect(JSON.stringify(out)).not.toContain(BARE_TOKEN);
    // Input remains untouched.
    expect(input.args.api_key).toBe(BARE_TOKEN);
  });
});

// ---------------------------------------------------------------------------
// redaction BEFORE truncation (security-critical ordering)
// ---------------------------------------------------------------------------

describe("redaction-before-truncation ordering", () => {
  it("redacts a secret that lies entirely beyond the truncation boundary", () => {
    // With truncation-first the boundary would sit inside the secret region.
    const filler = "a".repeat(1000);
    const input = filler + " " + SK_PROJ_KEY;
    const out = captureString(input, "truncated", { maxChars: 500 })!;

    expect(out).toHaveLength(500);
    expect(out).not.toContain(SK_PROJ_KEY);
    expect(out).not.toContain("sk-proj-");
    // Truncation-first output would be 500 'a's + a live "sk-proj-…" fragment.
    expect(out.slice(0, 500)).toBe("a".repeat(500));
  });

  it("redacts a secret straddling the truncation boundary", () => {
    // Secret starts BEFORE maxChars and extends past it, so truncation-first
    // would keep a live "sk-proj-…" fragment. Redaction-first replaces the
    // whole token, and the marker sits fully inside the kept prefix.
    const filler = "b".repeat(479);
    const input = `${filler} ${SK_PROJ_KEY} ${"c".repeat(200)}`;
    const out = captureString(input, "truncated", { maxChars: 500 })!;

    expect(out).toHaveLength(500);
    expect(out).not.toContain(SK_PROJ_KEY);
    expect(out).not.toContain("sk-proj-");
    expect(out).toContain("<redacted>");
  });

  it("redacts an api_key assignment straddling the boundary", () => {
    // Label sits before the boundary, the value crosses it. Truncation-first
    // would keep a live `api_key=abcdef…` fragment.
    const filler = "d".repeat(475);
    const input = `${filler} api_key=${BARE_TOKEN} tail`;
    const out = captureString(input, "truncated", { maxChars: 500 })!;

    expect(out.length).toBeLessThanOrEqual(500);
    expect(out).not.toContain(BARE_TOKEN);
    expect(out).not.toContain(BARE_TOKEN.slice(0, 16));
    expect(out).toContain("api_key=");
    expect(out).toContain("<redacted>");
  });

  it("never leaves a raw secret fragment in truncated nested payloads", () => {
    const input = { text: "e".repeat(400) + " " + SK_LF_KEY + "f".repeat(64) };
    const out = captureValue(input, "truncated", { maxChars: 400 }) as { text: string };
    expect(out.text).not.toContain(SK_LF_KEY);
    expect(out.text).not.toContain("sk-lf");
  });
});

// ---------------------------------------------------------------------------
// copy semantics (immutability)
// ---------------------------------------------------------------------------

describe("copy semantics", () => {
  it("returns fresh arrays/objects, never caller-owned references", () => {
    const inner = deepFreeze({ x: 1 });
    const arr = deepFreeze([inner, "y"]);
    const input = deepFreeze({ arr, map: { inner } });

    for (const level of ["full", "truncated"] as CaptureLevel[]) {
      const out = captureValue(input, level) as typeof input;
      expect(out).toEqual(input);
      expect(out).not.toBe(input);
      expect(out.arr).not.toBe(arr);
      expect(out.arr[0]).not.toBe(inner);
      expect(out.map).not.toBe(input.map);
      expect(out.map.inner).not.toBe(inner);
    }
  });

  it("deep-frozen caller objects survive unchanged", () => {
    const input = deepFreeze({
      role: "assistant",
      content: [{ type: "text", text: "reply with " + SK_PLAIN_KEY }],
    });
    const before = JSON.stringify(input);
    captureValue(input, "full");
    captureValue(input, "truncated", { maxChars: 16 });
    expect(JSON.stringify(input)).toBe(before);
    expect(input.content[0].text).toContain(SK_PLAIN_KEY);
  });
});

// ---------------------------------------------------------------------------
// typed helpers (messages / tool args / output text)
// ---------------------------------------------------------------------------

describe("captureMessages", () => {
  const messages = deepFreeze([
    { role: "user" as const, content: "please summarize" },
    {
      role: "assistant" as const,
      content: [
        { type: "text" as const, text: "here is " + SK_PROJ_KEY },
        { type: "image" as const, source: "data:image/png;base64,BBBB", mediaType: "image/png" },
      ],
    },
  ]);

  it("returns a fresh array with role/content structure preserved at full", () => {
    const out = captureMessages(messages, "full")!;
    expect(out).toEqual([
      { role: "user", content: "please summarize" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "here is <redacted>" },
          { type: "image", source: "data:image/png;base64,BBBB", mediaType: "image/png" },
        ],
      },
    ]);
    expect(out).not.toBe(messages);
    expect(out[1]).not.toBe(messages[1]);
    expect(JSON.stringify(out)).not.toContain(SK_PROJ_KEY);
  });

  it("truncates long message text at truncated", () => {
    const long = deepFreeze([
      { role: "user" as const, content: "z".repeat(10_000) },
    ]);
    const out = captureMessages(long, "truncated", { maxChars: 77 })!;
    expect(out[0].content).toHaveLength(77);
    expect(long[0].content).toHaveLength(10_000);
  });

  it("returns undefined at off", () => {
    expect(captureMessages(messages, "off")).toBeUndefined();
  });
});

describe("captureToolArgs", () => {
  it("redacts sensitive keys and values at full", () => {
    const args = deepFreeze({
      command: "ls",
      connection: { password: "hunter2" },
      headers: { "x-api-key": SK_PLAIN_KEY },
    });
    const out = captureToolArgs(args, "full")!;
    expect(out.command).toBe("ls");
    expect(out.connection).toEqual({ password: "<redacted>" });
    expect(out.headers).toEqual({ "x-api-key": "<redacted>" });
    expect(args.connection.password).toBe("hunter2");
  });

  it("truncates argument strings at truncated", () => {
    const args = { input: "y".repeat(999) };
    const out = captureToolArgs(args, "truncated", { maxChars: 32 })!;
    expect(out.input).toHaveLength(32);
  });

  it("returns undefined at off", () => {
    expect(captureToolArgs({ a: 1 }, "off")).toBeUndefined();
  });
});

describe("captureString", () => {
  it("full preserves benign text", () => {
    expect(captureString("hello world", "full")).toBe("hello world");
  });
  it("truncated respects maxChars on benign text", () => {
    expect(captureString("z".repeat(500), "truncated", { maxChars: 25 })).toHaveLength(25);
  });
});
