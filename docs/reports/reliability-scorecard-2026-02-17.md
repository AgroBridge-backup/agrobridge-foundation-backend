# Weekly Reliability Scorecard (2026-02-17)

Period: 2026-02-10T15:05:35.193Z to 2026-02-17T15:05:35.193Z

## Metrics

| Metric | Value |
| --- | --- |
| Flake rate | N/A |
| Required gate pass rate (job-level) | N/A |
| CI recovery MTTR (minutes) | N/A |
| Service incident MTTR (minutes) | N/A |
| CI incident count | 0 |
| Contract drift events | 0 |

## Notes

- Required gate set: lint, build, unit, integration, e2e
- Flake rate uses workflow rerun attempts (`run_attempt > 1`).
- Required gate pass rate is computed from required job-level conclusions per Backend Gates run.
- Contract drift events count failed `contracts` or `frontend-compat` jobs.
- `N/A` indicates no-data windows or unavailable incident telemetry.

## Warnings

- Backend Gates workflow not found; using repository-level run fallback.
- No Backend Gates runs found in the last 7 days.
- Service incident MTTR data not configured (set SERVICE_INCIDENT_MTTR_MINUTES or integrate an incident source).
- No-data window: no Backend Gates runs were completed in the lookback period.
