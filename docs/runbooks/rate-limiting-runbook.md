# Rate Limiting Operational Runbook

**Version**: 1.0
**Last Updated**: 2025-01-26
**Service**: Rate Limiting System
**On-Call**: Platform Team

---

## Quick Reference

| Metric         | Endpoint                  | Command                                        |
| -------------- | ------------------------- | ---------------------------------------------- |
| Health Check   | `/api/health/rate-limit`      | `curl localhost:3000/api/health/rate-limit` |
| Deep Health (admin auth required) | `/api/health/rate-limit/deep` | `curl -H "Cookie: ab_admin=<signed-jwt>" localhost:3000/api/health/rate-limit/deep` |
| Redis Ping     | Redis CLI                 | `redis-cli -h <host> -p <port> ping`           |
| Redis Slow Log | Redis CLI                 | `redis-cli -h <host> -p <port> SLOWLOG GET 10` |
| Redis Memory   | Redis CLI                 | `redis-cli -h <host> -p <port> INFO memory`    |

---

## Alert Conditions

### 🔴 Critical Alerts

1. **Rate Limit Circuit Breaker Open on >50% Nodes**
   - Condition: `rate_limit_circuit_breaker_open > 0.5` for 10 minutes
   - Severity: CRITICAL
   - Impact: All requests using fallback, degraded performance

2. **Rate Limit Service Unhealthy**
   - Condition: `/health/rate-limit` returns 503
   - Severity: CRITICAL
   - Impact: Service unavailable

### 🟡 Warning Alerts

3. **High Rate Limit Error Rate**
   - Condition: `rate(rate_limit_errors_total[5m]) > 10`
   - Severity: WARNING
   - Impact: Degraded rate limiting

4. **Rate Limit Fallback Active**
   - Condition: `rate(rate_limit_fallbacks_total[5m]) > 5` for 5 minutes
   - Severity: WARNING
   - Impact: Using in-memory fallback, may have inconsistencies

5. **High Rate Limit Latency**
   - Condition: `histogram_quantile(0.99, rate(rate_limit_check_duration_seconds_bucket[5m])) > 0.1`
   - Severity: WARNING
   - Impact: Slow response times

6. **High Memory Usage**
   - Condition: Process memory > 1GB
   - Severity: WARNING
   - Impact: Potential OOM

---

## Troubleshooting Guide

### 1. High Error Rate 🔴

#### Symptoms

- Alert: "High Rate Limit Error Rate"
- Increase in `rate_limit_errors_total` metric
- Rate limit check failures in logs

#### Diagnosis

```bash
# Check error breakdown
rate(rate_limit_errors_total[5m]) by (error_type)

# Check specific error types
rate_limit_errors_total{error_type="ETIMEDOUT"}
rate_limit_errors_total{error_type="ECONNRESET"}
```

#### Resolution Steps

**Step 1: Check Redis Health**

```bash
# Check if Redis is responsive
redis-cli -h <redis-host> -p <redis-port> ping

# Expected response: PONG
# If connection fails: Redis is down or unreachable
```

**Step 2: Check Redis Memory**

```bash
redis-cli -h <redis-host> -p <redis-port> INFO memory

# Check: used_memory, used_memory_peak, used_memory_rss
# If >80% maxmemory: Redis is OOM
```

**Step 3: Check Redis Connections**

```bash
redis-cli -h <redis-host> -p <redis-port> INFO clients

# Check: connected_clients, blocked_clients
# If > maxclients: Connection pool exhausted
```

**Step 4: Check Network Connectivity**

```bash
# From application server to Redis
telnet <redis-host> <redis-port>
# Or: nc -zv <redis-host> <redis-port>

# Check latency
redis-cli -h <redis-host> -p <redis-port> --latency
```

**Step 5: Review Application Logs**

```bash
# Search for Redis errors
grep -i "redis" /var/log/agrobridge/app.log | tail -100

# Search for rate limit errors
grep -i "rate limit" /var/log/agrobridge/app.log | tail -100
```

#### Escalation Path

- **If Redis is down**: Contact Redis team immediately
- **If network issues**: Contact network team
- **If application errors**: Review recent deployments
- **If unresolvable within 15 min**: Declare incident

---

### 2. Rate Limit Fallback Active 🟡

#### Symptoms

- Alert: "Rate Limit Fallback Active"
- Increase in `rate_limit_fallbacks_total`
- Circuit breaker open on some nodes
- `store_type` metric shows "in_memory"

#### Diagnosis

```bash
# Check health endpoint
curl http://localhost:3000/api/health/rate-limit

# Check circuit breaker state
curl http://localhost:3000/api/health/rate-limit/deep | jq '.details.circuitBreaker'

# Check fallback rate
rate(rate_limit_fallbacks_total[5m])
```

#### Resolution Steps

**Step 1: Verify Redis Connectivity**

```bash
# Test Redis connection
redis-cli -h <redis-host> -p <redis-port> -c "INCR test"

# If works: Redis is fine, check circuit breaker threshold
# If fails: Redis is the issue (see High Error Rate section)
```

**Step 2: Check Circuit Breaker Configuration**

```bash
# Current threshold: 5 consecutive failures
# Cooldown: 60 seconds

# If transient issues: Increase threshold
# Edit: src/rate-limiting/redis-rate-limit-store.ts
circuitBreakerThreshold: 10  # Increase to 10

# If persistent issues: Keep threshold at 5 (current)
```

**Step 3: Monitor Recovery**

```bash
# Watch circuit breaker state
watch -n 5 'curl -s http://localhost:3000/api/health/rate-limit/deep | jq ".details.circuitBreaker"'

# Circuit breaker auto-recovers after cooldown if next request succeeds
```

**Step 4: Manual Circuit Breaker Reset**

```bash
# If auto-recovery fails, restart service
kubectl rollout restart deployment/agrobridge-api

# Or: SSH into pod and restart process
kubectl exec -it <pod> -- pkill -f node
```

**Step 5: Monitor Memory Usage**

```bash
# Check if fallback is causing memory pressure
curl http://localhost:3000/api/health/rate-limit/deep | jq '.details.system.memory'

# If memory > 1GB: Fallback may be overwhelmed
# Consider increasing cleanup interval or adding more nodes
```

#### Prevention

- Monitor Redis health proactively
- Set up Redis clustering for high availability
- Increase circuit breaker threshold if transient errors common
- Add more application nodes to distribute load

---

### 3. High Latency 🟡

#### Symptoms

- Alert: "High Rate Limit Latency"
- P99 latency > 100ms
- Slow response times in logs

#### Diagnosis

```bash
# Check latency by tier
histogram_quantile(0.99, rate(rate_limit_check_duration_seconds_bucket[5m])) by (tier)

# Check latency by store type
histogram_quantile(0.99, rate(rate_limit_check_duration_seconds_bucket[5m])) by (store_type)

# Compare Redis vs in-memory latency
rate_limit_check_duration_seconds{store_type="redis"}
rate_limit_check_duration_seconds{store_type="in_memory"}
```

#### Resolution Steps

**Step 1: Check Network Latency to Redis**

```bash
# Measure network latency
redis-cli -h <redis-host> -p <redis-port> --latency-history

# Expected: < 5ms for local, < 50ms for same region
# If > 100ms: Network issue or Redis overloaded
```

**Step 2: Check Redis Slow Log**

```bash
redis-cli -h <redis-host> -p <redis-port> SLOWLOG GET 10

# Look for rate limit Lua script
# If script takes > 10ms: Redis is overloaded
```

**Step 3: Check Redis CPU/Memory**

```bash
# Check Redis metrics
redis-cli -h <redis-host> -p <redis-port> INFO stats
redis-cli -h <redis-host> -p <redis-port> INFO cpu

# Look for:
# - instantaneous_ops_per_sec
# - used_cpu_sys
# - used_cpu_user
```

**Step 4: Check for Redis Cluster Rehashing**

```bash
# If using cluster, check if nodes are rebalancing
redis-cli -h <redis-host> -p <redis-port> CLUSTER INFO

# Check: cluster_state, cluster_slots_assigned
# If cluster_down or cluster_slots_assigned < 16384: Rehashing in progress
```

**Step 5: Review Lua Script Performance**

```bash
# The Lua script should be very fast (< 1ms)
# If slow: Check script logic or Redis performance

# Redis script execution time is in slowlog
redis-cli -h <redis-host> -p <redis-port> SLOWLOG GET
```

**Step 6: Check Application Performance**

```bash
# Check CPU usage of application process
top -p <node-pid>

# Check event loop lag (using Node.js metrics)
curl http://localhost:3000/metrics | grep eventloop
```

#### Optimization Actions

**If Redis Latency High:**

1. Add Redis replicas for read distribution
2. Scale Redis cluster horizontally
3. Optimize Redis configuration (disable slow commands)
4. Use Redis pipelining for batch operations

**If Application Latency High:**

1. Add more application nodes
2. Increase connection pool size
3. Profile JavaScript execution
4. Check for garbage collection pauses

---

### 4. Circuit Breaker Open 🔴

#### Symptoms

- Alert: "Rate Limit Circuit Breaker Open on >50% Nodes"
- Most requests using fallback
- High `rate_limit_fallbacks_total`

#### Diagnosis

```bash
# Check circuit breaker state across all nodes
curl http://node1:8080/health/rate-limit/deep | jq '.details.circuitBreaker'
curl http://node2:8080/health/rate-limit/deep | jq '.details.circuitBreaker'
curl http://node3:8080/health/rate-limit/deep | jq '.details.circuitBreaker'

# Check failure counts
rate_limit_errors_total by (instance)
```

#### Resolution Steps

**Step 1: Verify Root Cause**

```bash
# Why is circuit breaker open?
# Check recent failures
grep -i "circuit breaker" /var/log/agrobridge/app.log | tail -50

# Common causes:
# - Redis down (most common)
# - Network partition
# - Redis OOM
# - DNS resolution failure
```

**Step 2: Fix Root Cause**

```bash
# If Redis down: Start Redis or failover to replica
# If network: Contact network team
# If OOM: Scale Redis or add memory
# If DNS: Check DNS configuration
```

**Step 3: Verify Recovery**

```bash
# Watch circuit breaker state
watch -n 10 'curl -s http://localhost:3000/api/health/rate-limit/deep | jq ".circuitBreaker"'

# Circuit breaker should auto-close after:
# - Cooldown period (60s) expires
# - Next successful request
```

**Step 4: Manual Recovery**

```bash
# If auto-recovery fails after 5 minutes
kubectl rollout restart deployment/agrobridge-api

# This resets all circuit breakers
```

**Step 5: Verify Redis Connection**

```bash
# Test from application pod
kubectl exec -it <pod> -- redis-cli -h <redis-host> -p <redis-port> ping

# Should return: PONG
```

---

## Recovery Procedures

### Redis Outage Recovery

#### Scenario 1: Redis Master Fails

```bash
# 1. Check Redis sentinel (if configured)
redis-cli -h <sentinel-host> -p 26379 SENTINEL get-master-addr-by-name mymaster

# 2. Promote replica to master (if manual failover)
redis-cli -h <sentinel-host> -p 26379 SENTINEL failover mymaster

# 3. Verify new master is accepting connections
redis-cli -h <new-master-host> -p 6379 ping

# 4. Circuit breaker auto-recovers after 60s cooldown
```

#### Scenario 2: Redis Cluster Rebalancing

```bash
# 1. Check cluster state
redis-cli -h <redis-host> -p 6379 CLUSTER INFO

# 2. Monitor cluster nodes
redis-cli -h <redis-host> -p 6379 CLUSTER NODES

# 3. Wait for rebalancing to complete
# cluster_slots_assigned should be 16384
# cluster_state should be ok

# 4. Circuit breaker should recover automatically
```

#### Scenario 3: Redis OOM

```bash
# 1. Check memory usage
redis-cli -h <redis-host> -p 6379 INFO memory | grep used_memory

# 2. Check maxmemory setting
redis-cli -h <redis-host> -p 6379 CONFIG GET maxmemory

# 3. If exceeded:
#    a. Add more memory to Redis instance
#    b. Or increase maxmemory setting
#    c. Or enable eviction policy: CONFIG SET maxmemory-policy allkeys-lru

# 4. Monitor memory usage
watch -n 5 'redis-cli -h <redis-host> -p 6379 INFO memory | grep used_memory'
```

### Manual Circuit Breaker Reset

#### When to Use

- Auto-recovery fails after 5 minutes
- Root cause resolved but circuit breaker stuck
- Test scenario requiring reset

#### How to Reset

```bash
# Option 1: Restart application
kubectl rollout restart deployment/agrobridge-api

# Option 2: Force close circuit breaker via API (if implemented)
curl -X POST http://localhost:3000/admin/circuit-breaker/reset \
  -H "Content-Type: application/json" \
  -d '{"store": "redis"}'

# Option 3: SSH into pod and restart process
kubectl exec -it <pod> -- pkill -f node
# Kubernetes will restart pod
```

### Graceful Shutdown

#### Planned Maintenance

```bash
# 1. Scale up new instances
kubectl scale deployment agrobridge-api --replicas=6

# 2. Wait for new instances to be healthy
kubectl get pods -l app=agrobridge-api -w

# 3. Drain old instances
kubectl drain <node> --ignore-daemonsets --delete-emptydir-data

# 4. Remove old instances
kubectl scale deployment agrobridge-api --replicas=3
```

#### Emergency Shutdown

```bash
# 1. Set fail-open mode
# Update config: all tiers have skipOnError: true

# 2. Allow current connections to drain
sleep 30

# 3. Scale to zero
kubectl scale deployment agrobridge-api --replicas=0

# 4. Verify no traffic to rate limiter
# Check load balancer metrics
```

---

## Monitoring Dashboards

### Key Metrics to Monitor

1. **Rate Limit Checks (RPS)**
   - `sum(rate(rate_limit_checks_total[5m])) by (tier, store_type)`
   - Normal: 100-1000 RPS per tier
   - Alert: > 10,000 RPS

2. **Allowed vs Rejected**
   - `sum(rate(rate_limit_checks_total[5m])) by (tier, allowed)`
   - Normal: 95-99% allowed
   - Alert: < 90% allowed

3. **P99 Latency**
   - `histogram_quantile(0.99, rate(rate_limit_check_duration_seconds_bucket[5m]))`
   - Normal: < 5ms
   - Warning: 5-10ms
   - Critical: > 10ms

4. **Fallback Rate**
   - `rate(rate_limit_fallbacks_total[5m])`
   - Normal: 0
   - Warning: 1-5/s
   - Critical: > 5/s

5. **Circuit Breaker State**
   - `rate_limit_circuit_breaker_open`
   - Normal: 0
   - Warning: < 0.3 (30% of nodes)
   - Critical: > 0.5 (50% of nodes)

6. **Error Rate by Type**
   - `rate(rate_limit_errors_total[5m]) by (error_type)`
   - Normal: 0
   - Warning: 1-5/s
   - Critical: > 5/s

7. **Memory Usage**
   - Process memory from `/health/rate-limit/deep`
   - Normal: < 500MB
   - Warning: 500MB-1GB
   - Critical: > 1GB

---

## Escalation Matrix

| Condition                  | Time to Escalate | Contact                 |
| -------------------------- | ---------------- | ----------------------- |
| Redis down                 | 5 min            | Redis Team              |
| High latency (> 10s)       | 10 min           | Platform Team           |
| Circuit breaker open > 50% | 15 min           | Platform Team           |
| Service unhealthy          | 5 min            | On-call Engineer        |
| OOM risk                   | Immediate        | Platform Team           |
| Data consistency issue     | 10 min           | Platform Team + DB Team |

---

## Post-Incident Review

### Questions to Answer

1. **Root Cause**
   - What was the triggering event?
   - Why did monitoring not catch it earlier?
   - What was the failure chain?

2. **Impact Assessment**
   - How many users were affected?
   - Duration of incident?
   - Financial/business impact?

3. **Response Time**
   - Time to detect?
   - Time to respond?
   - Time to resolve?
   - What could have been faster?

4. **Prevention**
   - How can we prevent this in the future?
   - What alerts were missing or unclear?
   - What documentation was outdated?

5. **Action Items**
   - Code changes needed?
   - Configuration changes needed?
   - Monitoring improvements needed?
   - Documentation updates needed?

### Incident Report Template

```markdown
# Incident Report: [Title]

## Summary

[Brief description of what happened]

## Impact

- Affected users: [number]
- Duration: [time]
- Affected services: [list]

## Timeline

- [time]: Alert triggered
- [time]: Investigation started
- [time]: Root cause identified
- [time]: Mitigation applied
- [time]: Service recovered

## Root Cause

[Detailed explanation]

## Resolution

[Steps taken to resolve]

## Action Items

- [ ] [Owner]: [Task]
- [ ] [Owner]: [Task]
- [ ] [Owner]: [Task]

## Prevention

[How to prevent recurrence]
```

---

## Appendix: Common Error Messages

| Error             | Meaning                   | Action                            |
| ----------------- | ------------------------- | --------------------------------- |
| `ETIMEDOUT`       | Redis connection timeout  | Check network, Redis status       |
| `ECONNRESET`      | Connection reset by Redis | Check Redis logs, network         |
| `EPIPE`           | Broken pipe               | Check Redis connection pool       |
| `EAI_AGAIN`       | DNS resolution failed     | Check DNS configuration           |
| `Connection lost` | Lost Redis connection     | Check Redis stability             |
| `READONLY`        | Redis in read-only mode   | Check Redis master/replica status |
| `LOADING`         | Redis loading data        | Wait for Redis to finish loading  |
| `MASTERDOWN`      | Redis master down         | Check Redis cluster               |
| `NOREPLICAS`      | Not enough replicas       | Check Redis replication           |

---

## Contact Information

| Team            | Slack Channel    | PagerDuty        | Email                   |
| --------------- | ---------------- | ---------------- | ----------------------- |
| Platform Team   | #platform        | @platform-oncall | platform@agrobridge.org |
| Redis Team      | #redis           | @redis-oncall    | redis@agrobridge.org    |
| Network Team    | #network         | @network-oncall  | network@agrobridge.org  |
| On-Call Manager | #on-call-manager | @manager-oncall  | manager@agrobridge.org  |

---

**Last Updated**: 2025-01-26
**Next Review**: 2025-04-26
**Maintainer**: Platform Team
