/**
 * P4.3-Sg1 — Passive Security Health and Alerts
 *
 * Passive health assessment for Inspector security subsystems.
 * Does NOT perform full verification, audits, signing, or tests.
 *
 * Provides:
 * - `SecurityAlert` type with category/severity/title/message
 * - `assessSecurityHealth()` — passive health snapshot of all security subsystems
 * - `toSecurityStatusResponse()` — safe JSON payload for the status endpoint
 *
 * All output is redacted — no credentials, hashes, raw tokens, or addresses.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Severity levels for security alerts. */
export type AlertSeverity = "info" | "warning" | "critical";

/** Alert categories matching the security control domains. */
export type AlertCategory =
  | "auth"
  | "network"
  | "audit"
  | "config"
  | "credential";

/**
 * A single security alert — an observation about a potential issue,
 * not a verified finding. Passive only.
 */
export interface SecurityAlert {
  /** Stable, unique alert identifier. */
  id: string;
  /** Alert severity. */
  severity: AlertSeverity;
  /** Short human-readable title. */
  title: string;
  /** Descriptive message with actionable context. */
  message: string;
  /** Security control domain. */
  category: AlertCategory;
  /** Unix-ms timestamp when this alert was first observed. */
  firstSeen: number;
  /** Unix-ms timestamp when this alert was last observed. */
  lastSeen: number;
  /** How many times this alert has been observed. */
  count: number;
}

/**
 * Health status for a single security subsystem.
 * "unknown" means no evidence is available (never assume healthy).
 */
export type HealthStatus = "ok" | "needs_attention" | "degraded" | "unknown";

/**
 * Passive health assessment of a single security subsystem.
 */
export interface SubsystemHealth {
  /** Stable subsystem identifier. */
  subsystem: string;
  /** Current health status. */
  status: HealthStatus;
  /** Human-readable summary (no secrets). */
  summary: string;
  /** When this assessment was computed (Unix-ms). */
  assessedAt: number;
  /** Optional detail map (all values redacted). */
  details?: Record<string, string>;
}

/**
 * Full passive security health snapshot.
 */
export interface SecurityHealthSnapshot {
  /** Overall health across all subsystems. */
  overall: HealthStatus;
  /** Per-subsystem health entries. */
  subsystems: SubsystemHealth[];
  /** Active alerts (bounded, max 50). */
  alerts: SecurityAlert[];
  /** Unix-ms timestamp of this snapshot. */
  snapshotAt: number;
}

// ---------------------------------------------------------------------------
// Subsystem assessment helpers
// ---------------------------------------------------------------------------

/**
 * Context passed to each subsystem assessment.
 * All fields are optional — a subsystem reports "unknown" when
 * the data it needs is absent.
 */
export interface HealthAssessmentContext {
  /** Whether an auth store file exists and is readable. */
  authStoreExists?: boolean;
  /** Total token count in the auth store. */
  authTokenCount?: number;
  /** Number of active (non-revoked, non-expired) tokens. */
  authActiveTokens?: number;
  /** Whether the rate limiter is active. */
  rateLimiterActive?: boolean;
  /** Pre-auth bucket count. */
  preAuthBuckets?: number;
  /** Pre-auth capacity. */
  preAuthCapacity?: number;
  /** Post-auth bucket count. */
  postAuthBuckets?: number;
  /** Post-auth capacity. */
  postAuthCapacity?: number;
  /** Whether the connection limiter has capacity. */
  connectionLimiterActive?: boolean;
  /** Current connection count. */
  connectionCount?: number;
  /** Connection limit. */
  connectionLimit?: number;
  /** Whether origin policy is configured. */
  originPolicyConfigured?: boolean;
  /** Whether config signature status is available. */
  configSignaturePresent?: boolean;
  /** Config trust state (if known). */
  configTrustState?: "trusted" | "untrusted" | "unverified" | "unknown";
  /** Whether the audit chain is enabled. */
  auditChainEnabled?: boolean;
  /** Latest audit verification result (if available). */
  auditVerificationOk?: boolean;
  /** Whether a credential store exists. */
  credentialStoreExists?: boolean;
  /** Number of credential entries. */
  credentialEntryCount?: number;
  /** Whether redaction detection is active. */
  redactionActive?: boolean;
  /** Whether the host binding is loopback. */
  isLoopbackBind?: boolean;
  /** Whether remote access is configured. */
  remoteAccessConfigured?: boolean;
  /** Whether TLS is required for remote. */
  requireTlsForRemote?: boolean;
}

/**
 * Assess a single subsystem and return its health entry.
 */
function assessSubsystem(
  subsystem: string,
  status: HealthStatus,
  summary: string,
  details?: Record<string, string>,
): SubsystemHealth {
  return {
    subsystem,
    status,
    summary,
    assessedAt: Date.now(),
    details,
  };
}

// ---------------------------------------------------------------------------
// Alert management (in-memory, bounded)
// ---------------------------------------------------------------------------

/** Max alerts retained in memory. */
const MAX_ALERTS = 50;

/** In-memory alert store. */
const alertStore: SecurityAlert[] = [];

/**
 * Record or update an alert observation. Idempotent per alert id.
 */
function upsertAlert(params: {
  id: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  category: AlertCategory;
}): void {
  const now = Date.now();
  const existing = alertStore.find((a) => a.id === params.id);
  if (existing) {
    existing.lastSeen = now;
    existing.count += 1;
    existing.severity = params.severity; // severity may escalate
    existing.message = params.message;
  } else {
    alertStore.push({
      id: params.id,
      severity: params.severity,
      title: params.title,
      message: params.message,
      category: params.category,
      firstSeen: now,
      lastSeen: now,
      count: 1,
    });
  }

  // Prune to max size (keep most recently seen)
  if (alertStore.length > MAX_ALERTS) {
    alertStore.sort((a, b) => b.lastSeen - a.lastSeen);
    alertStore.length = MAX_ALERTS;
  }
}

/**
 * Clear all alerts (for testing only).
 */
export function resetAlerts(): void {
  alertStore.length = 0;
}

/**
 * Return a shallow copy of all active alerts.
 */
export function getAlerts(): SecurityAlert[] {
  return alertStore
    .slice()
    .sort((a, b) => {
      // Critical first, then by recency
      const sev = { critical: 0, warning: 1, info: 2 };
      const sevDiff = sev[a.severity] - sev[b.severity];
      if (sevDiff !== 0) return sevDiff;
      return b.lastSeen - a.lastSeen;
    });
}

// ---------------------------------------------------------------------------
// Passive health assessment
// ---------------------------------------------------------------------------

/**
 * Perform a passive health assessment of all security subsystems.
 *
 * This is strictly passive — it reads the provided context and reports
 * status. It does NOT trigger verification, audits, signing, or tests.
 *
 * @param ctx — Optional context with known subsystem states.
 *             Missing fields are reported as "unknown".
 * @returns A complete SecurityHealthSnapshot.
 */
export function assessSecurityHealth(
  ctx: HealthAssessmentContext = {},
): SecurityHealthSnapshot {
  const subsystems: SubsystemHealth[] = [];
  const allStatuses: HealthStatus[] = [];

  // ── Auth subsystem ──────────────────────────────────────────────
  const authStatus = assessAuthSubsystem(ctx);
  subsystems.push(authStatus);
  allStatuses.push(authStatus.status);

  // ── Rate Limiter ────────────────────────────────────────────────
  const rateStatus = assessRateLimiterSubsystem(ctx);
  subsystems.push(rateStatus);
  allStatuses.push(rateStatus.status);

  // ── Connection Limiter ──────────────────────────────────────────
  const connStatus = assessConnectionSubsystem(ctx);
  subsystems.push(connStatus);
  allStatuses.push(connStatus.status);

  // ── Origin Policy ───────────────────────────────────────────────
  const originStatus = assessOriginSubsystem(ctx);
  subsystems.push(originStatus);
  allStatuses.push(originStatus.status);

  // ── Config Trust ────────────────────────────────────────────────
  const configStatus = assessConfigSubsystem(ctx);
  subsystems.push(configStatus);
  allStatuses.push(configStatus.status);

  // ── Audit Integrity ─────────────────────────────────────────────
  const auditStatus = assessAuditSubsystem(ctx);
  subsystems.push(auditStatus);
  allStatuses.push(auditStatus.status);

  // ── Credential Store ────────────────────────────────────────────
  const credStatus = assessCredentialSubsystem(ctx);
  subsystems.push(credStatus);
  allStatuses.push(credStatus.status);

  // ── Redaction ───────────────────────────────────────────────────
  const redactStatus = assessRedactionSubsystem(ctx);
  subsystems.push(redactStatus);
  allStatuses.push(redactStatus.status);

  // ── Network / Remote Access ─────────────────────────────────────
  const netStatus = assessNetworkSubsystem(ctx);
  subsystems.push(netStatus);
  allStatuses.push(netStatus.status);

  // ── Overall computation ─────────────────────────────────────────
  const overall = computeOverall(allStatuses);

  return {
    overall,
    subsystems,
    alerts: getAlerts(),
    snapshotAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Per-subsystem assessment
// ---------------------------------------------------------------------------

function assessAuthSubsystem(ctx: HealthAssessmentContext): SubsystemHealth {
  if (ctx.authStoreExists === undefined) {
    return assessSubsystem("auth", "unknown", "Auth store status is unknown.");
  }
  if (!ctx.authStoreExists) {
    upsertAlert({
      id: "auth.store_missing",
      severity: "critical",
      title: "Auth store not found",
      message: "The Inspector authentication store does not exist. No API tokens can be validated.",
      category: "auth",
    });
    return assessSubsystem(
      "auth",
      "needs_attention",
      "Auth store does not exist.",
    );
  }
  if (ctx.authActiveTokens !== undefined && ctx.authActiveTokens === 0) {
    upsertAlert({
      id: "auth.no_active_tokens",
      severity: "warning",
      title: "No active auth tokens",
      message: "The auth store has no active tokens. API access requires at least one valid token.",
      category: "auth",
    });
    return assessSubsystem(
      "auth",
      "needs_attention",
      "Auth store exists but has no active tokens.",
      {
        totalTokens: String(ctx.authTokenCount ?? 0),
        activeTokens: "0",
      },
    );
  }
  return assessSubsystem(
    "auth",
    "ok",
    "Auth store present with active tokens.",
    {
      totalTokens: String(ctx.authTokenCount ?? 0),
      activeTokens: String(ctx.authActiveTokens ?? 0),
    },
  );
}

function assessRateLimiterSubsystem(
  ctx: HealthAssessmentContext,
): SubsystemHealth {
  if (ctx.rateLimiterActive === undefined) {
    return assessSubsystem("rate_limiter", "unknown", "Rate limiter status is unknown.");
  }
  if (!ctx.rateLimiterActive) {
    return assessSubsystem(
      "rate_limiter",
      "needs_attention",
      "Rate limiter is not active.",
    );
  }
  // Check if buckets seem overly full (potential abuse indicator)
  if (
    ctx.preAuthBuckets !== undefined &&
    ctx.preAuthCapacity !== undefined &&
    ctx.preAuthBuckets > ctx.preAuthCapacity * 0.9
  ) {
    upsertAlert({
      id: "ratelimit.pre_auth_high",
      severity: "warning",
      title: "Pre-auth rate limit near capacity",
      message: "High number of pre-auth rate-limit buckets. May indicate burst traffic or abuse.",
      category: "network",
    });
    return assessSubsystem(
      "rate_limiter",
      "ok",
      "Rate limiter is active (pre-auth near capacity).",
      {
        preAuthBuckets: String(ctx.preAuthBuckets),
        preAuthCapacity: String(ctx.preAuthCapacity),
      },
    );
  }
  return assessSubsystem(
    "rate_limiter",
    "ok",
    "Rate limiter is active.",
    {
      preAuthBuckets: String(ctx.preAuthBuckets ?? 0),
      postAuthBuckets: String(ctx.postAuthBuckets ?? 0),
    },
  );
}

function assessConnectionSubsystem(
  ctx: HealthAssessmentContext,
): SubsystemHealth {
  if (ctx.connectionLimiterActive === undefined) {
    return assessSubsystem("connection_limiter", "unknown", "Connection limiter status is unknown.");
  }
  if (!ctx.connectionLimiterActive) {
    return assessSubsystem(
      "connection_limiter",
      "needs_attention",
      "Connection limiter is not active.",
    );
  }
  if (
    ctx.connectionCount !== undefined &&
    ctx.connectionLimit !== undefined &&
    ctx.connectionCount >= ctx.connectionLimit
  ) {
    upsertAlert({
      id: "connection.saturated",
      severity: "critical",
      title: "Connection limit reached",
      message: "All connection slots are exhausted. New SSE connections will be rejected.",
      category: "network",
    });
    return assessSubsystem(
      "connection_limiter",
      "degraded",
      "Connection limit exhausted.",
      {
        connections: String(ctx.connectionCount),
        limit: String(ctx.connectionLimit),
      },
    );
  }
  return assessSubsystem(
    "connection_limiter",
    "ok",
    "Connection limiter has available capacity.",
    {
      connections: String(ctx.connectionCount ?? 0),
      limit: String(ctx.connectionLimit ?? 0),
    },
  );
}

function assessOriginSubsystem(ctx: HealthAssessmentContext): SubsystemHealth {
  if (ctx.originPolicyConfigured === undefined) {
    return assessSubsystem("origin_policy", "unknown", "Origin policy status is unknown.");
  }
  if (!ctx.originPolicyConfigured) {
    upsertAlert({
      id: "origin.not_configured",
      severity: "warning",
      title: "Origin policy not configured",
      message: "No allowed origins have been configured. Cross-origin requests may be unrestricted.",
      category: "network",
    });
    return assessSubsystem(
      "origin_policy",
      "needs_attention",
      "Origin policy is not configured.",
    );
  }
  return assessSubsystem("origin_policy", "ok", "Origin policy is configured.");
}

function assessConfigSubsystem(ctx: HealthAssessmentContext): SubsystemHealth {
  if (ctx.configTrustState === undefined || ctx.configTrustState === "unknown") {
    return assessSubsystem(
      "config_trust",
      "unknown",
      "Config trust state is unknown. Config signing may not be active.",
    );
  }
  if (ctx.configTrustState === "untrusted") {
    upsertAlert({
      id: "config.untrusted",
      severity: "critical",
      title: "Config is untrusted",
      message: "The Inspector configuration is not trusted. Config may have been tampered with or was not signed.",
      category: "config",
    });
    return assessSubsystem(
      "config_trust",
      "needs_attention",
      "Config is untrusted.",
      { trustState: ctx.configTrustState },
    );
  }
  if (ctx.configTrustState === "unverified") {
    return assessSubsystem(
      "config_trust",
      "ok",
      "Config is signed but unverified.",
      { trustState: ctx.configTrustState },
    );
  }
  return assessSubsystem(
    "config_trust",
    "ok",
    "Config trust is verified.",
    { trustState: ctx.configTrustState },
  );
}

function assessAuditSubsystem(ctx: HealthAssessmentContext): SubsystemHealth {
  if (ctx.auditChainEnabled === undefined) {
    return assessSubsystem("audit", "unknown", "Audit chain status is unknown.");
  }
  if (!ctx.auditChainEnabled) {
    return assessSubsystem(
      "audit",
      "ok",
      "Audit chain is not enabled (legacy mode).",
      { enabled: "false" },
    );
  }
  if (ctx.auditVerificationOk === false) {
    upsertAlert({
      id: "audit.verification_failed",
      severity: "critical",
      title: "Audit verification failed",
      message: "The latest audit verification report indicates a failure. Audit chain integrity may be compromised.",
      category: "audit",
    });
    return assessSubsystem(
      "audit",
      "needs_attention",
      "Audit verification has failed.",
      { enabled: "true", verification: "failed" },
    );
  }
  return assessSubsystem(
    "audit",
    "ok",
    "Audit chain is enabled and verified.",
    { enabled: "true" },
  );
}

function assessCredentialSubsystem(
  ctx: HealthAssessmentContext,
): SubsystemHealth {
  if (ctx.credentialStoreExists === undefined) {
    return assessSubsystem("credentials", "unknown", "Credential store status is unknown.");
  }
  if (!ctx.credentialStoreExists) {
    return assessSubsystem(
      "credentials",
      "ok",
      "No credential store exists. Using environment variables.",
      { storeExists: "false" },
    );
  }
  return assessSubsystem(
    "credentials",
    "ok",
    "Credential store present.",
    {
      storeExists: "true",
      entryCount: String(ctx.credentialEntryCount ?? 0),
    },
  );
}

function assessRedactionSubsystem(
  ctx: HealthAssessmentContext,
): SubsystemHealth {
  if (ctx.redactionActive === undefined) {
    return assessSubsystem("redaction", "unknown", "Redaction status is unknown.");
  }
  if (!ctx.redactionActive) {
    upsertAlert({
      id: "redaction.inactive",
      severity: "warning",
      title: "Redaction not active",
      message: "Secret detection is not active. Responses may leak sensitive data.",
      category: "credential",
    });
    return assessSubsystem(
      "redaction",
      "needs_attention",
      "Redaction is not active.",
    );
  }
  return assessSubsystem("redaction", "ok", "Secret detection is active.");
}

function assessNetworkSubsystem(
  ctx: HealthAssessmentContext,
): SubsystemHealth {
  const details: Record<string, string> = {};

  if (ctx.isLoopbackBind !== undefined) {
    details.loopback = String(ctx.isLoopbackBind);
  }
  if (ctx.remoteAccessConfigured !== undefined) {
    details.remoteAccess = String(ctx.remoteAccessConfigured);
  }
  if (ctx.requireTlsForRemote !== undefined) {
    details.tlsRequired = String(ctx.requireTlsForRemote);
  }

  if (ctx.isLoopbackBind === false) {
    if (ctx.requireTlsForRemote === false) {
      upsertAlert({
        id: "network.remote_no_tls",
        severity: "critical",
        title: "Remote access without TLS",
        message: "Inspector is bound to a non-loopback address and TLS is not required. This exposes API traffic in plaintext.",
        category: "network",
      });
    }
    if (!ctx.remoteAccessConfigured) {
      upsertAlert({
        id: "network.remote_unapproved",
        severity: "warning",
        title: "Non-loopback bind without remote access policy",
        message: "Inspector is bound to a non-loopback address but no remote access policy is configured.",
        category: "network",
      });
    }
    return assessSubsystem(
      "network",
      ctx.requireTlsForRemote ? "ok" : "needs_attention",
      "Inspector bound to non-loopback address.",
      details,
    );
  }

  if (ctx.isLoopbackBind === undefined && Object.keys(details).length === 0) {
    return assessSubsystem("network", "unknown", "Network binding status is unknown.");
  }

  return assessSubsystem(
    "network",
    "ok",
    "Inspector bound to loopback.",
    details,
  );
}

// ---------------------------------------------------------------------------
// Overall health computation
// ---------------------------------------------------------------------------

function computeOverall(statuses: HealthStatus[]): HealthStatus {
  if (statuses.length === 0) return "unknown";

  // If any subsystem needs attention, overall is "needs_attention"
  if (statuses.includes("needs_attention")) return "needs_attention";

  // If any subsystem is degraded, overall is "degraded"
  if (statuses.includes("degraded")) return "degraded";

  // If all are "ok" or "unknown", and at least one is "ok", overall is "ok"
  const hasOk = statuses.some((s) => s === "ok");
  const allKnown = statuses.every((s) => s === "ok" || s === "unknown");

  if (allKnown && hasOk) return "ok";
  if (allKnown && !hasOk) return "unknown";

  return "ok";
}

// ---------------------------------------------------------------------------
// Response payload
// ---------------------------------------------------------------------------

/**
 * Build a safe, bounded JSON response for the security status endpoint.
 * All sensitive values are redacted. No credentials, hashes, or addresses.
 */
export function toSecurityStatusResponse(
  snapshot: SecurityHealthSnapshot,
): Record<string, unknown> {
  return {
    overall: snapshot.overall,
    assessedAt: new Date(snapshot.snapshotAt).toISOString(),
    subsystems: snapshot.subsystems.map((s) => ({
      subsystem: s.subsystem,
      status: s.status,
      summary: s.summary,
    })),
    alertCount: snapshot.alerts.length,
    criticalAlerts: snapshot.alerts
      .filter((a) => a.severity === "critical")
      .map((a) => ({ id: a.id, title: a.title })),
    warningAlerts: snapshot.alerts
      .filter((a) => a.severity === "warning")
      .map((a) => ({ id: a.id, title: a.title })),
  };
}
