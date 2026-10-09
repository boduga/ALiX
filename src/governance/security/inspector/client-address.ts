/**
 * P4.3-Sc1.3 — Client Address Resolution with Trusted Proxy Support
 *
 * Resolves the effective client address from socket information and
 * forwarding headers, applying CIDR-based proxy trust.
 *
 * Key invariants:
 * - Forwarding headers are only trusted when the immediate peer is
 *   within an explicitly configured CIDR range.
 * - Forwarded chain length is bounded (max 4 hops).
 * - Malformed forwarding headers are rejected.
 * - `trustedProxy: true` (trust-all) is NOT supported.
 * - IPv4 and IPv6 addresses are normalized for consistent comparison.
 *
 * @module
 */

import type { IncomingMessage } from "node:http";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClientAddressResult {
  /** The resolved client address (IPv4 or IPv6 string). */
  address: string;
  /** The immediate peer address (socket remoteAddress). */
  peer: string;
  /** Whether the address was derived from a trusted forwarding header. */
  fromProxy: boolean;
  /** The number of proxy hops (0 = direct connection). */
  proxyHops: number;
}

/**
 * Result of proxy trust evaluation for diagnostics (doctor).
 */
export interface ProxyTrustDiagnostic {
  /** Configured trusted CIDRs. */
  trustedCidrs: string[];
  /** Whether any trusted CIDRs are configured. */
  proxyTrustConfigured: boolean;
  /** Whether the immediate peer is behind a trusted proxy. */
  peerIsTrusted: boolean | null;
  /** Warnings from CIDR parsing. */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// CIDR parsing
// ---------------------------------------------------------------------------

/**
 * A parsed CIDR range with network address and prefix length.
 */
interface CidrRange {
  /** Network address as an array of octets (IPv4) or hextets (IPv6). */
  network: number[];
  /** Prefix length (0-32 for IPv4, 0-128 for IPv6). */
  prefixLen: number;
  /** Whether this is an IPv6 CIDR. */
  isV6: boolean;
}

/**
 * Parse an IPv4 address into an array of 4 octets.
 * Returns null on invalid input.
 */
function parseIPv4(addr: string): number[] | null {
  const parts = addr.split(".");
  if (parts.length !== 4) return null;

  const octets: number[] = [];
  for (const p of parts) {
    const n = parseInt(p, 10);
    if (isNaN(n) || n < 0 || n > 255 || String(n) !== p) return null;
    octets.push(n);
  }
  return octets;
}

/**
 * Parse an IPv6 address into an array of 8 hextets (full expansion).
 * Returns null on invalid input.
 */
function parseIPv6(addr: string): number[] | null {
  // Handle :: compression
  let expanded = addr.toLowerCase();

  // Handle IPv4-mapped IPv6 (::ffff:1.2.3.4)
  const v4MapMatch = expanded.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4MapMatch) {
    const v4Octets = parseIPv4(v4MapMatch[2]);
    if (!v4Octets) return null;
    const prefix = v4MapMatch[1];
    const v6Part = (v4Octets[0] << 8) | v4Octets[1];
    const v4Part = (v4Octets[2] << 8) | v4Octets[3];
    expanded = `${prefix}${v6Part.toString(16)}:${v4Part.toString(16)}`;
  }

  if (expanded.includes("::")) {
    const [left, right] = expanded.split("::");
    const leftParts = left ? left.split(":").filter(Boolean) : [];
    const rightParts = right ? right.split(":").filter(Boolean) : [];
    const missing = 8 - leftParts.length - rightParts.length;
    if (missing < 0) return null;
    expanded = [
      ...leftParts,
      ...Array(missing).fill("0"),
      ...rightParts,
    ].join(":");
  }

  const parts = expanded.split(":");
  if (parts.length !== 8) return null;

  const hextets: number[] = [];
  for (const p of parts) {
    const n = parseInt(p, 16);
    if (isNaN(n) || n < 0 || n > 0xffff) return null;
    hextets.push(n);
  }
  return hextets;
}

/**
 * Parse a CIDR string (e.g., "10.0.0.0/8" or "fd00::/8") into a CidrRange.
 * Returns null on invalid input.
 */
export function parseCidr(cidr: string): CidrRange | null {
  const trimmed = cidr.trim();
  const slashIdx = trimmed.lastIndexOf("/");
  if (slashIdx === -1) return null;

  const addrStr = trimmed.slice(0, slashIdx);
  const prefixStr = trimmed.slice(slashIdx + 1);
  const prefixLen = parseInt(prefixStr, 10);

  if (isNaN(prefixLen)) return null;

  // Detect IPv4 vs IPv6
  const v4Parts = parseIPv4(addrStr);
  if (v4Parts) {
    if (prefixLen < 0 || prefixLen > 32) return null;
    return { network: v4Parts, prefixLen, isV6: false };
  }

  // Handle bracketed IPv6 in CIDR
  let cleanAddr = addrStr;
  if (cleanAddr.startsWith("[") && cleanAddr.endsWith("]")) {
    cleanAddr = cleanAddr.slice(1, -1);
  }

  const v6Parts = parseIPv6(cleanAddr);
  if (v6Parts) {
    if (prefixLen < 0 || prefixLen > 128) return null;
    return { network: v6Parts, prefixLen, isV6: true };
  }

  return null;
}

/**
 * Check whether an address is within a CIDR range.
 */
function addressInCidr(addrParts: number[], cidr: CidrRange): boolean {
  if (addrParts.length !== cidr.network.length) return false;

  const prefixBytes = Math.floor(cidr.prefixLen / 8);
  const remainderBits = cidr.prefixLen % 8;

  // Check full bytes
  for (let i = 0; i < prefixBytes; i++) {
    if (addrParts[i] !== cidr.network[i]) return false;
  }

  // Check partial byte
  if (remainderBits > 0) {
    const mask = 0xff << (8 - remainderBits);
    if ((addrParts[prefixBytes] & mask) !== (cidr.network[prefixBytes] & mask)) {
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Address normalization
// ---------------------------------------------------------------------------

/**
 * Normalize an IP address for comparison.
 *
 * - IPv4: standard dotted-quad
 * - IPv6: fully expanded, lowercase, no leading zeros
 * - IPv4-mapped IPv6 (::ffff:x.x.x.x) → IPv4 string
 */
export function normalizeAddress(addr: string): string {
  const trimmed = addr.trim().toLowerCase();

  // IPv4-mapped IPv6 → extract IPv4
  const v4MapMatch = trimmed.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4MapMatch) return v4MapMatch[1];

  // IPv4
  const v4 = parseIPv4(trimmed);
  if (v4) return v4.join(".");

  // IPv6
  const v6 = parseIPv6(trimmed);
  if (v6) {
    return v6.map((h) => h.toString(16)).join(":");
  }

  // Unknown — return as-is (lowercase)
  return trimmed;
}

// ---------------------------------------------------------------------------
// X-Forwarded-For chain parsing
// ---------------------------------------------------------------------------

/** Maximum number of proxy hops we trust. */
const MAX_PROXY_HOPS = 4;

/**
 * Parse and validate the X-Forwarded-For header chain.
 *
 * The header format is: client, proxy1, proxy2, ...
 * Returns the leftmost (client) address if the chain is valid.
 * Returns null if the header is malformed or too long.
 */
export function parseForwardedChain(xffHeader: string): {
  client: string;
  chain: string[];
} | null {
  const parts = xffHeader.split(",").map((p) => p.trim()).filter(Boolean);

  if (parts.length === 0) return null;
  if (parts.length > MAX_PROXY_HOPS + 1) return null; // too many hops

  // Validate each address looks like an IP
  for (const part of parts) {
    // Quick validation: must not contain obviously bad characters
    if (part.includes("(") || part.includes(")") || part.includes("<") || part.includes(">")) {
      return null;
    }
    if (part.includes(";") || part.includes("{") || part.includes("}")) {
      return null;
    }
    // Must look like an IP address (IPv4 or IPv6)
    if (!isIPAddress(part)) return null;
  }

  return { client: normalizeAddress(parts[0]), chain: parts.map(normalizeAddress) };
}

/**
 * Quick check: does a string look like an IP address?
 */
function isIPAddress(str: string): boolean {
  return parseIPv4(str) !== null || parseIPv6(str.replace(/^\[|\]$/g, "")) !== null;
}

// ---------------------------------------------------------------------------
// Main resolution function
// ---------------------------------------------------------------------------

/**
 * Resolve the effective client address for a request.
 *
 * Algorithm:
 * 1. Get the immediate peer address from the socket.
 * 2. Check if the peer is within a trusted proxy CIDR.
 * 3. If trusted, parse X-Forwarded-For to find the original client.
 * 4. If not trusted, use the peer address directly.
 * 5. Normalize the resolved address.
 *
 * @param req - The incoming HTTP request.
 * @param trustedCidrs - Array of CIDR strings for trusted proxies.
 */
export function resolveClientAddress(
  req: IncomingMessage,
  trustedCidrs: string[],
): ClientAddressResult {
  const peerAddress = req.socket?.remoteAddress ?? "unknown";
  const normalizedPeer = normalizeAddress(peerAddress);

  // Parse trusted CIDRs
  const cidrs: CidrRange[] = [];
  for (const cidrStr of trustedCidrs) {
    const parsed = parseCidr(cidrStr);
    if (parsed) cidrs.push(parsed);
  }

  // Check if peer is trusted
  const peerParts = resolveAddressParts(normalizedPeer);
  const peerTrusted = peerParts
    ? cidrs.some((c) => addressInCidr(peerParts, c))
    : false;

  if (!peerTrusted) {
    // Not behind a trusted proxy — use peer address directly
    return {
      address: normalizedPeer,
      peer: normalizedPeer,
      fromProxy: false,
      proxyHops: 0,
    };
  }

  // Peer is trusted — look at X-Forwarded-For
  const xff = getSingleHeader(req, "x-forwarded-for");
  if (!xff) {
    return {
      address: normalizedPeer,
      peer: normalizedPeer,
      fromProxy: false,
      proxyHops: 0,
    };
  }

  const parsed = parseForwardedChain(xff);
  if (!parsed) {
    // Malformed forwarding header — fall back to peer
    return {
      address: normalizedPeer,
      peer: normalizedPeer,
      fromProxy: false,
      proxyHops: 0,
    };
  }

  return {
    address: parsed.client,
    peer: normalizedPeer,
    fromProxy: true,
    proxyHops: parsed.chain.length - 1,
  };
}

// ---------------------------------------------------------------------------
// Doctor diagnostics
// ---------------------------------------------------------------------------

/**
 * Produce diagnostics about the proxy trust configuration.
 * Used by `alix doctor` and startup validation.
 */
export function proxyTrustDiagnostic(trustedCidrs: string[]): ProxyTrustDiagnostic {
  const warnings: string[] = [];
  const cidrs: CidrRange[] = [];

  for (const cidrStr of trustedCidrs) {
    const parsed = parseCidr(cidrStr);
    if (parsed) {
      cidrs.push(parsed);
    } else {
      warnings.push(`Invalid CIDR: ${cidrStr}`);
    }
  }

  if (cidrs.length === 0 && trustedCidrs.length > 0) {
    warnings.push("No valid CIDRs parsed from trustedProxyCidrs configuration");
  }

  return {
    trustedCidrs: [...trustedCidrs],
    proxyTrustConfigured: trustedCidrs.length > 0,
    peerIsTrusted: null, // determined at request time
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getSingleHeader(req: IncomingMessage, name: string): string | undefined {
  const val = req.headers[name];
  if (!val) return undefined;
  return Array.isArray(val) ? val[0] : val;
}

function resolveAddressParts(addr: string): number[] | null {
  return parseIPv4(addr) ?? parseIPv6(addr);
}
