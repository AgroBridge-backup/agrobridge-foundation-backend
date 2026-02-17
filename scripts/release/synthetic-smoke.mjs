#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const PREPROD_BASE_URL = process.env.PREPROD_BASE_URL;
const ARTIFACT_DIR = process.env.ARTIFACT_DIR ?? 'artifacts/preprod';
const TIMEOUT_MS = Number(process.env.SYNTHETIC_TIMEOUT_MS ?? 20000);

if (!PREPROD_BASE_URL) {
  console.error('ERROR: PREPROD_BASE_URL is required.');
  process.exit(1);
}

const baseUrl = PREPROD_BASE_URL.replace(/\/+$/, '');

function fail(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

async function request({ name, method, path, expectedStatus, body, validate }) {
  const url = `${baseUrl}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'content-type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    let parsedBody = null;
    try {
      parsedBody = await response.json();
    } catch {
      fail(`${name}: expected JSON response`, { url, status: response.status });
    }

    if (response.status !== expectedStatus) {
      fail(`${name}: unexpected status`, {
        url,
        expectedStatus,
        actualStatus: response.status,
        body: parsedBody,
      });
    }

    validate(parsedBody);

    return {
      name,
      method,
      path,
      status: response.status,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function assertOkEnvelope(payload, name) {
  if (!payload || typeof payload !== 'object') {
    fail(`${name}: response body is not an object`, { payload });
  }

  if (payload.ok !== true || !('data' in payload)) {
    fail(`${name}: expected { ok: true, data: ... }`, { payload });
  }
}

async function main() {
  const checks = [];

  checks.push(
    await request({
      name: 'health',
      method: 'GET',
      path: '/api/health',
      expectedStatus: 200,
      validate(payload) {
        assertOkEnvelope(payload, 'health');
        if (!payload.data || payload.data.status !== 'ok') {
          fail('health: expected data.status=ok', { payload });
        }
      },
    }),
  );

  checks.push(
    await request({
      name: 'donations_intent',
      method: 'POST',
      path: '/api/donations/intent',
      expectedStatus: 200,
      body: {
        amount: 2500,
        currency: 'usd',
        frequency: 'one-time',
        donorEmail: `synthetic+${Date.now()}@agrobridgefoundation.org`,
        source: 'preprod-synthetic-smoke',
      },
      validate(payload) {
        assertOkEnvelope(payload, 'donations_intent');
        if (typeof payload.data.sessionId !== 'string' || payload.data.sessionId.length === 0) {
          fail('donations_intent: expected non-empty data.sessionId', { payload });
        }
        if (payload.data.url !== null && typeof payload.data.url !== 'string') {
          fail('donations_intent: expected data.url to be string|null', { payload });
        }
      },
    }),
  );

  checks.push(
    await request({
      name: 'contacts',
      method: 'POST',
      path: '/api/contacts',
      expectedStatus: 201,
      body: {
        name: 'Synthetic Smoke',
        email: `synthetic+${Date.now()}@agrobridgefoundation.org`,
        message: 'Preprod synthetic smoke check',
        source: 'preprod-synthetic-smoke',
      },
      validate(payload) {
        assertOkEnvelope(payload, 'contacts');
        if (!payload.data || typeof payload.data.id !== 'string' || payload.data.id.length === 0) {
          fail('contacts: expected non-empty data.id', { payload });
        }
      },
    }),
  );

  await mkdir(ARTIFACT_DIR, { recursive: true });
  const artifactPath = resolve(ARTIFACT_DIR, 'synthetic-smoke.json');
  const report = {
    timestamp: new Date().toISOString(),
    baseUrl,
    checks,
  };
  await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Synthetic smoke completed. Artifact: ${artifactPath}`);
}

main().catch(async (error) => {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  const artifactPath = resolve(ARTIFACT_DIR, 'synthetic-smoke.json');
  const failure = {
    timestamp: new Date().toISOString(),
    baseUrl,
    error: error instanceof Error ? error.message : String(error),
    details: error && typeof error === 'object' ? error.details ?? null : null,
  };
  await writeFile(artifactPath, `${JSON.stringify(failure, null, 2)}\n`, 'utf8');
  console.error('Synthetic smoke failed.');
  console.error(error);
  process.exit(1);
});
