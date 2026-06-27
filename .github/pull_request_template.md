## Summary

<!-- What does this PR do, in 1-3 sentences? -->

## Why

<!-- The problem/motivation. Why is this change needed? -->

## How verified

- [ ] `npm run build` passes
- [ ] `npm run test:unit` passes (or relevant tier)
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run knip` passes (no dead code introduced)
- [ ] Manually verified: <!-- describe the manual check, or state "N/A — no manual check needed" -->

## What could break

<!-- Call out the blast radius. What existing behavior changes? What consumers (frontend, donors, admins, webhooks) could be affected? -->

## Did this add a module?

<!-- If yes, where is it wired in? (e.g. route registered in src/api/routes/index.ts, service instantiated in app.ts) If no, write "N/A". -->

- [ ] N/A — no new module
- [ ] Wired in at: <!-- path -->

## Security & money-path check

- [ ] This change does **not** move money or change the Stripe flow. If it does, describe the guards:
- [ ] Auth model is correct (which roles / capabilities can reach each endpoint?)
- [ ] No secrets, PII, or internal identifiers are leaked to unauthorized callers
- [ ] Inputs are validated (Zod) and SQL/ReDoS/SSRF vectors considered
