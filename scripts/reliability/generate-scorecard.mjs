#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';
const now = new Date();
const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
const dateStamp = now.toISOString().slice(0, 10);
const artifactSensitivity = process.env.ARTIFACT_SENSITIVITY ?? 'internal';

const requiredGateNames = (
  process.env.RELIABILITY_REQUIRED_GATES ?? 'lint,build,unit,integration,e2e'
)
  .split(',')
  .map((entry) => entry.trim().toLowerCase())
  .filter(Boolean);

const docsOutputPath = resolve('docs/reports', `reliability-scorecard-${dateStamp}.md`);
const jsonOutputPath = resolve('artifacts/reliability', `scorecard-${dateStamp}.json`);

if (!repository) {
  console.error('ERROR: GITHUB_REPOSITORY is required (owner/repo).');
  process.exit(1);
}

const [owner, repo] = repository.split('/');

function formatPercent(value) {
  return value === null ? 'N/A' : `${(value * 100).toFixed(2)}%`;
}

function formatNumber(value) {
  return value === null ? 'N/A' : value.toFixed(2);
}

function normalizeJobName(name) {
  return (name ?? '').trim().toLowerCase();
}

function gateMatch(gate, jobName) {
  return (
    jobName === gate ||
    jobName.startsWith(`${gate} `) ||
    jobName.startsWith(`${gate}/`) ||
    jobName.startsWith(`${gate}-`) ||
    jobName.startsWith(`${gate}(`)
  );
}

function parseOptionalFiniteEnvNumber(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value for ${name}: ${raw}`);
  }
  return parsed;
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

async function listBackendGateRuns(warnings) {
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
    return fallbackRuns;
  }

  const runsPayload = await githubApi(
    `/repos/${owner}/${repo}/actions/workflows/${targetWorkflow.id}/runs`,
    {
      per_page: 100,
      status: 'completed',
    },
  );

  const runs = (runsPayload.workflow_runs ?? []).filter(
    (run) => new Date(run.created_at).getTime() >= since.getTime(),
  );

  if (runs.length === 0) {
    warnings.push('No Backend Gates runs found in the last 7 days.');
  }
  return runs;
}

async function listJobsForRun(runId, cache) {
  if (cache.has(runId)) {
    return cache.get(runId);
  }

  const jobsPayload = await githubApi(`/repos/${owner}/${repo}/actions/runs/${runId}/jobs`, {
    per_page: 100,
  });

  const jobs = jobsPayload.jobs ?? [];
  cache.set(runId, jobs);
  return jobs;
}

async function buildRunAnalyses(runs) {
  const jobsCache = new Map();

  return Promise.all(
    runs.map(async (run) => {
      const jobs = await listJobsForRun(run.id, jobsCache);

      const requiredGates = requiredGateNames.map((gate) => {
        const job = jobs.find((entry) => gateMatch(gate, normalizeJobName(entry.name)));
        const status = (job?.conclusion ?? 'missing').toLowerCase();
        return {
          gate,
          status,
          pass: status === 'success',
        };
      });

      const requiredPass = requiredGates.every((entry) => entry.pass);
      const contractDriftFailure = jobs.some((job) => {
        const jobName = normalizeJobName(job.name);
        const failed = (job.conclusion ?? '').toLowerCase() !== 'success';
        return failed && (jobName === 'contracts' || jobName === 'frontend-compat');
      });

      return {
        id: run.id,
        runNumber: run.run_number,
        runAttempt: Number(run.run_attempt ?? 1),
        conclusion: run.conclusion ?? 'unknown',
        createdAt: run.created_at,
        updatedAt: run.updated_at ?? run.created_at,
        requiredPass,
        requiredGates,
        contractDriftFailure,
      };
    }),
  );
}

function computeCiRecoveryMttr(analyses) {
  const ordered = [...analyses].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  let openIncidentStart = null;
  let ciIncidentCount = 0;
  const samplesMs = [];

  for (const run of ordered) {
    if (!run.requiredPass && openIncidentStart === null) {
      ciIncidentCount += 1;
      openIncidentStart = new Date(run.createdAt).getTime();
    }

    if (run.requiredPass && openIncidentStart !== null) {
      const recoveredAt = new Date(run.updatedAt).getTime();
      samplesMs.push(Math.max(0, recoveredAt - openIncidentStart));
      openIncidentStart = null;
    }
  }

  return {
    ciIncidentCount,
    ciRecoverySamplesMs: samplesMs,
    ciRecoveryMttrMinutes:
      samplesMs.length === 0
        ? null
        : samplesMs.reduce((sum, value) => sum + value, 0) / samplesMs.length / 60000,
  };
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
    `| Flake rate | ${formatPercent(report.metrics.flakeRate)} |`,
    `| Required gate pass rate (job-level) | ${formatPercent(report.metrics.requiredGatePassRate)} |`,
    `| CI recovery MTTR (minutes) | ${formatNumber(report.metrics.ciRecoveryMttrMinutes)} |`,
    `| Service incident MTTR (minutes) | ${formatNumber(report.metrics.serviceIncidentMttrMinutes)} |`,
    `| CI incident count | ${report.metrics.ciIncidentCount} |`,
    `| Contract drift events | ${report.metrics.contractDriftEvents} |`,
    '',
    '## Notes',
    '',
    `- Required gate set: ${requiredGateNames.join(', ')}`,
    '- Flake rate uses workflow rerun attempts (`run_attempt > 1`).',
    '- Required gate pass rate is computed from required job-level conclusions per Backend Gates run.',
    '- Contract drift events count failed `contracts` or `frontend-compat` jobs.',
    '- `N/A` indicates no-data windows or unavailable incident telemetry.',
  ];

  if (report.warnings.length > 0) {
    md.push('', '## Warnings', '');
    for (const warning of report.warnings) {
      md.push(`- ${warning}`);
    }
  }

  await writeFile(docsOutputPath, `${md.join('\n')}\n`, 'utf8');
  await writeFile(jsonOutputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function main() {
  const warnings = [];
  const runs = await listBackendGateRuns(warnings);
  const analyses = await buildRunAnalyses(runs);

  const totalRuns = analyses.length;
  const successfulRuns = analyses.filter((run) => run.conclusion === 'success').length;
  const flakeRuns = analyses.filter((run) => run.runAttempt > 1).length;
  const requiredPassRuns = analyses.filter((run) => run.requiredPass).length;
  const contractDriftEvents = analyses.filter((run) => run.contractDriftFailure).length;

  const flakeRate = totalRuns === 0 ? null : flakeRuns / totalRuns;
  const requiredGatePassRate = totalRuns === 0 ? null : requiredPassRuns / totalRuns;

  const ciRecovery = computeCiRecoveryMttr(analyses);
  const serviceIncidentMttrMinutes = parseOptionalFiniteEnvNumber('SERVICE_INCIDENT_MTTR_MINUTES');
  if (serviceIncidentMttrMinutes === null) {
    warnings.push(
      'Service incident MTTR data not configured (set SERVICE_INCIDENT_MTTR_MINUTES or integrate an incident source).',
    );
  }

  const report = {
    generatedAt: now.toISOString(),
    period: {
      start: since.toISOString(),
      end: now.toISOString(),
      days: 7,
    },
    sensitivity: artifactSensitivity,
    repository,
    requiredGateNames,
    totals: {
      runs: totalRuns,
      successfulRuns,
      failedRuns: totalRuns - successfulRuns,
      flakeRuns,
      requiredPassRuns,
    },
    metrics: {
      flakeRate,
      requiredGatePassRate,
      ciRecoveryMttrMinutes: ciRecovery.ciRecoveryMttrMinutes,
      serviceIncidentMttrMinutes,
      ciIncidentCount: ciRecovery.ciIncidentCount,
      contractDriftEvents,
    },
    ciRecoverySamplesMs: ciRecovery.ciRecoverySamplesMs,
    runAnalyses: analyses.map((run) => ({
      id: run.id,
      runNumber: run.runNumber,
      runAttempt: run.runAttempt,
      conclusion: run.conclusion,
      requiredPass: run.requiredPass,
      requiredGates: run.requiredGates,
      contractDriftFailure: run.contractDriftFailure,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    })),
    warnings,
  };

  if (totalRuns === 0) {
    warnings.push('No-data window: no Backend Gates runs were completed in the lookback period.');
  }

  await writeOutputs(report);

  console.log(`Scorecard markdown: ${docsOutputPath}`);
  console.log(`Scorecard json: ${jsonOutputPath}`);
}

main().catch(async (error) => {
  const failureReport = {
    generatedAt: now.toISOString(),
    repository,
    sensitivity: artifactSensitivity,
    error: error instanceof Error ? error.message : String(error),
  };

  await mkdir(resolve('artifacts/reliability'), { recursive: true });
  await writeFile(jsonOutputPath, `${JSON.stringify(failureReport, null, 2)}\n`, 'utf8');

  console.error('Failed to generate reliability scorecard.');
  console.error(error);
  process.exit(1);
});
