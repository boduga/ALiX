# Security Rollout Strategy

**Date:** 2026-06-17
**Milestone:** P4.3-S
**Status:** Post-implementation — rollout guide

---

## Overview

P4.3-S delivers the ALiX Inspector security hardening across 8 milestones. The rollout follows a phased approach: first validate in local development, then staging/CI, and finally production. Each phase has a gated entry criterion.

---

## Phase 1: Local Validation (Day 1-2)

### Entry Criteria
- All P4.3-S milestones implemented and committed
- `npm run build` passes
- `npm run test:unit:node` passes (all security test suites)

### Validation Steps

1. **Run comprehensive security doctor:**
   ```bash
   alix security doctor
   alix security doctor --json
   ```
   Expected: report with pass/warn/fail/error counts. No failures in local dev mode.

2. **Run acceptance gate:**
   ```bash
   alix security gate
   alix security gate --json
   ```
   Expected: all checks pass in local dev mode.

3. **Start Inspector with auth:**
   ```bash
   alix inspector auth create --name test-token --role admin
   alix start
   ```
   Verify that `GET /api/security/status` returns valid JSON with `overall: "ok"` or `overall: "needs_attention"`.

4. **Verify auth is enforced:**
   ```bash
   curl http://127.0.0.1:PORT/api/graphs  # Should return 401
   curl -H "Authorization: Bearer <token>" http://127.0.0.1:PORT/api/graphs  # Should return 200
   ```

---

## Phase 2: CI Pipeline (Day 2-3)

### Entry Criteria
- Phase 1 validation passes locally
- Security doctor and gate produce expected output

### CI Integration

1. **Add security gate to CI workflow:**
   ```yaml
   - name: Security Gate
     run: node dist/src/cli.js security gate --json
   ```

2. **Add security doctor to CI workflow:**
   ```yaml
   - name: Security Doctor
     run: node dist/src/cli.js security doctor --json
   ```

3. **Verify all security tests run in CI:**
   ```yaml
   - name: Security Tests
     run: npm run test:unit:node
   ```

### Acceptance
- Security gate passes in CI
- Security doctor reports no failures
- All security test suites pass

---

## Phase 3: Staging Deployment (Day 3-4)

### Entry Criteria
- Phase 2 CI validation passes
- Release gate script updated with security checks

### Staging Validation

1. **Deploy to staging environment** (non-loopback with TLS termination)

2. **Run remote security assessment:**
   ```bash
   # From a remote machine (within allowed proxy CIDRs)
   curl https://staging-host:PORT/api/security/status \
     -H "Authorization: Bearer <token>"
   ```

3. **Verify network controls:**
   - Confirm host policy rejects requests with unexpected Host headers
   - Confirm origin policy rejects cross-origin requests from unlisted origins
   - Confirm rate limiters engage under load
   - Confirm connection limiters cap SSE connections

4. **Verify audit integrity:**
   ```bash
   alix audit list
   alix audit verify
   ```

5. **Verify config trust:**
   ```bash
   alix config trust
   alix config sign
   ```

---

## Phase 4: Production Rollout (Day 4-5)

### Entry Criteria
- Phase 3 staging validation passes
- No unresolved HIGH or CRITICAL security findings
- Rollback plan documented

### Production Steps

1. **Pre-deployment checklist:**
   - [ ] Config is signed (`alix config sign`)
   - [ ] Auth store has at least one active admin token
   - [ ] TLS is enforced for remote access (`requireTlsForRemote: true`)
   - [ ] Allowed hosts list is minimal and correct
   - [ ] Allowed origins list is minimal and correct
   - [ ] Trusted proxy CIDRs are correctly configured
   - [ ] Credential migration is complete
   - [ ] Security gate passes: `alix security gate`
   - [ ] Supply-chain audit exceptions are reviewed and non-expired

2. **Deploy:**
   ```bash
   npm run build
   npm publish --provenance --access public
   ```

3. **Post-deployment validation:**
   - [ ] `GET /healthz` returns "OK"
   - [ ] `GET /api/security/status` returns healthy status
   - [ ] Auth endpoints respond correctly
   - [ ] Audit logging is active
   - [ ] Rate limiters are functional

4. **Monitor:**
   - Watch security alerts via `/api/security/status`
   - Monitor audit logs for anomalies
   - Check rate-limit and connection-limit metrics

---

## Rollback Plan

If security issues are detected post-deployment:

1. **Revert to previous version:**
   ```bash
   npm install alix@<previous-version>
   ```

2. **Revoke all tokens issued during the affected period:**
   ```bash
   alix inspector auth list
   alix inspector auth revoke <token-id>
   ```

3. **Rotate any credentials that may have been exposed.**

4. **Audit the incident:**
   ```bash
   alix audit list --action authorization.denied
   ```

---

## Migration Notes

### For Existing Users

1. **Auth store:** Created automatically on first `alix start`. No migration needed.
2. **Credential store:** Run `alix credential migrate` to move from env-vars / config files to the encrypted store.
3. **Config signing:** Existing configs are unsigned by default. Run `alix config sign` to sign.
4. **Supply-chain exceptions:** If using custom lifecycle scripts, add them to `security/lifecycle-script-allowlist.json`.

### Breaking Changes

1. **Authentication required for all `/api/*` routes.** Unauthenticated requests receive 401.
2. **Loopback binding by default.** Remote access requires explicit configuration.
3. **Config signing required in production.** Unsigned configs in `NODE_ENV=production` will fail the security gate.
4. **Rate limiting active by default.** High-frequency clients may experience 429 responses.

---

## Timeline

| Phase | Duration | Dependencies |
|---|---|---|
| Phase 1: Local Validation | 1-2 days | All P4.3-S milestones committed |
| Phase 2: CI Pipeline | 1 day | Phase 1 passes |
| Phase 3: Staging | 1 day | Phase 2 passes, staging env available |
| Phase 4: Production | 1 day | Phase 3 passes, approval |

**Total: 4-5 days from code complete to production.**
