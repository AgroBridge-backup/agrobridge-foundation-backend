# FAANG Remediation Quick Reference

## Week 1 Priorities (Wave 0 - P1 Fixes)

### Monday: CI/CD Consolidation
```bash
# 1. Backup existing workflows
cp .github/workflows/frontend.yml .github/workflows/frontend.legacy.yml
# 2. Merge and rename
git mv .github/workflows/frontend-optimized.yml .github/workflows/frontend.yml
# 3. Update branch protection (GitHub UI)
# Settings > Branches > main > Edit
# - Remove: Unit Tests, Lint, E2E Tests (old names)
# - Add: Unit Tests, Lint, E2E Tests (from unified workflow)
```

### Tuesday: Stripe Key Fix
```yaml
# In .github/workflows/frontend.yml
# BEFORE (line 490):
echo "STRIPE_PUBLISHABLE_KEY=pk_live_..." >> .env
# AFTER:
echo "STRIPE_PUBLISHABLE_KEY=${{ secrets.STRIPE_PUBLISHABLE_KEY }}" >> .env
# Add validation step:
- name: Validate Stripe Key
  run: |
    if [[ ! "${{ secrets.STRIPE_PUBLISHABLE_KEY }}" =~ ^pk_live_ ]]; then
      echo "::error::Invalid Stripe production key"
      exit 1
    fi
```

### Wednesday: Contract Gate Hardening
```javascript
// scripts/contracts/check-backend-contract.mjs:262
// BEFORE:
const result = failures.length > 0 ? 'fail' : 'pass';
// AFTER (strict mode):
const strictMode = process.env.CONTRACT_STRICT === 'true';
const result = (failures.length > 0 || (strictMode && warnings.length > 0))
  ? 'fail'
  : 'pass';
```

### Thursday-Friday: Rollback Security
```yaml
# .github/workflows/rollback.yml
# BEFORE: Has repository_dispatch trigger
# AFTER: Remove repository_dispatch, add environment
on:
  workflow_dispatch:
    inputs:
      # ... existing inputs ...
      confirm_production:
        description: 'Type ROLLBACK-PRODUCTION to confirm'
        required: true
jobs:
  rollback-production:
    environment: production-frontend  # Requires approval
    steps:
      - name: Verify Confirmation
        run: |
          if [[ "${{ inputs.confirm_production }}" != "ROLLBACK-PRODUCTION" ]]; then
            echo "::error::Production rollback not confirmed"
            exit 1
          fi
```

---

## Week 2-3 Priorities (Wave 1 - P2 Fixes)

### Rate Limiting Fix
```typescript
// src/app.ts
// Add after line 101 (after CORS registration)
app.addHook('onRequest', async (req, reply) => {
  await rateLimitMiddleware(req, reply, () => {});
});

// src/rate-limiting/tiered-rate-limiter.ts:34
// Convert to async dynamic import:
private async initializeStore(): Promise<RateLimitStore> {
  try {
    const { getRedisClient } = await import('../cache/redis-client.js');
    const { RedisRateLimitStore } = await import('./redis-rate-limit-store.js');
    // ... rest
  }
}
```

### Donation Redirect Validation
```typescript
// src/api/routes/donations.ts
const ALLOWED_ORIGINS = process.env.ALLOWED_REDIRECT_ORIGINS?.split(',') || [
  'https://agrobridgefoundation.org',
  'https://staging.agrobridgefoundation.org',
];

function validateRedirectUrl(url: string | undefined, defaultUrl: string): string {
  if (!url) return defaultUrl;
  const parsed = new URL(url);
  if (!ALLOWED_ORIGINS.includes(parsed.origin)) {
    console.warn(`Rejected redirect to: ${parsed.origin}`);
    return defaultUrl;
  }
  return url;
}

const resolvedSuccessUrl = validateRedirectUrl(intent.successUrl, defaultSuccessUrl);
```

---

## GitHub Settings Checklist

### Environments to Create
- [ ] `production-frontend` - Required reviewers: 2
- [ ] `production-backend` - Required reviewers: 2
- [ ] `staging-frontend` - Required reviewers: 1
- [ ] `staging-backend` - Required reviewers: 1

### Secrets to Verify
- [ ] `STRIPE_PUBLISHABLE_KEY` - Must start with pk_live_
- [ ] `STRIPE_PUBLISHABLE_KEY_TEST` - Must start with pk_test_
- [ ] `STRIPE_SECRET_KEY` - Backend only
- [ ] `STRIPE_WEBHOOK_SECRET` - Backend only

### Branch Protection for `main`
- [ ] Require 2 approving reviews
- [ ] Dismiss stale reviews
- [ ] Require code owner review
- [ ] Require status checks to pass
- [ ] Require branches to be up to date
- [ ] Require conversation resolution
- [ ] Include administrators

---

## Testing Commands
```bash
# Run all checks locally before pushing
npm run lint
npm run test
npm run test:e2e
npm run check-size

# Backend (from backend repo)
npm run lint
npm run test:unit
npm run test:integration
npm run contracts:check
```

---

## Emergency Contacts
| Issue | Contact | Slack |
|-------|---------|-------|
| CI/CD Failures | SRE On-call | #sre-urgent |
| Security Issues | Security Team | #security |
| Payment Issues | Payments Lead | #payments |
| Deployment Blocked | Staff Engineer | #engineering |

---

## Risk Acceptance Criteria
If any P3 issue cannot be immediately fixed, document:
1. Risk description
2. Mitigation in place
3. Timeline for full fix
4. Approval from Staff Engineer + Security
