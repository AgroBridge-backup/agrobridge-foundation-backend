# CloudWatch Logs Insights Queries

These queries assume structured JSON logs (Fastify/Pino). Adapt log group names as needed.

## 1) Error rate and top error codes

```sql
fields @timestamp, level, msg, reqId, err.code, err.statusCode
| filter level = "error"
| stats count() as errors by err.code
| sort errors desc
```

## 2) Requests by status code

```sql
fields @timestamp, msg, res.statusCode
| filter msg = "request completed"
| stats count() as requests by res.statusCode
| sort requests desc
```

## 3) Latency p50/p95/p99 by route

```sql
fields @timestamp, req.url, res.statusCode, responseTime, traceId
| filter msg = "request completed"
| stats pct(responseTime, 50) as p50, pct(responseTime, 95) as p95, pct(responseTime, 99) as p99, count() as n by req.url
| sort p95 desc
```

## 4) Stripe webhook signature failures

```sql
fields @timestamp, msg, err.code, err.message, req.url
| filter req.url like /\/api\/webhooks\/stripe/
| filter err.message like /signature/ or err.code = "VALIDATION_ERROR"
| stats count() as failures by err.message
| sort failures desc
```

## 5) Admin auth failures

```sql
fields @timestamp, msg, err.code, req.url
| filter err.code = "UNAUTHORIZED" or err.code = "FORBIDDEN"
| stats count() as count by req.url, err.code
| sort count desc
```
