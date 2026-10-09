export type NetworkDecision = "allow" | "ask" | "deny";

export type NetworkPolicy = {
  defaultAction: NetworkDecision;
  allowlist: string[];
  blocklist: string[];
  allowedPorts?: number[];
  allowedCIDRs?: string[];
};

export type NetworkMatchResult = {
  domain: string;
  decision: NetworkDecision;
  reason: string;
  matched?: string;
  port?: number;
};

function parseHostPort(target: string): { host: string; port?: number } {
  // Handle URLs like https://example.com:8080/path
  const urlMatch = target.match(/^https?:\/\/([^/:]+)(?::(\d+))?(?:\/|$)/i);
  if (urlMatch) {
    return { host: urlMatch[1], port: urlMatch[2] ? parseInt(urlMatch[2], 10) : undefined };
  }

  // Handle host:port like example.com:8080
  const portMatch = target.match(/^([^:]+):(\d+)$/);
  if (portMatch) {
    return { host: portMatch[1], port: parseInt(portMatch[2], 10) };
  }

  return { host: target };
}

function isCIDRMatch(ip: string, cidr: string): boolean {
  const [range, bits] = cidr.split("/");
  const maskBits = bits ? parseInt(bits, 10) : 32;

  const ipParts = ip.split(".").map(Number);
  const rangeParts = range.split(".").map(Number);

  const mask = (0xffffffff << (32 - maskBits)) >>> 0;
  const ipNum = (ipParts.reduce((acc, p) => (acc << 8) | p, 0)) >>> 0;
  const rangeNum = (rangeParts.reduce((acc, p) => (acc << 8) | p, 0)) >>> 0;

  return (ipNum & mask) === (rangeNum & mask);
}

function normalizeDomain(domain: string): string {
  return domain.toLowerCase().replace(/^www\./, "");
}

function domainMatches(target: string, pattern: string): boolean {
  const normalizedTarget = normalizeDomain(target);
  const normalizedPattern = normalizeDomain(pattern);

  // Exact match
  if (normalizedTarget === normalizedPattern) return true;

  // Subdomain match (api.github.com matches github.com)
  if (normalizedTarget.endsWith("." + normalizedPattern)) return true;

  // Wildcard patterns
  if (normalizedPattern.startsWith("*.")) {
    const suffix = normalizedPattern.slice(2);
    return normalizedTarget.endsWith(suffix) || normalizedTarget === suffix.slice(1);
  }

  return false;
}

export class NetworkPolicyMatcher {
  constructor(private policy: NetworkPolicy) {}

  match(target: string): NetworkMatchResult {
    const { host, port } = parseHostPort(target);
    const normalizedHost = normalizeDomain(host);

    // Check blocklist first (explicit deny)
    for (const blocked of this.policy.blocklist) {
      if (domainMatches(normalizedHost, blocked)) {
        return {
          domain: normalizedHost,
          decision: "deny",
          reason: "blocklist",
          matched: blocked,
          port,
        };
      }
    }

    // Check allowlist (explicit allow)
    for (const allowed of this.policy.allowlist) {
      if (domainMatches(normalizedHost, allowed)) {
        return {
          domain: normalizedHost,
          decision: "allow",
          reason: "allowlist",
          matched: allowed,
          port,
        };
      }
    }

    // Check CIDR allowlist for IP addresses
    if (this.policy.allowedCIDRs && /^\d+\.\d+\.\d+\.\d+$/.test(normalizedHost)) {
      for (const cidr of this.policy.allowedCIDRs) {
        if (isCIDRMatch(normalizedHost, cidr)) {
          return {
            domain: normalizedHost,
            decision: "allow",
            reason: "cidr_allowlist",
            matched: cidr,
            port,
          };
        }
      }
    }

    // Check port restrictions
    if (port !== undefined && this.policy.allowedPorts) {
      if (!this.policy.allowedPorts.includes(port)) {
        return {
          domain: normalizedHost,
          decision: "deny",
          reason: "port_not_allowed",
          matched: normalizedHost,
          port,
        };
      }
    }

    // Default to policy default
    return {
      domain: normalizedHost,
      decision: this.policy.defaultAction,
      reason: "default",
      port,
    };
  }

  isAllowed(target: string): boolean {
    return this.match(target).decision === "allow";
  }

  isDenied(target: string): boolean {
    return this.match(target).decision === "deny";
  }

  requiresApproval(target: string): boolean {
    return this.match(target).decision === "ask";
  }
}

export function matchNetwork(target: string, policy: NetworkPolicy): NetworkMatchResult {
  return new NetworkPolicyMatcher(policy).match(target);
}
