# Inspector Security

The ALiX Inspector is a local web dashboard for viewing agent sessions, policy
rules, approvals, audit logs, and registry data. This document describes its
security model and configuration options.

## Default binding

The Inspector binds to **127.0.0.1 (loopback)** by default, making it accessible
only from the local machine. This is the secure default.

```
Default:  http://127.0.0.1:4137
```

### Explicit host override

You can override the binding in your config:

```json
{
  "ui": {
    "host": "127.0.0.1",
    "port": 4137
  }
}
```

### Backward compatibility: 0.0.0.0

If you have an existing config with `ui.host: "0.0.0.0"`, ALiX will emit a
migration warning but still start. To suppress the warning, change the host to
`127.0.0.1` or `localhost`.

## Security configuration (ui.security)

The `ui.security` field controls Inspector security behavior. It is optional —
when absent, secure defaults are used.

### Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `authentication` | string | `"disabled-loopback-development"` | `"required"` or `"disabled-loopback-development"` |
| `remoteAccess` | boolean | `false` | Whether remote connections are permitted |
| `allowedHosts` | string[] | `["127.0.0.1", "::1", "localhost"]` | Allowed Host header values |
| `allowedOrigins` | string[] | `[]` | Allowed CORS origins |
| `trustedProxyCidrs` | string[] | `[]` | CIDR ranges for trusted proxies |
| `requireTlsForRemote` | boolean | `true` | Require TLS when remoteAccess is enabled |

### Validation rules

- **authentication**: `"disabled-loopback-development"` is rejected when the
  host is not a loopback address (127.0.0.1, localhost, ::1).
- **remoteAccess**: `true` on a non-loopback host is rejected — remote access
  is not yet approved until authentication lands.
- **allowedHosts**: The Host header of every HTTP request is validated before
  any route handler executes. Unknown hosts receive a stable `invalid_host`
  error.

### Example: explicit security config

```json
{
  "ui": {
    "host": "127.0.0.1",
    "port": 4137,
    "security": {
      "authentication": "disabled-loopback-development",
      "remoteAccess": false,
      "allowedHosts": ["127.0.0.1", "::1", "localhost"],
      "allowedOrigins": [],
      "trustedProxyCidrs": [],
      "requireTlsForRemote": true
    }
  }
}
```

## Remote access

**Remote access is not yet approved.** The `remoteAccess` field can be set to
`true` when binding to loopback (e.g., for a reverse proxy), but binding to a
non-loopback address with `remoteAccess: true` will be rejected.

Future milestones will add:
- Token-based authentication (P4.3-Sa2)
- TLS support (P4.3-Sa3)
- CORS enforcement (P4.3-Sa4)

## Host validation

All HTTP requests to the Inspector are validated against the configured
`allowedHosts` before any route processing occurs. This prevents Host header
injection and DNS rebinding attacks.

- Requests with absent or empty Host headers receive a **400 Bad Request**.
- Requests with unrecognized hosts receive a **403 Forbidden**.
- The rejected raw Host value is never included in the response.

## Security headers

The Inspector applies the following security headers to every response:

| Header | Value |
|--------|-------|
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `Permissions-Policy` | `camera=(), display-capture=(), fullscreen=(), geolocation=(), microphone=(), usb=()` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Content-Security-Policy` | `default-src 'self'; frame-ancestors 'none'; base-uri 'self'` |
| `X-Frame-Options` | `DENY` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `Cache-Control` | `no-store` (API responses) / `no-cache` (SSE) |

SSE endpoints additionally set `X-Accel-Buffering: no` for proper behavior
behind nginx reverse proxies.

## Diagnostics

Run `alix security doctor` to inspect the current Inspector boundary state:

```bash
alix security doctor
```

This reports whether the Inspector is bound to loopback, the current security
configuration, and any configuration issues.

## Startup validation

Before starting, ALiX performs a safety check:

- **Loopback hosts** (127.0.0.1, localhost, ::1): allowed without warning.
- **0.0.0.0**: allowed with a visible warning recommending loopback.
- **Other non-loopback hosts**: rejected unless authentication is enabled.
