# Deploying Backend to Render (Free Tier)

Step-by-step guide to deploying the AgroBridge Foundation API on Render's free tier with PostgreSQL and Upstash Redis.

## Cost Summary

| Service | Provider | Cost | Limits |
|---------|----------|------|--------|
| Web Service | Render Free | $0 | ~30s cold start after 15min idle |
| PostgreSQL | Render Free | $0 | 90 days free, then $7/mo or recreate |
| Redis | Upstash Free | $0 | 10K commands/day, 256MB |

## 1. Set Up Upstash Redis (Free)

1. Sign up at [upstash.com](https://upstash.com)
2. Create a new Redis database (region: US-West for lowest latency to Render Oregon)
3. Copy the `UPSTASH_REDIS_URL` (starts with `rediss://`)

## 2. Deploy via Render Blueprint

### Option A: One-click Blueprint (recommended)

1. Push this repo to GitHub (if not already connected)
2. Go to [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint**
3. Connect this repository
4. Render reads `render.yaml` and creates:
   - Web service: `agrobridge-foundation-api`
   - PostgreSQL database: `agrobridge-foundation-db`
5. Set the manual environment variables when prompted (see below)

### Option B: Manual Setup

1. **Create PostgreSQL**: Dashboard → New → PostgreSQL → Free tier, region Oregon
2. **Create Web Service**: Dashboard → New → Web Service → Connect repo
   - Runtime: Docker
   - Plan: Free
   - Region: Oregon
   - Health check path: `/api/health`

## 3. Set Environment Variables

In the Render dashboard, set these variables for the web service:

| Variable | Value | Notes |
|----------|-------|-------|
| `DATABASE_URL` | *(auto from Blueprint)* | Render injects this from the DB |
| `REDIS_URL` | `rediss://...` | Your Upstash Redis URL |
| `STRIPE_SECRET_KEY` | `sk_live_...` | From Stripe Dashboard |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | From Stripe webhook setup |
| `STRIPE_PUBLISHABLE_KEY` | `pk_live_...` | Passed to frontend via API |
| `JWT_SECRET` | *(auto-generated)* | Blueprint generates this |
| `SENTRY_DSN` | `https://...@sentry.io/...` | Optional |
| `CORS_ORIGIN` | `https://www.agrobridgefoundation.org` | Frontend domain |
| `NODE_ENV` | `production` | Set by Blueprint |
| `PORT` | `10000` | Render's default port |

## 4. Set Up Stripe Webhook

1. Go to [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks)
2. Add endpoint: `https://agrobridge-foundation-api.onrender.com/api/webhooks/stripe`
3. Events to listen for:
   - `checkout.session.completed`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
4. Copy the signing secret → set as `STRIPE_WEBHOOK_SECRET`

## 5. Verify Deployment

### Health check
```bash
curl https://agrobridge-foundation-api.onrender.com/api/health
```

Expected: `{"status":"ok","timestamp":"..."}`

**Note**: First request after 15 minutes of inactivity takes ~30 seconds (cold start on free tier). Subsequent requests are fast.

### Check logs
In Render Dashboard → your service → Logs. Look for:
```
==> Running Prisma migrations...
==> Starting server...
server listening { port: 10000 }
```

## 6. Connect Frontend

Update `config.php` on SiteGround (see `docs/deploy-siteground.md` in the frontend repo):

```php
'apiBaseUrl' => 'https://agrobridge-foundation-api.onrender.com/api',
```

## Cold Start Mitigation

Render free tier spins down after 15 minutes of inactivity. Options:

1. **Accept it**: ~30s cold start is OK for a nonprofit foundation site
2. **External pinger**: Use [UptimeRobot](https://uptimerobot.com) (free) to ping `/api/health` every 14 minutes
3. **Upgrade later**: Render Starter ($7/mo) eliminates cold starts

## Database Renewal

Render's free PostgreSQL expires after 90 days. Before expiration:

1. Export data: `pg_dump` from Render's connection string
2. Delete the old database
3. Create a new free database
4. Import data: `psql` into the new connection string
5. Update `DATABASE_URL` in the web service environment

Or upgrade to Render Starter PostgreSQL ($7/mo) for persistence.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Build fails | Check Dockerfile — ensure `prisma/schema.prisma` exists |
| Migration fails | Check `DATABASE_URL` is set and DB is accessible |
| Redis connection errors | Verify Upstash URL uses `rediss://` (with double s for TLS) |
| CORS errors from frontend | Verify `CORS_ORIGIN` matches your exact frontend domain |
| Stripe webhooks failing | Verify webhook URL and `STRIPE_WEBHOOK_SECRET` match |
| Cold starts too slow | Add UptimeRobot pinger or upgrade to paid tier |
