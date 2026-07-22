# FAANG-LEVEL REMEDIATION PLAN
## AgroBridge Foundation: 7.0 -> 8.5+ Score Target
**Prepared by:** IC8 Engineering Team (FAANG Standards)
**Date:** February 17, 2026
**Current Score:** 7.0/10 (Backend: 7.5, Frontend: 6.2)
**Target Score:** 8.5+/10
**Estimated Timeline:** 6 weeks (3 waves)
**Risk Level:** High (P1 findings in production)

---

## EXECUTIVE SUMMARY
This plan addresses 16 critical, high, and medium severity findings preventing the codebase from meeting FAANG production standards. The primary focus is on **CI/CD governance** (frontend's biggest weakness), **security hardening**, and **reliability improvements**.

### Score Projection by Area
| Area | Current | Post-Wave 0 | Post-Wave 1 | Post-Wave 2 | Target |
|------|---------|-------------|-------------|-------------|--------|
| Security & Abuse Resistance | 6.3 | 7.5 | 8.2 | 8.8 | 8.5+ |
| Reliability & Runtime Safety | 6.8 | 7.5 | 8.3 | 8.7 | 8.5+ |
| CI/CD Governance | 6.1 | 7.8 | 8.5 | 9.0 | 8.5+ |
| Code Quality | 7.5 | 7.8 | 8.3 | 8.6 | 8.5+ |
| Test Discipline | 8.4 | 8.5 | 8.7 | 8.8 | 8.5+ |
| **OVERALL** | **7.0** | **7.8** | **8.4** | **8.8** | **8.5+** |

---

## WAVE 0: EMERGENCY STABILIZATION (Week 1)
**Goal:** Eliminate all P1 findings and active production risks

### P1-1: Duplicate CI/CD Workflows [FRONTEND]
**Finding:** `frontend.yml` and `frontend-optimized.yml` have identical names/triggers, causing parallel deploys and ambiguous required checks.

**Files:**
- `.github/workflows/frontend.yml:1`
- `.github/workflows/frontend-optimized.yml:1`

**Remediation:**
```yaml
# Decision: Merge and deprecate
# Option A: Keep frontend-optimized.yml as canonical, delete frontend.yml
# Option B: Rename to distinct purposes (recommended)
# RECOMMENDED SOLUTION:
# 1. Rename frontend-optimized.yml -> frontend.yml (overwrite)
# 2. Delete old frontend.yml
# 3. Update branch protection rules
# 4. Update documentation
```

**Implementation Steps:**
1. [ ] Backup current frontend.yml as frontend.legacy.yml
2. [ ] Rename frontend-optimized.yml -> frontend.yml
3. [ ] Update workflow name to "Frontend CI/CD (Unified)"
4. [ ] Delete frontend-optimized.yml
5. [ ] Update branch protection rules in GitHub UI:
   - Remove old check names
   - Add new unified check names
6. [ ] Update AGENTS.md documentation
7. [ ] Test on feature branch

**Owner:** SRE Team
**Reviewers:** Staff Engineer, Security
**ETA:** 2 days

---

### P1-2: Placeholder Stripe Keys in Production Deploy [FRONTEND]
**Finding:** Production deploy writes `STRIPE_PUBLISHABLE_KEY=pk_live_...` placeholder instead of secret-backed values, risking broken payments.

**Files:**
- `.github/workflows/frontend.yml:490`
- `.github/workflows/frontend-optimized.yml:567`

**Current Code:**
```yaml
echo "STRIPE_PUBLISHABLE_KEY=pk_live_..." >> .env  # WRONG
```

**Remediation:**
```yaml
# CORRECTED:
echo "STRIPE_PUBLISHABLE_KEY=${{ secrets.STRIPE_PUBLISHABLE_KEY }}" >> .env
```

**Implementation Steps:**
1. [ ] Verify `STRIPE_PUBLISHABLE_KEY` exists in GitHub Secrets (production environment)
2. [ ] Verify `STRIPE_PUBLISHABLE_KEY_TEST` exists for staging
3. [ ] Update frontend.yml deployment steps
4. [ ] Update frontend-optimized.yml deployment steps
5. [ ] Add validation step:
```yaml
- name: Validate Stripe Key
  run: |
    if [[ "${{ secrets.STRIPE_PUBLISHABLE_KEY }}" == pk_live_* ]]; then
      echo "Production key detected"
    else
      echo "Invalid or missing production key"
      exit 1
    fi
```
6. [ ] Add automated test to verify Stripe key is functional
7. [ ] Roll out to staging first

**Owner:** Security + Payments Team
**Reviewers:** Staff Engineer, Finance
**ETA:** 1 day

---

### P1-3: Fail-Open Contract Gate [FRONTEND]
**Finding:** Frontend-backend contract gate exits success when OpenAPI schemas are missing or have "Default Response" entries.

**Files:**
- `scripts/contracts/check-backend-contract.mjs:147`
- `scripts/contracts/check-backend-contract.mjs:262`
- `contracts/openapi/openapi.v1.snapshot.json:324`

**Root Cause:**
```javascript
// Line 147 - Warns instead of failing
if (!schema) {
  addWarning(`${label}: OpenAPI schema was not published; semantic path check skipped.`);
  return;  // Should fail
}
// Line 262 - Only fails on explicit failures[]
const result = failures.length > 0 ? 'fail' : 'pass';  // Warnings don't fail
```

**Remediation:**
```javascript
// Option 1: Treat warnings as failures (strict mode)
const result = (failures.length > 0 || warnings.length > 0) ? 'fail' : 'pass';
// Option 2: Add severity levels
const result = failures.length > 0 ? 'fail' :
               (warnings.length > 0 && process.env.CONTRACT_STRICT === 'true') ? 'fail' : 'pass';
```

**Implementation Steps:**
1. [ ] Add `--strict` flag to contract check
2. [ ] Update CI to use strict mode
3. [ ] Fix "Default Response" entries in OpenAPI schema
4. [ ] Add schema validation for required fields
5. [ ] Generate proper response schemas for all endpoints
6. [ ] Add contract check to pre-commit hooks

**Owner:** Backend API Team
**Reviewers:** Staff Engineer
**ETA:** 3 days

---

### P1-4: Rollback Workflow Missing Approval Gate [FRONTEND]
**Finding:** `repository_dispatch` can trigger production SSH rollback without explicit environment approval.

**Files:**
- `.github/workflows/rollback.yml:15`
- `.github/workflows/rollback.yml:22`
- `.github/workflows/rollback.yml:37`

**Current Code:**
```yaml
on:
  repository_dispatch:
    types: [rollback]  # No approval required
```

**Remediation:**
```yaml
on:
  workflow_dispatch:  # Manual only
    inputs:
      reason:
        description: 'Reason for rollback'
        required: true
        type: choice
        options:
          - error_rate
          - health_check_failure
          - performance_regression
          - manual
      environment:
        description: 'Target environment'
        required: true
        type: choice
        options:
          - staging
          - production
      confirm_production:
        description: 'Type ROLLBACK-PRODUCTION to confirm'
        required: true
jobs:
  rollback-production:
    name: Rollback Production
    runs-on: ubuntu-latest
    environment: production-frontend
    if: github.ref == 'refs/heads/main' && github.event.inputs.environment == 'production'
    steps:
      - name: Verify Production Confirmation
        run: |
          if [[ "${{ github.event.inputs.confirm_production }}" != "ROLLBACK-PRODUCTION" ]]; then
            echo "Production rollback not confirmed"
            exit 1
          fi
```

**Implementation Steps:**
1. [ ] Remove `repository_dispatch` trigger
2. [ ] Add GitHub Environment: `production-frontend`
3. [ ] Configure environment protection rules:
   - Required reviewers: 2 (on-call SRE + Staff Engineer)
   - Wait timer: 5 minutes
4. [ ] Add confirmation input validation
5. [ ] Update alerting to suggest manual rollback workflow
6. [ ] Create runbook for emergency rollback
7. [ ] Test in staging environment

**Owner:** SRE Team
**Reviewers:** Security, Staff Engineer
**ETA:** 2 days

---

## WAVE 1: SECURITY & RELIABILITY HARDENING (Weeks 2-3)
**Goal:** Address all P2 findings and establish secure-by-default patterns

### P2-1: Tiered Rate Limiting Not Wired [BACKEND]
**Finding:** Middleware imported but not registered; `require()` used in ESM path causing in-memory fallback.

**Files:**
- `src/app.ts:23` (import only, no registration)
- `src/app.ts:103` (basic rate limit only)
- `src/rate-limiting/tiered-rate-limiter.ts:36`
- `src/rate-limiting/middleware.ts:7`

**Current Code:**
```typescript
// app.ts:23 - Imported but never used
import { rateLimitMiddleware } from './rate-limiting/middleware.js';
// tiered-rate-limiter.ts:36 - require() in ESM
const { getRedisClient } = require('../cache/redis-client.js');
```

**Remediation:**
```typescript
// app.ts - Register middleware
import { rateLimitMiddleware } from './rate-limiting/middleware.js';
// Add after CORS setup
app.addHook('onRequest', async (req, reply) => {
  await rateLimitMiddleware(req, reply, () => {});
});
// tiered-rate-limiter.ts - Use dynamic import
private async initializeStore(): Promise<RateLimitStore> {
  try {
    const { getRedisClient } = await import('../cache/redis-client.js');
    const { loadEnv } = await import('../config/env.js');
    const env = loadEnv();
    const redis = getRedisClient(env);
    const { RedisRateLimitStore } = await import('./redis-rate-limit-store.js');
    return new RedisRateLimitStore(redis, new InMemoryRateLimitStore());
  } catch (err) {
    // fallback
  }
}
```

**Implementation Steps:**
1. [ ] Convert `initializeStore()` to async
2. [ ] Replace `require()` with dynamic `import()`
3. [ ] Register `rateLimitMiddleware` in app.ts
4. [ ] Add tests for middleware registration
5. [ ] Verify Redis store is used in production
6. [ ] Add metrics for store type usage

**Owner:** Backend Platform Team
**Reviewers:** Staff Engineer
**ETA:** 2 days

---

### P2-2: Client-Controlled Donation Redirect URLs [BACKEND]
**Finding:** `successUrl`/`cancelUrl` passed to Stripe without allowlist validation (open redirect/phishing vector).

**Files:**
- `src/services/donation-service.ts:20`
- `src/api/routes/donations.ts:15`
- `src/api/routes/donations.ts:33`

**Current Code:**
```typescript
// donation-service.ts:20
successUrl: z.string().url().optional(),
cancelUrl: z.string().url().optional(),
// donations.ts:15-16
const resolvedSuccessUrl = intent.successUrl ?? `${successOrigin}/donation/success?session_id={CHECKOUT_SESSION_ID}`;
const resolvedCancelUrl = intent.cancelUrl ?? `${successOrigin}/donation/cancel`;
```

**Remediation:**
```typescript
const ALLOWED_REDIRECT_ORIGINS = [
  'https://agrobridgefoundation.org',
  'https://www.agrobridgefoundation.org',
  'https://staging.agrobridgefoundation.org',
  'https://localhost:3000',
];
function validateRedirectUrl(url: string | undefined, defaultUrl: string): string {
  if (!url) return defaultUrl;
  try {
    const parsed = new URL(url);
    if (!ALLOWED_REDIRECT_ORIGINS.includes(parsed.origin)) {
      throw new Error(`Invalid redirect origin: ${parsed.origin}`);
    }
    if (parsed.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
      throw new Error('Redirect must use HTTPS in production');
    }
    return url;
  } catch {
    return defaultUrl;
  }
}
```

**Implementation Steps:**
1. [ ] Create `validateRedirectUrl()` utility
2. [ ] Add environment-based allowlist config
3. [ ] Update donation service schema
4. [ ] Update donations route
5. [ ] Add unit tests for validation
6. [ ] Add security test for open redirect attempts
7. [ ] Document allowed origins

**Owner:** Security Team
**Reviewers:** Staff Engineer, Payments Lead
**ETA:** 2 days

---

### P2-3: Account Lockout Not Persisted [BACKEND]
**Finding:** DB has lockout fields (`lockedUntil`, `failedLoginAttempts`) but login uses in-memory limiter only.

**Files:**
- `prisma/schema.prisma:172`
- `src/api/routes/auth.ts:16`
- `src/api/routes/auth.ts:71`
- `src/services/admin-user-service.ts:302`

**Current Code:**
```typescript
const loginRateLimiter = new LoginRateLimiter({
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,
  blockDurationMs: 15 * 60 * 1000,
});
```

**Remediation:**
```typescript
// Check database lockout first, then IP limiter
if (admin?.lockedUntil && admin.lockedUntil > new Date()) {
  const remainingMs = admin.lockedUntil.getTime() - Date.now();
  reply.header('Retry-After', Math.ceil(remainingMs / 1000).toString());
  reply.status(429);
  return fail({
    code: 'ACCOUNT_LOCKED',
    message: 'Account is temporarily locked due to failed login attempts.',
    details: { retryAfterSeconds: Math.ceil(remainingMs / 1000) },
  });
}
```

**Implementation Steps:**
1. [ ] Add `recordFailedAttempt()` to AuthService
2. [ ] Add `resetFailedAttempts()` to AuthService
3. [ ] Update login route to check DB lockout
4. [ ] Add migration for lockout fields (if needed)
5. [ ] Add tests for lockout flow
6. [ ] Add integration test for concurrent login attempts
7. [ ] Document security behavior

**Owner:** Backend Security Team
**Reviewers:** Staff Engineer
**ETA:** 3 days

---

### P2-4: Abuse Detector Counts All Logins as Failed [BACKEND]
**Finding:** Abuse detection increments `failedAttempts` on every login request, not just failed auth outcomes.

**Files:**
- `src/rate-limiting/abuse-detection.ts:60`
- `src/rate-limiting/abuse-detection.ts:61`

**Current Code:**
```typescript
if (req.routeOptions.url === '/api/auth/login' && req.method === 'POST') {
  metrics.failedAttempts++;
  if (metrics.failedAttempts >= this.FAILED_LOGIN_THRESHOLD) {
```

**Remediation:**
```typescript
async detectAbuse(req: FastifyRequest, authResult?: { success: boolean }): Promise<AbuseScore> {
  if (req.routeOptions.url === '/api/auth/login' && req.method === 'POST') {
    if (authResult?.success === false) {
      metrics.failedAttempts++;
      if (metrics.failedAttempts >= this.FAILED_LOGIN_THRESHOLD) {
        score += 40;
      }
    }
  }
}
```

**Implementation Steps:**
1. [ ] Modify `AbuseDetector` to accept auth results
2. [ ] Update auth route to pass results
3. [ ] Add tests for correct failure counting
4. [ ] Verify metrics accuracy
5. [ ] Update documentation

**Owner:** Backend Platform Team
**Reviewers:** Staff Engineer
**ETA:** 1 day

---

### P2-5: Mutable Main References in Contract Governance [FRONTEND]
**Finding:** Contract check fetches from `ref=main`, making results non-deterministic.

**Files:**
- `scripts/contracts/check-backend-contract.mjs:7`
- `.github/workflows/backend-gates.yml:273`

**Remediation:**
```javascript
const BACKEND_COMMIT_SHA = process.env.BACKEND_COMMIT_SHA || 'main';
const DEFAULT_BACKEND_OPENAPI_URL =
  `https://api.github.com/repos/.../openapi.v1.snapshot.json?ref=${BACKEND_COMMIT_SHA}`;
```

**Implementation Steps:**
1. [ ] Create contract lock file format
2. [ ] Update check script to use lock file
3. [ ] Add CI step to verify lock file matches deployment
4. [ ] Document contract update process
5. [ ] Add automated lock file update on backend release

**Owner:** SRE Team
**Reviewers:** Staff Engineer
**ETA:** 2 days

---

### P2-6: Deep Health Endpoint Exposes Internal Details [BACKEND]
**Finding:** Health endpoint returns memory, CPU, platform info increasing reconnaissance surface.

**Files:**
- `src/api/routes/health.ts:56`
- `src/api/routes/health.ts:133`

**Remediation:**
```typescript
app.get('/health', async () => {
  return ok({ status: 'ok' });
});
app.get('/health/deep', async (req) => {
  await requireAdmin(req);
  return ok({
    status: 'ok',
    memory: process.memoryUsage(),
    uptime: process.uptime(),
    platform: process.platform,
  });
});
```

**Implementation Steps:**
1. [ ] Split health endpoints
2. [ ] Add auth to deep health
3. [ ] Update monitoring to use appropriate endpoint
4. [ ] Document endpoint differences
5. [ ] Update load balancer health checks

**Owner:** Backend Platform Team
**Reviewers:** SRE Team
**ETA:** 1 day

---

## WAVE 2: POLISH & HARDENING (Weeks 4-6)
**Goal:** Address P3 findings, improve test coverage, and establish long-term excellence

### P3-1: Template Injection Bypass [FRONTEND]
**Finding:** `{{!variable}}` syntax bypasses HTML escaping. Safe only if deploy-time env is trusted.

**Files:**
- `public_html/server.js:113`
- `public_html/server.js:147`
- `public_html/index.html:9`

**Remediation:**
```javascript
const ALLOWED_RAW_KEYS = ['cspNonce'];
function renderTemplate(template, replacements) {
  return template.replace(/{{\s*(!?)([a-zA-Z0-9_-]+)\s*}}/g, (match, rawFlag, key) => {
    if (!Object.prototype.hasOwnProperty.call(replacements, key)) {
      return match;
    }
    const value = replacements[key];
    if (rawFlag === '!') {
      if (!ALLOWED_RAW_KEYS.includes(key)) {
        throw new Error(`Raw template value not allowed for key: ${key}`);
      }
      return value;
    }
    return escapeHtml(value);
  });
}
```

**Implementation Steps:**
1. [ ] Add explicit allowlist for raw keys
2. [ ] Add audit logging
3. [ ] Add tests for template injection attempts
4. [ ] Document security model
5. [ ] Review all template usages

**Owner:** Security Team
**Reviewers:** Staff Engineer
**ETA:** 2 days

---

### P3-2: API Client Error Collapse [FRONTEND]
**Finding:** `Error("[object Object]")` when backend returns structured errors.

**Files:**
- `public_html/assets/js/api.js:55`

**Remediation:**
```javascript
async function handleApiError(response) {
  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    const errorData = await response.json();
    const error = new Error(errorData.message || errorData.error?.message || 'API Error');
    error.code = errorData.code || errorData.error?.code;
    error.details = errorData.details || errorData.error?.details;
    error.status = response.status;
    throw error;
  }
  const text = await response.text();
  throw new Error(text || `HTTP ${response.status}`);
}
```

**Implementation Steps:**
1. [ ] Update error extraction logic
2. [ ] Add structured error types
3. [ ] Update error handling in all API calls
4. [ ] Add tests for various error formats
5. [ ] Document error structure

**Owner:** Frontend Team
**Reviewers:** Staff Engineer
**ETA:** 1 day

---

### P3-3: Inconsistent UUID Validation [BACKEND]
**Finding:** Restore/reset paths skip UUID format checks while other endpoints validate.

**Files:**
- `src/api/routes/admin-users.ts:121` (restore - no validation)
- `src/api/routes/admin-users.ts:136` (reset-password - no validation)
- `src/api/routes/campaigns.ts:194` (restore - no validation)

**Remediation:**
```typescript
const uuidSchema = z.string().uuid();
const parseResult = uuidSchema.safeParse(id);
if (!parseResult.success) {
  reply.status(400);
  return fail({ code: 'VALIDATION_ERROR', message: 'Invalid user ID format' });
}
```

**Implementation Steps:**
1. [ ] Add UUID validation to restore endpoints
2. [ ] Add UUID validation to reset-password endpoint
3. [ ] Create reusable validation middleware
4. [ ] Add tests for invalid UUID handling
5. [ ] Document validation requirements

**Owner:** Backend API Team
**Reviewers:** Staff Engineer
**ETA:** 1 day

---

## BRANCH PROTECTION & GOVERNANCE CHANGES
### Required GitHub Settings
```yaml
branches:
  - name: main
    protection:
      required_pull_request_reviews:
        required_approving_review_count: 2
        dismiss_stale_reviews: true
        require_code_owner_reviews: true
      required_status_checks:
        strict: true
        contexts:
          - "Unit Tests"
          - "Lint"
          - "E2E Tests"
          - "Security Audit"
          - "Bundle Size Check"
          - "Contract Check"
          - "Lighthouse CI"
      enforce_admins: true
      required_linear_history: true
      allow_force_pushes: false
      allow_deletions: false
      required_conversation_resolution: true
environments:
  - name: production-frontend
    protection_rules:
      - type: required_reviewers
        reviewers: 2
      - type: wait_timer
        wait_timer: 300
  - name: production-backend
    protection_rules:
      - type: required_reviewers
        reviewers: 2
      - type: wait_timer
        wait_timer: 300
```

---

## TESTING REQUIREMENTS
### New Test Coverage
| Component | Current | Target | Priority |
|-----------|---------|--------|----------|
| Rate limiting middleware | 0% | 90% | P1 |
| Donation redirect validation | 0% | 95% | P1 |
| Account lockout persistence | 0% | 90% | P1 |
| Abuse detection accuracy | 40% | 90% | P2 |
| Template rendering security | 60% | 90% | P3 |
| API error handling | 50% | 85% | P3 |
| UUID validation consistency | 70% | 95% | P3 |

### Security Tests to Add
1. **Open Redirect Test Suite**
   ```javascript
   const maliciousUrls = [
     'https://evil.com/phishing',
     '//evil.com',
     '/\\evil.com',
     'javascript:alert(1)',
     'data:text/html,<script>alert(1)</script>',
   ];
   ```
2. **Rate Limiting Bypass Tests**
   - IP spoofing attempts
   - Distributed attack simulation
   - Header manipulation
3. **Contract Gate Failure Tests**
   - Missing schema scenarios
   - Malformed OpenAPI specs
   - Network failures

---

## METRICS & MONITORING
### Key Metrics to Track
| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Deployment success rate | >99.5% | <99% |
| Contract check pass rate | 100% | <100% |
| Rate limit enforcement | 100% | <100% |
| Failed login tracking accuracy | >99% | <95% |
| Average time to rollback | <5 min | >10 min |
| Security scan pass rate | 100% | <100% |

### Dashboards
1. **CI/CD Health Dashboard**
   - Workflow success rates
   - Deployment frequency
   - Mean time to recovery
2. **Security Dashboard**
   - Failed login attempts
   - Rate limit triggers
   - Abuse score distribution
3. **Contract Compliance Dashboard**
   - Schema coverage
   - Breaking change alerts
   - Version drift detection

---

## SUCCESS CRITERIA
### Definition of Done for 8.5+ Score
- [ ] Zero P1 findings remaining
- [ ] All P2 findings addressed with tests
- [ ] P3 findings resolved or accepted with risk documentation
- [ ] Branch protection rules enforced
- [ ] All CI checks passing with 100% reliability
- [ ] Security scan: Zero high/critical vulnerabilities
- [ ] Test coverage: >85% lines, >80% branches
- [ ] Contract checks: Strict mode, 100% pass rate
- [ ] Incident response: <5 min rollback capability
- [ ] Documentation: Complete runbooks for all P1/P2 scenarios

---

## RISK MITIGATION
### Rollback Strategy
Each wave is independently deployable:
- **Wave 0:** Can rollback individual workflow changes
- **Wave 1:** Feature flags for new security behaviors
- **Wave 2:** No breaking changes, additive only

### Communication Plan
| Stakeholder | Notification | Timing |
|-------------|--------------|--------|
| Engineering | Slack #deployments | Real-time |
| Security | Security review | Before Wave 0 |
| Leadership | Weekly status | Fridays |
| On-call | Runbook updates | Before each wave |

---

## APPENDIX
### A. Full File Inventory
**Frontend (`agrobridge-foundation-web`):**
- `.github/workflows/frontend.yml` - TO BE MERGED
- `.github/workflows/frontend-optimized.yml` - TO BE RENAMED
- `.github/workflows/rollback.yml` - MODIFIED
- `scripts/contracts/check-backend-contract.mjs` - MODIFIED
- `public_html/server.js` - MODIFIED
- `public_html/assets/js/api.js` - MODIFIED

**Backend (`agrobridge-foundation-backend`):**
- `src/app.ts` - MODIFIED
- `src/rate-limiting/tiered-rate-limiter.ts` - MODIFIED
- `src/rate-limiting/middleware.ts` - UNCHANGED (already correct)
- `src/rate-limiting/abuse-detection.ts` - MODIFIED
- `src/api/routes/donations.ts` - MODIFIED
- `src/api/routes/auth.ts` - MODIFIED
- `src/api/routes/health.ts` - MODIFIED
- `src/api/routes/admin-users.ts` - MODIFIED
- `src/api/routes/campaigns.ts` - MODIFIED
- `src/services/donation-service.ts` - MODIFIED

### B. Open Questions Resolution
1. **Environment required reviewers:**
   - Configure `production-frontend` and `production-backend` environments
   - Require 2 reviewers from on-call rotation
2. **Repository_dispatch rollback exposure:**
   - Remove entirely, use workflow_dispatch with confirmation
3. **Custom successUrl/cancelUrl requirement:**
   - Accept constraint: Allowlist-based only
   - Document allowed origins in deployment config
4. **Contract SHA pinning:**
   - Implement lock file approach
   - Pin to backend release commit SHA

---

**END OF PLAN**

*This document is a living artifact. Update as findings are resolved and new issues are discovered.*
