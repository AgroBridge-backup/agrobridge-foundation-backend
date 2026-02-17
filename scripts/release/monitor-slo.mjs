#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ARTIFACT_DIR = process.env.ARTIFACT_DIR ?? 'artifacts/canary';
const ARTIFACT_PATH = resolve(ARTIFACT_DIR, 'slo-monitor.json');

const PROMETHEUS_BASE_URL = process.env.PROMETHEUS_BASE_URL;
const PROMETHEUS_BEARER_TOKEN = process.env.PROMETHEUS_BEARER_TOKEN;
const OBSERVATION_WINDOW_MINUTES = Number(process.env.SLO_OBSERVATION_WINDOW_MINUTES ?? 10);

const ERROR_RATE_THRESHOLD = Number(process.env.SLO_ERROR_RATE_THRESHOLD ?? 0.02);
const P95_THRESHOLD_MS = Number(process.env.SLO_P95_MS_THRESHOLD ?? 1000);
const READINESS_MIN = Number(process.env.SLO_READINESS_MIN ?? 1);
const P95_UNIT = process.env.SLO_P95_UNIT ?? 'seconds';

const ROUTE_MATCHER = process.env.SLO_ROUTE_MATCHER ?? '/api/health|/api/contacts|/api/donations/intent';

const ERROR_RATE_QUERY =
  process.env.SLO_ERROR_RATE_QUERY ??
  `sum(rate(http_requests_total{route=~"${ROUTE_MATCHER}",status=~"5.."}[${OBSERVATION_WINDOW_MINUTES}m])) / clamp_min(sum(rate(http_requests_total{route=~"${ROUTE_MATCHER}"}[${OBSERVATION_WINDOW_MINUTES}m])), 1)`;

const P95_QUERY =
  process.env.SLO_P95_QUERY ??
  `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{route=~"${ROUTE_MATCHER}"}[${OBSERVATION_WINDOW_MINUTES}m])) by (le))`;

const READINESS_QUERY = process.env.SLO_READINESS_QUERY ?? 'min(up{job=~"agrobridge-backend|backend"})';

function parseNumeric(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Expected numeric value for ${label}, got ${value}`);
  return n;
}

async function queryPrometheus(query) {
  if (!PROMETHEUS_BASE_URL) throw new Error('PROMETHEUS_BASE_URL is required for SLO monitoring.');

  const url = new URL('/api/v1/query', PROMETHEUS_BASE_URL);
  url.searchParams.set('query', query);

  const headers = {};
  if (PROMETHEUS_BEARER_TOKEN) headers.Authorization = `Bearer ${PROMETHEUS_BEARER_TOKEN}`;

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Prometheus query failed (${response.status}) for query: ${query}`);
  }

  const payload = await response.json();
  if (payload?.status !== 'success') {
    throw new Error(`Prometheus returned non-success for query: ${query}`);
  }

  const result = payload?.data?.result?.[0];
  if (!result?.value?.[1]) {
    throw new Error(`Prometheus returned no datapoints for query: ${query}`);
  }

  return {
    query,
    value: parseNumeric(result.value[1], query),
    raw: payload?.data?.result ?? [],
  };
}

async function persist(report) {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  await writeFile(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function main() {
  const [errorRateResult, p95Result, readinessResult] = await Promise.all([
    queryPrometheus(ERROR_RATE_QUERY),
    queryPrometheus(P95_QUERY),
    queryPrometheus(READINESS_QUERY),
  ]);

  const p95Ms = P95_UNIT === 'milliseconds' ? p95Result.value : p95Result.value * 1000;

  const breaches = [];
  if (errorRateResult.value > ERROR_RATE_THRESHOLD) {
    breaches.push(
      `error_rate=${errorRateResult.value} exceeded threshold=${ERROR_RATE_THRESHOLD}`,
    );
  }
  if (p95Ms > P95_THRESHOLD_MS) {
    breaches.push(`p95_ms=${p95Ms} exceeded threshold=${P95_THRESHOLD_MS}`);
  }
  if (readinessResult.value < READINESS_MIN) {
    breaches.push(`readiness=${readinessResult.value} below threshold=${READINESS_MIN}`);
  }

  const report = {
    timestamp: new Date().toISOString(),
    observationWindowMinutes: OBSERVATION_WINDOW_MINUTES,
    thresholds: {
      errorRate: ERROR_RATE_THRESHOLD,
      p95Ms: P95_THRESHOLD_MS,
      readinessMin: READINESS_MIN,
    },
    metrics: {
      errorRate: errorRateResult.value,
      p95Ms,
      readiness: readinessResult.value,
    },
    queries: {
      errorRate: errorRateResult.query,
      p95: p95Result.query,
      readiness: readinessResult.query,
    },
    raw: {
      errorRate: errorRateResult.raw,
      p95: p95Result.raw,
      readiness: readinessResult.raw,
    },
    breaches,
  };

  await persist(report);

  if (breaches.length > 0) {
    console.error('Canary SLO monitoring detected threshold breaches.');
    for (const breach of breaches) console.error(`- ${breach}`);
    process.exit(1);
  }

  console.log('Canary SLO monitoring passed.');
}

main().catch(async (error) => {
  const report = {
    timestamp: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
  };
  await persist(report);
  console.error('Canary SLO monitoring failed.');
  console.error(error);
  process.exit(1);
});
