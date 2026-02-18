#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ARTIFACT_DIR = process.env.ARTIFACT_DIR ?? 'artifacts/reliability';
const ARTIFACT_PATH = resolve(ARTIFACT_DIR, 'error-budget-check.json');

const PROM_BASE = process.env.PROMETHEUS_BASE_URL;
const PROM_TOKEN = process.env.PROMETHEUS_BEARER_TOKEN;
const ARTIFACT_SENSITIVITY = process.env.ARTIFACT_SENSITIVITY ?? 'restricted-internal';

const REMAINING_QUERY =
  process.env.ERROR_BUDGET_REMAINING_QUERY ?? 'error_budget_remaining_ratio';
const BURN_1H_QUERY =
  process.env.ERROR_BUDGET_BURN_RATE_1H_QUERY ?? 'error_budget_burn_rate_1h';
const BURN_6H_QUERY =
  process.env.ERROR_BUDGET_BURN_RATE_6H_QUERY ?? 'error_budget_burn_rate_6h';

function parseNumeric(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Expected numeric value for ${label}; got ${value}`);
  }
  return n;
}

function parseFiniteEnvNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric policy value for ${name}: ${raw}`);
  }
  return parsed;
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

async function queryPrometheus(query) {
  if (!PROM_BASE) {
    throw new Error('PROMETHEUS_BASE_URL is required when using Prometheus-backed checks.');
  }

  const url = new URL('/api/v1/query', PROM_BASE);
  url.searchParams.set('query', query);

  const headers = {};
  if (PROM_TOKEN) headers.Authorization = `Bearer ${PROM_TOKEN}`;

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Prometheus query failed (${response.status}) for query: ${query}`);
  }

  const payload = await response.json();
  if (payload?.status !== 'success') {
    throw new Error(`Prometheus query returned non-success status for query: ${query}`);
  }

  const first = payload?.data?.result?.[0];
  if (!first?.value?.[1]) {
    throw new Error(`Prometheus query returned no datapoints for query: ${query}`);
  }

  return parseNumeric(first.value[1], query);
}

async function gatherSignal() {
  if (process.env.ERROR_BUDGET_DATA_JSON) {
    const parsed = JSON.parse(process.env.ERROR_BUDGET_DATA_JSON);
    return {
      source: 'ERROR_BUDGET_DATA_JSON',
      remaining: parseNumeric(parsed.remaining, 'remaining'),
      burnRate1h: parseNumeric(parsed.burnRate1h, 'burnRate1h'),
      burnRate6h: parseNumeric(parsed.burnRate6h, 'burnRate6h'),
    };
  }

  return {
    source: 'prometheus',
    remaining: await queryPrometheus(REMAINING_QUERY),
    burnRate1h: await queryPrometheus(BURN_1H_QUERY),
    burnRate6h: await queryPrometheus(BURN_6H_QUERY),
  };
}

async function persistArtifact(payload) {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  await writeFile(ARTIFACT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function main() {
  const thresholds = {
    minRemaining: parseFiniteEnvNumber('ERROR_BUDGET_MIN_REMAINING', 0),
    maxBurnRate1h: parseFiniteEnvNumber('ERROR_BUDGET_MAX_BURN_RATE_1H', 2),
    maxBurnRate6h: parseFiniteEnvNumber('ERROR_BUDGET_MAX_BURN_RATE_6H', 1),
  };

  const overrideApproved = process.env.ERROR_BUDGET_OVERRIDE === 'approved';
  const overrideReason = process.env.ERROR_BUDGET_OVERRIDE_REASON?.trim() ?? '';
  const runContext = buildRunContext();

  const signal = await gatherSignal();
  const breaches = [];

  if (signal.remaining <= thresholds.minRemaining) {
    breaches.push(
      `Error budget exhausted: remaining=${signal.remaining} threshold>${thresholds.minRemaining}`,
    );
  }
  if (signal.burnRate1h > thresholds.maxBurnRate1h) {
    breaches.push(
      `Short-window burn too high: burnRate1h=${signal.burnRate1h} threshold<=${thresholds.maxBurnRate1h}`,
    );
  }
  if (signal.burnRate6h > thresholds.maxBurnRate6h) {
    breaches.push(
      `Long-window burn too high: burnRate6h=${signal.burnRate6h} threshold<=${thresholds.maxBurnRate6h}`,
    );
  }

  const report = {
    timestamp: new Date().toISOString(),
    sha: runContext.sha,
    runId: runContext.runId,
    runContext,
    sensitivity: ARTIFACT_SENSITIVITY,
    signal,
    thresholds,
    breaches,
    override: {
      approved: overrideApproved,
      reason: overrideReason,
      approvalSource: 'protected-environment-reviewers',
      actor: runContext.actor,
    },
  };

  if (breaches.length > 0 && overrideApproved) {
    if (!overrideReason) {
      throw new Error(
        'ERROR_BUDGET_OVERRIDE is approved but ERROR_BUDGET_OVERRIDE_REASON is missing.',
      );
    }
    report.result = 'override-approved';
    await persistArtifact(report);
    console.warn('Error budget breaches detected but approved override is present.');
    console.warn(`Actor: ${runContext.actor ?? 'unknown'}`);
    console.warn(`Reason: ${overrideReason}`);
    return;
  }

  if (breaches.length > 0) {
    report.result = 'blocked';
    await persistArtifact(report);
    console.error('Error budget policy blocks release.');
    for (const breach of breaches) console.error(`- ${breach}`);
    process.exit(1);
  }

  report.result = 'pass';
  await persistArtifact(report);
  console.log('Error budget check passed.');
}

main().catch(async (error) => {
  const report = {
    timestamp: new Date().toISOString(),
    sensitivity: ARTIFACT_SENSITIVITY,
    sha: process.env.GITHUB_SHA ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
    result: 'error',
    message: error instanceof Error ? error.message : String(error),
  };
  await persistArtifact(report);
  console.error('Error budget check failed to execute.');
  console.error(error);
  process.exit(1);
});
