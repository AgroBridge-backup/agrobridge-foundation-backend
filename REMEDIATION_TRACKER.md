# FAANG Remediation Progress Tracker

**Status Legend:**
- 🔴 Not Started
- 🟡 In Progress
- 🟢 Complete
- ⚪ Deferred

---

## WAVE 0: EMERGENCY STABILIZATION (Target: End of Week 1)

### P1-1: Duplicate CI/CD Workflows
| Task | Status | Owner | Due Date | Notes |
|------|--------|-------|----------|-------|
| Backup frontend.yml | 🔴 | | | |
| Rename frontend-optimized.yml -> frontend.yml | 🔴 | | | |
| Update branch protection rules | 🔴 | | | GitHub UI |
| Test on feature branch | 🔴 | | | |
| Delete old files | 🔴 | | | After verification |
| Update AGENTS.md | 🔴 | | | |

**RISK:** High - Parallel deploys can cause issues

---

### P1-2: Placeholder Stripe Keys
| Task | Status | Owner | Due Date | Notes |
|------|--------|-------|----------|-------|
| Verify production secret exists | 🔴 | | | Check GitHub |
| Verify staging secret exists | 🔴 | | | Check GitHub |
| Update frontend.yml (line 490) | 🔴 | | | Use secrets. |
| Update frontend-optimized.yml (line 567) | 🔴 | | | Use secrets. |
| Add validation step | 🔴 | | | Key format check |
| Test in staging | 🔴 | | | Verify donations work |
| Deploy to production | 🔴 | | | Coordinate with payments |

**RISK:** Critical - Payments may break

---

### P1-3: Fail-Open Contract Gate
| Task | Status | Owner | Due Date | Notes |
|------|--------|-------|----------|-------|
| Add --strict flag support | 🔴 | | | |
| Update CI to use strict mode | 🔴 | | | |
| Fix "Default Response" in OpenAPI | 🔴 | | | Backend repo |
| Add proper response schemas | 🔴 | | | |
| Test contract failures | 🔴 | | | |
| Add to pre-commit hooks | 🔴 | | | Optional |

**RISK:** High - API changes can break frontend silently

---

### P1-4: Rollback Workflow Security
| Task | Status | Owner | Due Date | Notes |
|------|--------|-------|----------|-------|
| Remove repository_dispatch trigger | 🔴 | | | |
| Create production-frontend environment | 🔴 | | | GitHub UI |
| Configure 2 required reviewers | 🔴 | | | |
| Add 5-minute wait timer | 🔴 | | | |
| Add confirmation input | 🔴 | | | ROLLBACK-PRODUCTION |
| Update runbook | 🔴 | | | |
| Test in staging | 🔴 | | | |

**RISK:** High - Unauthorized production access

---

## WAVE 1: SECURITY & RELIABILITY (Target: End of Week 3)

### P2-1: Tiered Rate Limiting
| Task | Status | Owner | Due Date | Notes |
|------|--------|-------|----------|-------|
| Convert initializeStore to async | 🟡 | | | ESM issue fixed; async conversion still pending decision |
| Replace require() with dynamic import | 🟢 | | | `require()` removed; ESM import path verified |
| Register middleware in app.ts | 🟢 | | | `app.addHook('onRequest', ...)` calls `rateLimitMiddleware` |
| Add registration tests | 🔴 | | | |
| Verify Redis usage in prod | 🔴 | | | |
| Add store type metrics | 🟢 | | | `store_type` labels emitted in rate-limit metrics |

### P2-2: Donation Redirect Validation
| Task | Status | Owner | Due Date | Notes |
|------|--------|-------|----------|-------|
| Create validateRedirectUrl() util | 🟢 | | | Implemented in `src/utils/redirect-url.ts` |
| Add ALLOWED_REDIRECT_ORIGINS config | 🟢 | | | Implemented as `DONATION_REDIRECT_ORIGINS` + `CORS_ORIGIN` fallback |
| Update donation-service.ts | 🟡 | | | Schema unchanged; route enforces allowlist before Stripe |
| Update donations.ts route | 🟢 | | | Route now validates `successUrl`/`cancelUrl` |
| Add unit tests | 🟢 | | | `tests/unit/utils/redirect-url.test.ts` passing |
| Add security tests | 🟢 | | | Open-redirect fallback covered in `tests/integration/donations-intent.int.test.ts` |
| Document allowed origins | 🔴 | | | |

### P2-3: Account Lockout Persistence
| Task | Status | Owner | Due Date | Notes |
|------|--------|-------|----------|-------|
| Add recordFailedAttempt() to service | 🟢 | | | Implemented in `src/services/auth-service.ts` |
| Add resetFailedAttempts() to service | 🟢 | | | Implemented in `src/services/auth-service.ts` |
| Update login route | 🟢 | | | DB lockout + `Retry-After` handling present |
| Add migration if needed | ⚪ | | | Existing schema fields already present |
| Add lockout tests | 🟢 | | | Covered in `tests/unit/auth-service.test.ts` and `tests/integration/auth.int.test.ts` |
| Add concurrent attempt tests | 🔴 | | | |
| Document security behavior | 🔴 | | | |

### P2-4: Abuse Detection Accuracy
| Task | Status | Owner | Due Date | Notes |
|------|--------|-------|----------|-------|
| Modify detectAbuse signature | ⚪ | | | Equivalent fix used: `recordFailedLogin(ip)` method |
| Update auth route | 🟢 | | | Auth failure path now calls `abuseDetector.recordFailedLogin(ip)` |
| Add tests for correct counting | 🟢 | | | `tests/unit/rate-limiting/abuse-detection.test.ts` passing |
| Verify metrics accuracy | 🟡 | | | Unit-level verified; production telemetry validation pending |
| Update docs | 🔴 | | | |

### P2-5: Contract SHA Pinning
| Task | Status | Owner | Due Date | Notes |
|------|--------|-------|----------|-------|
| Create lock file format | 🔴 | | | |
| Update check script | 🔴 | | | |
| Add CI verification | 🔴 | | | |
| Document update process | 🔴 | | | |
| Automate lock file updates | 🔴 | | | On backend release |

### P2-6: Deep Health Endpoint
| Task | Status | Owner | Due Date | Notes |
|------|--------|-------|----------|-------|
| Split shallow/deep endpoints | 🟢 | | | `/health` and `/health/deep` both implemented |
| Add auth to deep health | 🟢 | | | `/health/deep` guarded by `requireAdmin` |
| Update monitoring | 🔴 | | | Use shallow |
| Update load balancers | 🔴 | | | Use shallow |
| Document endpoints | 🟡 | | | Route-level behavior is explicit; runbook/docs still pending |

---

## WAVE 2: POLISH & HARDENING (Target: End of Week 6)

### P3-1: Template Injection Security
| Task | Status | Owner | Due Date | Notes |
|------|--------|-------|----------|-------|
| Add ALLOWED_RAW_KEYS | 🔴 | | | |
| Add audit logging | 🔴 | | | |
| Add tests | 🔴 | | | Injection attempts |
| Review all template usages | 🔴 | | | |
| Document security model | 🔴 | | | |

### P3-2: API Error Handling
| Task | Status | Owner | Due Date | Notes |
|------|--------|-------|----------|-------|
| Update error extraction | 🔴 | | | |
| Add structured error types | 🔴 | | | |
| Update API calls | 🔴 | | | |
| Add tests | 🔴 | | | Various formats |
| Document structure | 🔴 | | | |

### P3-3: UUID Validation Consistency
| Task | Status | Owner | Due Date | Notes |
|------|--------|-------|----------|-------|
| Add validation to admin restore | 🟢 | | | UUID validation added |
| Add validation to reset-password | 🟢 | | | UUID validation added |
| Add validation to campaign restore | 🟢 | | | UUID validation added |
| Create reusable middleware | ⚪ | | | Optional; deferred for now |
| Add tests | 🟢 | | | `tests/integration/uuid-validation.int.test.ts` passing |
| Document requirements | 🔴 | | | |

---

## INFRASTRUCTURE & GOVERNANCE

### GitHub Configuration
| Task | Status | Owner | Due Date | Notes |
|------|--------|-------|----------|-------|
| Create production-frontend env | 🔴 | | | GitHub UI |
| Create production-backend env | 🔴 | | | GitHub UI |
| Create staging-frontend env | 🔴 | | | GitHub UI |
| Create staging-backend env | 🔴 | | | GitHub UI |
| Configure required reviewers | 🔴 | | | 2 for prod, 1 for staging |
| Configure wait timers | 🔴 | | | 5 min for prod |
| Update branch protection | 🔴 | | | main branch |

### Secrets Audit
| Secret | Location | Status | Verified | Notes |
|--------|----------|--------|----------|-------|
| STRIPE_PUBLISHABLE_KEY | frontend | 🔴 | | Must be pk_live_ |
| STRIPE_PUBLISHABLE_KEY_TEST | frontend | 🔴 | | Must be pk_test_ |
| STRIPE_SECRET_KEY | backend | 🔴 | | Must be sk_live_ |
| STRIPE_WEBHOOK_SECRET | backend | 🔴 | | |
| SSH_PRIVATE_KEY | both | 🔴 | | |
| PRODUCTION_SERVER_HOST | frontend | 🔴 | | |
| STAGING_SERVER_HOST | frontend | 🔴 | | |

---

## TESTING COVERAGE
| Component | Current | Target | Status | Notes |
|-----------|---------|--------|--------|-------|
| Rate limiting middleware | 0% | 90% | 🟡 | Middleware wired; dedicated registration test still missing |
| Donation redirect validation | 0% | 95% | 🟢 | Unit + integration coverage added and passing |
| Account lockout | 0% | 90% | 🟢 | Unit + integration lockout tests present |
| Abuse detection | 40% | 90% | 🟢 | Unit tests for failed-login counting behavior passing |
| Template rendering | 60% | 90% | 🔴 | |
| API error handling | 50% | 85% | 🔴 | |
| UUID validation | 70% | 95% | 🟢 | Integration UUID validation suite passing |

---

## SCORE TRACKING
| Week | Security | Reliability | CI/CD | Quality | Tests | Overall |
|------|----------|-------------|-------|---------|-------|---------|
| Week 0 | 6.3 | 6.8 | 6.1 | 7.5 | 8.4 | 7.0 |
| Week 1 | 7.5 | 7.5 | 7.8 | 7.8 | 8.5 | 7.8 |
| Week 3 | 8.2 | 8.3 | 8.5 | 8.3 | 8.7 | 8.4 |
| Week 6 | 8.8 | 8.7 | 9.0 | 8.6 | 8.8 | 8.8 |
| **TARGET** | **8.5** | **8.5** | **8.5** | **8.5** | **8.5** | **8.5+** |

---

## BLOCKERS & DEPENDENCIES
| Blocker | Blocking | ETA | Owner |
|---------|----------|-----|-------|
| None currently | - | - | - |

---

## DECISION LOG
| Date | Decision | Rationale | Decision Maker |
|------|----------|-----------|----------------|
| 2026-02-17 | Mark backend P2/P3 tracker tasks by code/test evidence only | Avoid over-reporting progress; keep unresolved ops/docs tasks explicit | IC8 Engineering |
| 2026-02-17 | Treat P2-4 \"detectAbuse signature\" as deferred-equivalent | Behavior fixed via `recordFailedLogin` path without API signature churn | IC8 Engineering |

---

## SIGN-OFFS
| Role | Name | Wave 0 | Wave 1 | Wave 2 | Final |
|------|------|--------|--------|--------|-------|
| Staff Engineer | | | | | |
| Security Lead | | | | | |
| SRE Lead | | | | | |
| Product Owner | | | | | |

---

**Last Updated:** 2026-02-17
**Next Review:** 2026-02-18
