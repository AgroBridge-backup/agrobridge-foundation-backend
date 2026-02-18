#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ARTIFACT_DIR = process.env.ARTIFACT_DIR ?? 'artifacts/canary';
const ARTIFACT_PATH = resolve(ARTIFACT_DIR, 'slo-monitor.json');
const ARTIFACT_SENSITIVITY = process.env.ARTIFACT_SENSITIVITY ?? 'restricted-internal';
const PROMETHEUS_BASE_URL = process.env.PROMETHEUS_BASE_URL;
const PROMETHEUS_BEARER_TOKEN = process.env.PROMETHEUS_BEARER_TOKEN;

function parseNumeric(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Expected numeric value for ${label}, got ${value}`);
  return n;
}

function parseFiniteEnvNumber(name, fallback, { min } = {}) {
  const raw = process.env[name];
  const parsed = raw === undefined || raw === '' ? fallback : Number(raw);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric policy value for ${name}: ${raw}`);
  }
  if (min !== undefined && parsed < min) {
    throw new Error(`Invalid numeric policy value for ${name}: ${parsed} (must be >= ${min})`);
  }
  return parsed;
}

function escapePrometheusLabelValue(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildRunContext() {
  const runId = process.env.GITHUB_RUN_ID ?? null;
  const repository = process.env.GITHUB_REPOSITORY ?? null;
  const server = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
  const runUrl =
    runId && repository ? `${server}/${repository}/actions/runs/${runId}` : null;

  return {
    repository,
    workflow: process.env.GITHUB_WORKFLOW ?? null,
    eventName: process.env.GITHUB_EVENT_NAME ?? null,
    ref: process.env.GITHUB_REF ?? null,
    sha: process.env.GITHUB_SHA ?? null,
    runId,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    actor: process.env.GITHUB_ACTOR ?? null,
    runUrl,
    environment: process.env.RELEASE_ENVIRONMENT ?? null,
  };
}

function buildPolicy() {
  const observationWindowMinutes = parseFiniteEnvNumber('SLO_OBSERVATION_WINDOW_MINUTES', 10, {
    min: 1,
  });
  const errorRateThreshold = parseFiniteEnvNumber('SLO_ERROR_RATE_THRESHOLD', 0.02, { min: 0 });
  const p95ThresholdMs = parseFiniteEnvNumber('SLO_P95_MS_THRESHOLD', 1000, { min: 0 });
  const readinessMin = parseFiniteEnvNumber('SLO_READINESS_MIN', 1, { min: 0 });

  const p95Unit = process.env.SLO_P95_UNIT ?? 'seconds';
  if (p95Unit !== 'seconds' && p95Unit !== 'milliseconds') {
    throw new Error(`Invalid SLO_P95_UNIT: ${p95Unit}. Expected "seconds" or "milliseconds".`);
  }

  const canaryReleaseId = process.env.CANARY_RELEASE_ID?.trim() ?? '';
  const canaryLabelKey = process.env.CANARY_RELEASE_LABEL_KEY?.trim() || 'release_id';
  const explicitCanarySelector = process.env.CANARY_LABEL_SELECTOR?.trim() ?? '';
  const canarySelector =
    explicitCanarySelector.length > 0
      ? explicitCanarySelector
      : canaryReleaseId.length > 0
        ? `${canaryLabelKey}="${escapePrometheusLabelValue(canaryReleaseId)}"`
        : 'deployment="canary"';

  const routeMatcher =
    process.env.SLO_ROUTE_MATCHER ?? '/api/health|/api/contacts|/api/donations/intent';

  const errorRateQuery =
    process.env.SLO_ERROR_RATE_QUERY ??
    `sum by (job, instance, pod) (rate(http_requests_total{${canarySelector},route=~"${routeMatcher}",status=~"5.."}[${observationWindowMinutes}m])) / clamp_min(sum by (job, instance, pod) (rate(http_requests_total{${canarySelector},route=~"${routeMatcher}"}[${observationWindowMinutes}m])), 1)`;

  const p95Query =
    process.env.SLO_P95_QUERY ??
    `histogram_quantile(0.95, sum by (le, job, instance, pod) (rate(http_request_duration_seconds_bucket{${canarySelector},route=~"${routeMatcher}"}[${observationWindowMinutes}m])))`;

  const readinessQuery =
    process.env.SLO_READINESS_QUERY ?? `up{${canarySelector},job=~"agrobridge-backend|backend"}`;

  return {
    observationWindowMinutes,
    errorRateThreshold,
    p95ThresholdMs,
    readinessMin,
    p95Unit,
    canarySelector,
    canaryReleaseId: canaryReleaseId.length > 0 ? canaryReleaseId : null,
    queries: {
      errorRate: errorRateQuery,
      p95: p95Query,
      readiness: readinessQuery,
    },
  };
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

  const resultSet = payload?.data?.result;
  if (!Array.isArray(resultSet) || resultSet.length === 0) {
    throw new Error(`Prometheus returned no canary series for query: ${query}`);
  }

  const series = resultSet.map((result, index) => {
    const rawValue = result?.value?.[1];
    if (rawValue === undefined) {
      throw new Error(`Prometheus series ${index} has no datapoint for query: ${query}`);
    }

    return {
      metric: result.metric ?? {},
      value: parseNumeric(rawValue, `${query} series[${index}]`),
    };
  });

  return {
    query,
    series,
  };
}

async function persist(report) {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  await writeFile(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function main() {
  const policy = buildPolicy();
  const runContext = buildRunContext();

  const [errorRateResult, p95Result, readinessResult] = await Promise.all([
    queryPrometheus(policy.queries.errorRate),
    queryPrometheus(policy.queries.p95),
    queryPrometheus(policy.queries.readiness),
  ]);

  const errorRateValues = errorRateResult.series.map((entry) => entry.value);
  const p95ValuesMs = p95Result.series.map((entry) =>
    policy.p95Unit === 'milliseconds' ? entry.value : entry.value * 1000,
  );
  const readinessValues = readinessResult.series.map((entry) => entry.value);

  const worstCaseErrorRate = Math.max(...errorRateValues);
  const worstCaseP95Ms = Math.max(...p95ValuesMs);
  const worstCaseReadiness = Math.min(...readinessValues);

  const breaches = [];
  if (worstCaseErrorRate > policy.errorRateThreshold) {
    breaches.push(
      `error_rate_max=${worstCaseErrorRate} exceeded threshold=${policy.errorRateThreshold}`,
    );
  }
  if (worstCaseP95Ms > policy.p95ThresholdMs) {
    breaches.push(`p95_ms_max=${worstCaseP95Ms} exceeded threshold=${policy.p95ThresholdMs}`);
  }
  if (worstCaseReadiness < policy.readinessMin) {
    breaches.push(`readiness_min=${worstCaseReadiness} below threshold=${policy.readinessMin}`);
  }

  const report = {
    timestamp: new Date().toISOString(),
    sha: runContext.sha,
    runId: runContext.runId,
    runContext,
    sensitivity: ARTIFACT_SENSITIVITY,
    observationWindowMinutes: policy.observationWindowMinutes,
    thresholds: {
      errorRate: policy.errorRateThreshold,
      p95Ms: policy.p95ThresholdMs,
      readinessMin: policy.readinessMin,
    },
    canaryScope: {
      selector: policy.canarySelector,
      releaseId: policy.canaryReleaseId,
    },
    metrics: {
      worstCase: {
        errorRateMax: worstCaseErrorRate,
        p95MsMax: worstCaseP95Ms,
        readinessMin: worstCaseReadiness,
      },
      series: {
        errorRate: errorRateResult.series,
        p95Ms: p95Result.series.map((entry, index) => ({
          metric: entry.metric,
          value: p95ValuesMs[index],
        })),
        readiness: readinessResult.series,
      },
    },
    queries: policy.queries,
    breaches,
  };

  report.result = breaches.length > 0 ? 'fail' : 'pass';
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
    sensitivity: ARTIFACT_SENSITIVITY,
    sha: process.env.GITHUB_SHA ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
    result: 'error',
    error: error instanceof Error ? error.message : String(error),
  };
  await persist(report);
  console.error('Canary SLO monitoring failed.');
  console.error(error);
  process.exit(1);
});
