/**
 * P4.3-Sa1 — Redaction Foundation
 *
 * Pattern-based secret detector that emits `SecretSpan` results without
 * exposing raw source context.  Replaces the older `SecretScanner` which
 * leaked the source line through its `context` field.
 *
 * Every pattern is bounded (no nested quantifiers, length-limited) and
 * the global / lastIndex on all regex objects is reset before each scan.
 *
 * @module
 */

import {
  type RedactionClassification,
  MAX_STRING_SCAN,
} from "./classifications.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A span within the input that matches a secret pattern.
 *
 * Unlike `SecretFinding` from the legacy scanner, `SecretSpan` never
 * carries a raw source-context line.
 */
export interface SecretSpan {
  /** Inclusive start offset in the input string. */
  start: number;
  /** Exclusive end offset in the input string. */
  end: number;
  /** Classification label. */
  classification: RedactionClassification;
  /**
   * Confidence level.
   * - `"high"` — near-certain match (e.g. structured API key format).
   * - `"medium"` — likely match (e.g. generic long alphanumeric).
   * - `"low"` — weak signal (e.g. entropy-based heuristic).
   */
  confidence: "high" | "medium" | "low";
}

/** Options for constructing a `SecretDetector`. */
export interface SecretDetectorOptions {
  /**
   * Enable entropy-based (high-entropy) detection.
   * Disabled by default because of false-positive risk.
   * @default false
   */
  enableHighEntropy?: boolean;

  /**
   * Custom patterns to scan for in addition to the built-in patterns.
   */
  customPatterns?: {
    pattern: RegExp;
    classification: RedactionClassification;
  }[];
}

// ---------------------------------------------------------------------------
// Built-in patterns
// ---------------------------------------------------------------------------

/**
 * A registered detector pattern.
 * @internal
 */
interface RegisteredPattern {
  pattern: RegExp;
  classification: RedactionClassification;
  confidence: "high" | "medium" | "low";
}

/**
 * Create the default set of built-in patterns.
 * Exported as a factory so tests can inspect what is registered.
 */
export function createDefaultPatterns(): RegisteredPattern[] {
  return [
    // -- API keys (high confidence) ---------------------------------------
    { pattern: /sk-[A-Za-z0-9_\-]{16,}/g, classification: "api_key", confidence: "high" },
    { pattern: /AIza[0-9A-Za-z_-]{30,}/g, classification: "api_key", confidence: "high" },
    { pattern: /sk-ant-[A-Za-z0-9_\-]{30,}/g, classification: "api_key", confidence: "high" },

    // -- AWS (high confidence) ---------------------------------------------
    { pattern: /AKIA[0-9A-Z]{16}/g, classification: "aws_access_key", confidence: "high" },
    { pattern: /ASIA[0-9A-Z]{16}/g, classification: "aws_access_key", confidence: "high" },

    // -- GitHub (high confidence) ------------------------------------------
    { pattern: /ghp_[A-Za-z0-9_]{36,}/g, classification: "api_key", confidence: "high" },
    { pattern: /gho_[A-Za-z0-9_]{36,}/g, classification: "api_key", confidence: "high" },
    { pattern: /ghu_[A-Za-z0-9_]{36,}/g, classification: "api_key", confidence: "high" },
    { pattern: /ghs_[A-Za-z0-9_]{36,}/g, classification: "api_key", confidence: "high" },
    { pattern: /ghr_[A-Za-z0-9_]{36,}/g, classification: "api_key", confidence: "high" },

    // -- Slack tokens (high confidence) ------------------------------------
    { pattern: /xox[baprs]-[A-Za-z0-9_\-]{10,}/g, classification: "bearer_token", confidence: "high" },

    // -- Bearer tokens (medium confidence) ---------------------------------
    { pattern: /(?<![a-zA-Z0-9])[bB]earer\s+[A-Za-z0-9_\-\.]{10,}/g, classification: "bearer_token", confidence: "medium" },

    // -- Basic auth (high confidence) --------------------------------------
    { pattern: /[bB]asic\s+[A-Za-z0-9+/=]{10,}/g, classification: "basic_auth", confidence: "high" },

    // -- Auth / Cookie header values (medium confidence) -------------------
    { pattern: /(?:Authorization|Proxy-Authorization|Cookie|Set-Cookie):\s*.{1,256}/gi, classification: "auth_header", confidence: "medium" },

    // -- JWT (high confidence) ---------------------------------------------
    { pattern: /eyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g, classification: "jwt", confidence: "high" },

    // -- PEM private keys (high confidence) --------------------------------
    { pattern: /-----BEGIN\s+(?:(?:RSA|DSA|EC|OPENSSH)\s+)?PRIVATE\s+KEY-----[\s\S]{1,8192}?-----END\s+(?:(?:RSA|DSA|EC|OPENSSH)\s+)?PRIVATE\s+KEY-----/g, classification: "private_key", confidence: "high" },

    // -- Credential URLs (high confidence) ---------------------------------
    { pattern: /https?:\/\/[^\/\s@]+:[^\/\s@]+@[^\/\s]+/g, classification: "credential_url", confidence: "high" },
    { pattern: /https?:\/\/[^\/\s@]+@[^\/\s]+/g, classification: "credential_url", confidence: "medium" },

    // -- Password assignments (medium confidence) --------------------------
    { pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/gi, classification: "password", confidence: "medium" },

    // -- Connection strings (medium confidence) ----------------------------
    { pattern: /(?:mongodb|postgresql|mysql|redis):\/\/[^\s]{4,}/gi, classification: "connection_string", confidence: "medium" },
  ];
}

// ---------------------------------------------------------------------------
// Entropy helpers (for high-entropy detection)
// ---------------------------------------------------------------------------

/**
 * Compute Shannon entropy of a string.
 * @internal
 */
function shannonEntropy(s: string): number {
  const len = s.length;
  if (len === 0) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

// ---------------------------------------------------------------------------
// SecretDetector
// ---------------------------------------------------------------------------

/**
 * Non-throwing, pattern-based secret detector.
 *
 * Usage:
 * ```ts
 * const detector = new SecretDetector();
 * const spans = detector.detect("sk-abc123...");
 * ```
 *
 * Regex safety is provided by:
 * - Input-size limits (`MAX_STRING_SCAN` caps the input at 65536 bytes).
 * - All patterns are bounded (no nested quantifiers).
 * - A max-iteration ceiling (1000) per pattern prevents runaway global matching.
 */
export class SecretDetector {
  private readonly patterns: RegisteredPattern[];
  private readonly enableHighEntropy: boolean;

  constructor(options: SecretDetectorOptions = {}) {
    this.enableHighEntropy = options.enableHighEntropy ?? false;

    // Build pattern list
    this.patterns = [...createDefaultPatterns()];

    // Append custom patterns
    if (options.customPatterns) {
      for (const cp of options.customPatterns) {
        this.patterns.push({
          pattern: cp.pattern,
          classification: cp.classification,
          confidence: "medium",
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Scan `input` for secret patterns and return the matching spans.
   *
   * **Never throws.**  Returns an empty array on invalid input or
   * internal errors.
   *
   * Input is truncated at `MAX_STRING_SCAN` (65536) bytes.
   */
  detect(input: unknown): SecretSpan[] {
    try {
      if (typeof input !== "string") return [];
      if (input.length === 0) return [];

      // Enforce input size limit
      const safeInput = input.length > MAX_STRING_SCAN
        ? input.slice(0, MAX_STRING_SCAN)
        : input;

      const spans: SecretSpan[] = [];

      // Run built-in + custom patterns
      for (const rp of this.patterns) {
        this.runPattern(rp, safeInput, spans);
      }

      // Optional high-entropy detection
      if (this.enableHighEntropy) {
        this.detectHighEntropy(safeInput, spans);
      }

      // Deduplicate: merge overlapping spans
      return this.mergeSpans(spans);
    } catch {
      return [];
    }
  }

  /**
   * Return a copy of the registered patterns (for testing / inspection).
   */
  static getDefaultPatterns(): { pattern: RegExp; classification: RedactionClassification; confidence: string }[] {
    return createDefaultPatterns().map((rp) => ({
      pattern: rp.pattern,
      classification: rp.classification,
      confidence: rp.confidence,
    }));
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Run a single pattern against the input and collect spans.
   *
   * Regex safety is provided by input-size limits and safe pattern design
   * (no nested quantifiers).  The max-iteration ceiling (1000) prevents
   * runaway global matching.
   */
  private runPattern(
    rp: RegisteredPattern,
    input: string,
    out: SecretSpan[],
  ): void {
    const re = new RegExp(rp.pattern.source, rp.pattern.flags);
    re.lastIndex = 0;

    for (let i = 0; i < 1000; i++) {
      const match = re.exec(input);
      if (match === null) break;

      out.push({
        start: match.index,
        end: match.index + match[0].length,
        classification: rp.classification,
        confidence: rp.confidence,
      });

      // Avoid infinite loop on zero-length matches
      if (match[0].length === 0) {
        re.lastIndex++;
      }
    }
  }

  /**
   * Heuristic high-entropy detection.
   * Scans for long alphanumeric tokens with entropy > 4.0.
   */
  private detectHighEntropy(input: string, out: SecretSpan[]): void {
    // Match contiguous alphanumeric chunks of at least 20 chars
    const highEntropyRe = /[A-Za-z0-9_\-]{20,}/g;
    let m: RegExpExecArray | null;
    while ((m = highEntropyRe.exec(input)) !== null) {
      const token = m[0];
      if (shannonEntropy(token) > 4.0) {
        out.push({
          start: m.index,
          end: m.index + token.length,
          classification: "generic_secret",
          confidence: "low",
        });
      }
    }
  }

  /**
   * Merge overlapping or adjacent spans.
   * Sorting by start offset, then extending as needed.
   */
  private mergeSpans(spans: SecretSpan[]): SecretSpan[] {
    if (spans.length <= 1) return spans;

    const sorted = [...spans].sort((a, b) => a.start - b.start);
    const merged: SecretSpan[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const last = merged[merged.length - 1];
      const cur = sorted[i];

      if (cur.start <= last.end) {
        // Overlap or adjacency: extend the last span
        last.end = Math.max(last.end, cur.end);
        // Prefer higher confidence
        const confOrder = ["high", "medium", "low"];
        if (confOrder.indexOf(cur.confidence) < confOrder.indexOf(last.confidence)) {
          last.confidence = cur.confidence;
        }
      } else {
        merged.push(cur);
      }
    }

    return merged;
  }
}
