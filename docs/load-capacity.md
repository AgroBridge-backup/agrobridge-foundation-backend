# Load and Capacity Plan

This document describes how we think about capacity for the MVP, what bottlenecks to expect, and how to scale safely.

## Baseline Assumptions (MVP)

Traffic profile:

- Public:
  - low-to-moderate RPS (bursty during campaigns)
  - donation intent calls are the highest value requests
- Admin:
  - low volume
- Webhooks:
  - bursty, driven by Stripe retries and event delivery

Data profile:

- Donations table grows steadily.
- Admin queries primarily sort/filter by `createdAt` and `status`.

## Performance Invariants

- Donation creation should be O(1) with indexes.
- Webhook processing must be idempotent and safe under retries.
- Admin list endpoint must remain stable as data grows.

## Known Bottlenecks

### 1) Database IO and indexing

Symptoms:

- Admin list becomes slow.
- Dashboard aggregate becomes slow.

Mitigations:

- Ensure indexes are aligned with query patterns:
  - `Donation(status, createdAt)`
  - `Donation(createdAt)`
  - `Donation(donorEmail)`
  - `Donation(stripeSessionId)` unique
- For dashboard, consider pre-aggregations if traffic grows (Phase 2).

### 2) Stripe API latency

Symptoms:

- `/api/donations/intent` latency spikes.

Mitigations:

- Use Stripe idempotency keys for session create (future enhancement).
- Keep timeouts sane.
- Avoid doing extra work in intent route.

### 3) Webhook bursts and retries

Symptoms:

- Large number of webhook deliveries in short time.

Mitigations:

- Keep webhook handler O(1), minimal DB writes.
- Persist event, process, mark processed.
- If necessary, move processing to async worker (future enhancement) while still acking quickly.

## Sizing Guidelines (Starting Point)

### ECS (API)

- Start: 2 tasks (for redundancy)
- CPU/memory: 0.25 vCPU / 0.5GB or 0.5 vCPU / 1GB depending on load
- Auto-scaling:
  - scale out on CPU > 70% for 5 minutes
  - scale out on ALB RequestCountPerTarget baseline

### RDS

- Start: small instance class (burstable) for MVP
- Enable:
  - automated backups + PITR
  - monitoring (Enhanced Monitoring / Performance Insights)

## Load Testing Plan (Practical)

### Key scenarios

1. Donation intent (public critical path)

- generate 50-200 RPS burst for 60s
- measure p95, error rate

2. Admin list

- create 100k donations
- measure list endpoint p95 under concurrent requests

3. Webhook burst

- replay 1k webhook events
- verify idempotency and DB stability

### What to measure

- API:
  - p95 latency, 5xx rate
- DB:
  - CPU, connections, slow queries
- Stripe:
  - session create latency

## Scaling Playbook

### If API CPU is high

- Scale ECS tasks.
- Confirm DB is not the bottleneck.

### If DB is the bottleneck

- Add/adjust indexes.
- Reduce expensive aggregates (cache dashboard for N seconds).
- Scale RDS instance.
- Consider read replica for admin read traffic.

### If webhooks are backlogged

- Ensure signature verification is not failing (avoid retries).
- Consider async queue worker model:
  - webhook endpoint persists event + enqueues processing
  - worker processes events and updates donations

## Data Growth

- Donation rows: assume unbounded growth.
- Strategy:
  - keep hot indexes minimal
  - consider partitioning by month in future if needed
  - periodically verify query plans via `EXPLAIN ANALYZE` for admin endpoints
