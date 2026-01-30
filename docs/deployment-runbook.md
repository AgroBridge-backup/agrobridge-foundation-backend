# Deployment Runbook (AWS ECS Fargate)

This is a practical runbook for deploying the API to AWS.

Scope:

- ECS Fargate + ALB + RDS Postgres + Secrets Manager + CloudWatch
- Documentation only (no IaC committed here yet)

## Architecture

- ALB terminates TLS
- ECS service runs the container (Node.js)
- RDS Postgres stores app data
- Secrets Manager stores env secrets
- CloudWatch Logs for structured logs

## Pre-flight Checklist

- Domain + TLS certificate in ACM (in the ALB region)
- RDS instance reachable from ECS tasks (same VPC, security groups)
- Secrets defined in Secrets Manager
- ECR repository created and image pushed

## Required Secrets/Env

- `NODE_ENV=production`
- `PORT=3000`
- `DATABASE_URL` (RDS)
- `JWT_SECRET` (>=32 chars)
- `COOKIE_SECRET` (>=16 chars)
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `CORS_ORIGIN` (exact website origin)

Tracing (optional but recommended):

- `OTEL_EXPORTER_OTLP_ENDPOINT` (e.g. `http://collector:4318/v1/traces`)
- `OTEL_DIAG=0` (set to `1` only for troubleshooting)

## ECS Task Definition Notes

- CPU/memory: start with 0.25 vCPU / 0.5GB for MVP; scale as needed.
- Health check: hit `GET /api/health`.
- Logging: send stdout/stderr to CloudWatch Logs.
- Networking: awsvpc mode.

## ALB Configuration

- Listener: 443 -> target group
- Target group:
  - Protocol: HTTP
  - Health check path: `/api/health`
  - Success codes: `200`
- Sticky sessions: not required.

## Database

- Use SSL/TLS to RDS.
- Prefer a dedicated app user with least privileges.
- Enable backups and point-in-time restore.

## Release Steps

1. Build and push container image to ECR
2. Update ECS task definition with new image tag
3. Deploy ECS service
4. Verify health:
   - `curl -i https://<api-domain>/api/health`
5. Verify Stripe:
   - ensure webhook endpoint is configured in Stripe dashboard
   - verify signature secret matches `STRIPE_WEBHOOK_SECRET`

## Post-deploy Verification

- Admin login works (cookie set)
- Donation intent returns Stripe URL
- Webhook deliveries succeed in Stripe dashboard
- Admin dashboard metrics return expected values

## Monitoring & Alerts (Recommended)

- ALB 5xx rate
- ECS service CPU/memory
- RDS CPU/storage, connections
- Application log filter metrics:
  - spikes in `INTERNAL_ERROR`
  - spikes in webhook signature failures

## Incident Response

- If Stripe webhooks fail:
  - confirm `STRIPE_WEBHOOK_SECRET` and raw body handling
  - check `WebhookEvent` persistence to see what arrived
  - replay events from Stripe dashboard

- If auth failures spike:
  - confirm cookie settings (`secure`, domain)
  - confirm `COOKIE_SECRET` stability (rotating it invalidates signed cookies)
