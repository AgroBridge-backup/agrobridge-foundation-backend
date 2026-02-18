#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GOVERNANCE_AUDIT_TOKEN?.trim() || process.env.GITHUB_TOKEN || '';
const branch = process.env.GOVERNANCE_BRANCH ?? 'main';
const artifactDir = resolve(process.env.ARTIFACT_DIR ?? 'artifacts/governance');
const artifactPath = resolve(artifactDir, `branch-protection-${branch}.json`);
const artifactSensitivity = process.env.ARTIFACT_SENSITIVITY ?? 'restricted-internal';

function buildRunContext() {
  const runId = process.env.GITHUB_RUN_ID ?? null;
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
  };
}

async function persist(payload) {
  await mkdir(artifactDir, { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function main() {
  if (!repository) {
    throw new Error('GITHUB_REPOSITORY is required (owner/repo).');
  }
  if (!token) {
    throw new Error('GOVERNANCE_AUDIT_TOKEN or GITHUB_TOKEN is required.');
  }

  const [owner, repo] = repository.split('/');
  const endpoint = `https://api.github.com/repos/${owner}/${repo}/branches/${branch}/protection`;

  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
    },
  });

  const runContext = buildRunContext();
  if (response.status === 404) {
    const payload = {
      timestamp: new Date().toISOString(),
      sensitivity: artifactSensitivity,
      branch,
      protected: false,
      result: 'fail',
      reason: `Branch protection was not found for ${branch}`,
      sha: runContext.sha,
      runId: runContext.runId,
      runContext,
    };
    await persist(payload);
    throw new Error(`Branch protection for ${branch} was not found.`);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API request failed (${response.status}): ${text}`);
  }

  const protection = await response.json();
  const payload = {
    timestamp: new Date().toISOString(),
    sensitivity: artifactSensitivity,
    branch,
    protected: true,
    result: 'pass',
    sha: runContext.sha,
    runId: runContext.runId,
    runContext,
    protection,
  };

  await persist(payload);
  console.log(`Branch protection snapshot exported to ${artifactPath}`);
}

main().catch(async (error) => {
  const runContext = buildRunContext();
  await persist({
    timestamp: new Date().toISOString(),
    sensitivity: artifactSensitivity,
    branch,
    protected: null,
    result: 'error',
    sha: runContext.sha,
    runId: runContext.runId,
    runContext,
    error: error instanceof Error ? error.message : String(error),
  });
  console.error('Failed to export branch protection snapshot.');
  console.error(error);
  process.exit(1);
});
