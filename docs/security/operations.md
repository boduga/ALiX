# Security Operations Guide

**Date:** 2026-06-17
**Milestone:** P4.3-S

---

## Token Management

### Creating a Token

```bash
alix inspector auth create --name "CI Pipeline" --role admin
```

Available roles: `admin`, `readonly`, `agent`

The command outputs the raw token once. **Copy it immediately — it cannot be retrieved again.** The token should be set as the `Authorization: Bearer <token>` header.

### Listing Tokens

```bash
alix inspector auth list
alix inspector auth list --json
```

Shows token ID, name, role, status (active/revoked/expired), and creation date. Raw tokens are never displayed.

### Rotating a Token

```bash
alix inspector auth rotate <token-id> --grace 1h
```

Creates a new token and marks the old one for expiry after the grace period. Both tokens work during the grace period.

Grace period format: `1h`, `30m`, `7d`, `90s`.

### Revoking a Token

```bash
alix inspector auth revoke <token-id>
alix inspector auth revoke <token-id> --yes  # Skip confirmation
```

Revocation is immediate and irreversible.

### Token Doctor

```bash
alix inspector auth doctor
alix inspector auth doctor --json
```

Reports: store existence, total/active/revoked/expired token counts, max capacity.

---

## Credential Store Operations

### Listing Credentials

```bash
alix credential list
alix credential list --json
```

Shows provider, key label, encryption status. Values are never displayed in listings.

### Setting a Credential

```bash
alix credential set anthropic api-key "sk-ant-..."
```

Stores the credential encrypted. Returns a stable credential reference.

### Getting a Credential

```bash
alix credential get anthropic api-key
```

Outputs the raw value (for piping into tools). Use with caution.

### Deleting a Credential

```bash
alix credential delete anthropic api-key
```

Permanently removes the credential.

### Migrating Credentials

```bash
alix credential migrate
alix credential migrate --dry-run  # Preview without changes
```

Migrates API keys from environment variables and config files to the encrypted credential store. The `--dry-run` flag shows what would change without making modifications.

---

## Config Signing Workflow

### Signing Config

```bash
alix config sign
```

Creates a cryptographic signature for the current config. The signature is stored in `.alix/config/signature.json` and includes a monotonic revision number.

### Checking Trust State

```bash
alix config trust
```

Reports whether the config is trusted, untrusted, or unverified. In production mode (`NODE_ENV=production`), unsigned configs are treated as untrusted.

### Key Rotation

If the signing key is compromised:

1. Generate a new key pair.
2. Sign the current config with the new key.
3. Revoke the old key.
4. Verify trust: `alix config trust`

---

## Audit Verification

### Listing Audit Records

```bash
alix audit list
alix audit list --action authorization.denied
alix audit list --graphId <graph-id>
```

Returns audit records newest-first. Filter by action type or graph ID.

### Verifying Audit Integrity

```bash
alix audit verify
```

Checks the hash chain for tampering. Reports any integrity violations.

### Audit Log Location

- Server runtime audit: `~/.local/share/alix/auth-state/audit.jsonl`
- Project audit: `.alix/audit/audit.jsonl`

---

## Security Doctor Diagnostics

### Running the Doctor

```bash
alix security doctor
alix security doctor --json
```

The doctor performs comprehensive but passive diagnosis across all security subsystems:

- **Authentication:** Auth store existence, active token count, expired tokens
- **Network:** Host binding (loopback vs external), origin policy configuration, TLS requirement
- **Config Trust:** Config signing status
- **Credentials:** Credential store presence and entry count
- **Audit:** Audit log presence
- **Supply Chain:** Exception expiration status

### Interpreting Doctor Output

```
✓ Pass — subsystem is healthy
⚠ Warn — potential issue, not blocking
✗ Fail — must be fixed (especially in production)
! Error — check could not be executed
```

Exit codes:
- `0` — All checks pass
- `1` — Warnings found
- `2` — Issues found (failures or errors)

---

## Security Gate

### Running the Gate

```bash
alix security gate
alix security gate --json
```

The gate validates invariants that must hold before deployment:

- Config is signed (required in production)
- Auth store exists with active tokens
- No expired security exceptions
- Audit log is present (recommended)
- Host binding is loopback or TLS is required
- Rate limiter and connection limiter are functional

### Gate in CI

```yaml
- name: Security Gate
  run: |
    node dist/src/cli.js security gate --json
    if [ $? -ne 0 ]; then
      echo "Security gate failed"
      exit 1
    fi
```

### Gate Exit Codes

- `0` — All checks pass
- `1` — One or more checks failed
- `2` — Internal error during gate execution

---

## Security Alert Troubleshooting

### Viewing Security Status

```bash
curl http://127.0.0.1:PORT/api/security/status \
  -H "Authorization: Bearer <token>"
```

The `GET /api/security/status` endpoint returns passive health for each security subsystem:

```json
{
  "overall": "ok",
  "assessedAt": "2026-06-17T...",
  "subsystems": [
    {"subsystem": "auth", "status": "ok", "summary": "Auth store present with active tokens."},
    {"subsystem": "rate_limiter", "status": "ok", "summary": "Rate limiter is active."},
    ...
  ],
  "alertCount": 0,
  "criticalAlerts": [],
  "warningAlerts": []
}
```

### Common Alert Scenarios

| Alert ID | Meaning | Response |
|---|---|---|
| `auth.store_missing` | No auth store found | Create a token: `alix inspector auth create` |
| `auth.no_active_tokens` | All tokens expired or revoked | Create or rotate a token |
| `network.remote_no_tls` | Non-loopback bind without TLS | Set `requireTlsForRemote: true` in config |
| `network.remote_unapproved` | Non-loopback bind without remote policy | Configure `allowedOrigins` and `requireTlsForRemote` |
| `config.untrusted` | Config is not trusted | Sign the config: `alix config sign` |
| `audit.verification_failed` | Audit integrity check failed | Investigate audit log for tampering |
| `connection.saturated` | All SSE connections exhausted | Increase connection limit or investigate abuse |
| `ratelimit.pre_auth_high` | High volume of unauthenticated requests | Check for brute-force or DoS attack |

---

## Routine Maintenance

### Daily

- Check `alix security doctor` for warnings
- Verify auth tokens are active

### Weekly

- Review audit logs for anomalies: `alix audit list --limit 100`
- Check rate-limit and connection-limit metrics
- Verify config trust state: `alix config trust`

### Monthly

- Rotate long-lived tokens
- Run security gate: `alix security gate`
- Review supply-chain exceptions for expiration
- Update risk register (see `docs/security/risk-register.md`)

### Per Release

- Run full security test suite
- Verify all route coverage
- Run security doctor against packaged install
- Sign the release config
- Update acceptance matrix (see `docs/security/acceptance-matrix.md`)

---

## Emergency Procedures

### Suspected Token Compromise

1. **Identify compromised token:**
   ```bash
   alix inspector auth list
   ```

2. **Revoke immediately:**
   ```bash
   alix inspector auth revoke <token-id> --yes
   ```

3. **Check audit log for unauthorized access:**
   ```bash
   alix audit list --action authorization.allowed
   ```

4. **Rotate all other tokens if scope is unknown.**

5. **Create replacement token:**
   ```bash
   alix inspector auth create --name "replacement" --role admin
   ```

### Suspected Config Tampering

1. **Check trust state:**
   ```bash
   alix config trust
   ```

2. **Review mutation history:**
   ```bash
   alix config mutations
   ```

3. **Restore from known-good backup.**

4. **Re-sign config:**
   ```bash
   alix config sign
   ```

### Suspected Audit Tampering

1. **Run verification:**
   ```bash
   alix audit verify
   ```

2. **If verification fails,** check external anchor (if configured).

3. **Isolate affected audit segment** and preserve for investigation.

4. **Enable v2 audit chain** if still on legacy mode.

---

## Reference

| Document | Purpose |
|---|---|
| `docs/security/architecture.md` | Overall security architecture and trust boundaries |
| `docs/security/threat-model.md` | STRIDE analysis and threat mitigations |
| `docs/security/acceptance-matrix.md` | Attacks vs controls vs tests |
| `docs/security/risk-register.md` | Risk catalog with likelihood/impact/mitigation |
| `docs/security/rollout-strategy.md` | Phased deployment plan |
| `docs/security/inspector-security.md` | Inspector security configuration reference |
