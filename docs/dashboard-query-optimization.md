# Admin Dashboard Query Optimization

This document captures the reasoning and implementation for the admin dashboard metrics query.

## Problem

A naive implementation of `donorCount` can be:

- `findMany(distinct: [donorEmail])` and then `length`

This becomes expensive as the donation table grows because it materializes many rows and transfers them to the application.

## Solution

Use a DB-level aggregate:

- `COUNT(DISTINCT donorEmail)`

Implementation:

- `DonationRepository.dashboardMetrics()` now returns `donorCount` computed via `$queryRaw`:

```sql
SELECT COUNT(DISTINCT "donorEmail")
FROM "Donation"
WHERE "donorEmail" IS NOT NULL
```

## Why This Is Safe

- Query returns a single row (O(1) payload size).
- No PII is returned (only a count).
- The query is parameter-free and does not include user input.

## Operational Notes

- Ensure there is an index on `donorEmail` to support distinct counting at scale.
- If this becomes a hot query under heavy admin usage, consider caching results for a short TTL (e.g., 10-30s).
