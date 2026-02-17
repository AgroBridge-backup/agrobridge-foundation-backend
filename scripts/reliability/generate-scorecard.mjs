#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';
const now = new Date();
const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
const dateStamp = now.toISOString().slice(0, 10);

const docsOutputPath = resolve('docs/reports', `reliability-scorecard-${dateStamp}.md`);
const jsonOutputPath = resolve('artifacts/reliability', `scorecard-${dateStamp}.json`);

if (!repository) {
  console.error('ERROR: GITHUB_REPOSITORY is required (owner/repo).');
  process.exit(1);
}

const [owner, repo] = repository.split('/');

function percentage(value) {
  return `${(value * 100).toFixed(2)}%`;
}

async function githubApi(pathname, searchParams = {}) {
  const url = new URL(`https://api.github.com${pathname}`);
  for (const [k, v] of Object.entries(searchParams)) {
    url.searchParams.set(k, String(v));
  }

  const headers = {
    Accept: 'application/vnd.github+json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API request failed (${response.status}) for ${url.pathname}`);
  }
  return response.json();
}

async function listBackendGateRuns() {
  const warnings = [];
  const workflows = await githubApi(`/repos/${owner}/${repo}/actions/workflows`, {
    per_page: 100,
  });

  const targetWorkflow = workflows.workflows?.find(
    (workflow) =>
      workflow.path?.endsWith('/backend-gates.yml') || workflow.name === 'Backend Gates',
  );

  if (!targetWorkflow) {
    warnings.push('Backend Gates workflow not found; using repository-level run fallback.');
    const runsPayload = await githubApi(`/repos/${owner}/${repo}/actions/runs`, {
      per_page: 100,
      status: 'completed',
    });

    const fallbackRuns = (runsPayload.workflow_runs ?? []).filter((run) => {
      const runName = (run.name ?? '').toLowerCase();
      const runPath = (run.path ?? '').toLowerCase();
      const createdAt = new Date(run.created_at).getTime();
      return (
        createdAt >= since.getTime() &&
        (runName === 'backend gates' || runPath.endsWith('/backend-gates.yml'))
      );
    });

    if (fallbackRuns.length === 0) {
      warnings.push('No Backend Gates runs found in the last 7 days.');
    }

    return { runs: fallbackRuns, warnings };
  }

  const runsPayload = await githubApi(
    `/repos/${owner}/${repo}/actions/workflows/${targetWorkflow.id}/runs`,
    {
      per_page: 100,
      status: 'completed',
    },
  );

  return {
    runs: (runsPayload.workflow_runs ?? []).filter(
      (run) => new Date(run.created_at).getTime() >= since.getTime(),
    ),
    warnings,
  };
}

async function countContractDriftEvents(runs) {
  const failedRuns = runs.filter((run) => run.conclusion && run.conclusion !== 'success');
  if (failedRuns.length === 0) return 0;

  const results = await Promise.all(
    failedRuns.map(async (run) => {
      const jobsPayload = await githubApi(`/repos/${owner}/${repo}/actions/runs/${run.id}/jobs`, {
        per_page: 100,
      });
      const jobs = jobsPayload.jobs ?? [];
      return jobs.some((job) => {
        const name = (job.name ?? '').toLowerCase();
        const failed = job.conclusion && job.conclusion !== 'success';
        return failed && (name === 'contracts' || name === 'frontend-compat');
      });
    }),
  );

  return results.filter(Boolean).length;
}

function computeIncidentsAndMttr(runs) {
  const ordered = [...runs].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  let openIncidentStart = null;
  let incidentCount = 0;
  const mttrSamplesMs = [];

  for (const run of ordered) {
    const isSuccess = run.conclusion === 'success';
    if (!isSuccess && !openIncidentStart) {
      incidentCount += 1;
      openIncidentStart = new Date(run.created_at).getTime();
    }

    if (isSuccess && openIncidentStart) {
      const recoveredAt = new Date(run.updated_at ?? run.created_at).getTime();
      mttrSamplesMs.push(Math.max(0, recoveredAt - openIncidentStart));
      openIncidentStart = null;
    }
  }

  const mttrMinutes =
    mttrSamplesMs.length === 0
      ? 0
      : mttrSamplesMs.reduce((sum, value) => sum + value, 0) / mttrSamplesMs.length / 60000;

  return { incidentCount, mttrMinutes, mttrSamplesMs };
}

async function writeOutputs(report) {
  await mkdir(resolve('docs/reports'), { recursive: true });
  await mkdir(resolve('artifacts/reliability'), { recursive: true });

  const md = [
    `# Weekly Reliability Scorecard (${dateStamp})`,
    '',
    `Period: ${since.toISOString()} to ${now.toISOString()}`,
    '',
    '## Metrics',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Flake rate | ${percentage(report.metrics.flakeRate)} |`,
    `| Required gate pass rate | ${percentage(report.metrics.requiredGatePassRate)} |`,
    `| MTTR (minutes) | ${report.metrics.mttrMinutes.toFixed(2)} |`,
    `| Incident count | ${report.metrics.incidentCount} |`,
    `| Contract drift events | ${report.metrics.contractDriftEvents} |`,
    '',
    '## Notes',
    '',
    '- Flake rate uses workflow rerun attempts (`run_attempt > 1`).',
    '- Required gate pass rate is based on Backend Gates workflow conclusions over the period.',
    '- Contract drift events count failed `contracts` or `frontend-compat` jobs in failed runs.',
  ].join('\n');

  await writeFile(docsOutputPath, `${md}\n`, 'utf8');
  await writeFile(jsonOutputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function main() {
  const { runs, warnings } = await listBackendGateRuns();
  const totalRuns = runs.length;
  const successfulRuns = runs.filter((run) => run.conclusion === 'success').length;
  const flakeRuns = runs.filter((run) => Number(run.run_attempt ?? 1) > 1).length;

  const requiredGatePassRate = totalRuns === 0 ? 0 : successfulRuns / totalRuns;
  const flakeRate = totalRuns === 0 ? 0 : flakeRuns / totalRuns;

  const { incidentCount, mttrMinutes, mttrSamplesMs } = computeIncidentsAndMttr(runs);
  const contractDriftEvents = await countContractDriftEvents(runs);

  const report = {
    generatedAt: now.toISOString(),
    period: {
      start: since.toISOString(),
      end: now.toISOString(),
      days: 7,
    },
    repository,
    totals: {
      runs: totalRuns,
      successfulRuns,
      failedRuns: totalRuns - successfulRuns,
      flakeRuns,
    },
    metrics: {
      flakeRate,
      requiredGatePassRate,
      mttrMinutes,
      incidentCount,
      contractDriftEvents,
    },
    mttrSamplesMs,
    warnings,
  };

  await writeOutputs(report);

  console.log(`Scorecard markdown: ${docsOutputPath}`);
  console.log(`Scorecard json: ${jsonOutputPath}`);
}

main().catch(async (error) => {
  const failureReport = {
    generatedAt: now.toISOString(),
    repository,
    error: error instanceof Error ? error.message : String(error),
  };

  await mkdir(resolve('artifacts/reliability'), { recursive: true });
  await writeFile(jsonOutputPath, `${JSON.stringify(failureReport, null, 2)}\n`, 'utf8');

  console.error('Failed to generate reliability scorecard.');
  console.error(error);
  process.exit(1);
});
