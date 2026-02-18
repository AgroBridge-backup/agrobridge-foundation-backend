#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const gateName = process.argv[2];
const command = process.argv[3];
const logPathArg = process.argv[4] ?? '';

if (!gateName || !command) {
  console.error('Usage: node scripts/ci/run-gate.mjs <gate-name> <command> [log-path]');
  process.exit(2);
}

const gateArtifactDir = resolve('artifacts/gates');
const gateArtifactPath = resolve(gateArtifactDir, `${gateName}.json`);
const logPath = logPathArg.trim().length > 0 ? resolve(logPathArg) : null;
const artifactSensitivity = process.env.ARTIFACT_SENSITIVITY ?? 'internal';

function failureClassFromExit(code, signal) {
  if (code === 0 && !signal) return null;
  if (signal) return `signal:${signal}`;
  return `exit:${code ?? 1}`;
}

async function writeGateArtifact(payload) {
  await mkdir(gateArtifactDir, { recursive: true });
  await writeFile(gateArtifactPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function main() {
  if (logPath) {
    await mkdir(dirname(logPath), { recursive: true });
  }

  const start = Date.now();
  const startedAt = new Date(start).toISOString();
  const child = spawn(command, {
    shell: true,
    stdio: ['inherit', 'pipe', 'pipe'],
    env: process.env,
  });

  let logStream = null;
  if (logPath) {
    logStream = createWriteStream(logPath, { flags: 'a', encoding: 'utf8' });
  }

  const writeOut = (chunk) => {
    process.stdout.write(chunk);
    if (logStream) logStream.write(chunk);
  };
  const writeErr = (chunk) => {
    process.stderr.write(chunk);
    if (logStream) logStream.write(chunk);
  };

  child.stdout?.on('data', writeOut);
  child.stderr?.on('data', writeErr);

  const result = await new Promise((resolveChild, rejectChild) => {
    child.on('error', rejectChild);
    child.on('close', (code, signal) => resolveChild({ code, signal }));
  });

  if (logStream) {
    await new Promise((resolveClose) => logStream.end(resolveClose));
  }

  const end = Date.now();
  const status = result.code === 0 && !result.signal ? 'pass' : 'fail';
  const payload = {
    gate: gateName,
    command,
    status,
    durationMs: end - start,
    failureClass: failureClassFromExit(result.code, result.signal),
    sha: process.env.GITHUB_SHA ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    startedAt,
    completedAt: new Date(end).toISOString(),
    logPath,
    sensitivity: artifactSensitivity,
  };

  await writeGateArtifact(payload);

  if (status === 'fail') {
    process.exit(result.code ?? 1);
  }
}

main().catch(async (error) => {
  const end = Date.now();
  await writeGateArtifact({
    gate: gateName,
    command,
    status: 'error',
    durationMs: 0,
    failureClass: 'execution-error',
    sha: process.env.GITHUB_SHA ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    startedAt: new Date(end).toISOString(),
    completedAt: new Date(end).toISOString(),
    logPath,
    sensitivity: artifactSensitivity,
    error: error instanceof Error ? error.message : String(error),
  });
  console.error('Gate execution wrapper failed.');
  console.error(error);
  process.exit(1);
});
