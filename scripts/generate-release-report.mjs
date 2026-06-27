import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const outputPathArg = process.argv[2] ?? 'artifacts/release/release-readiness.md';
const outputPath = path.join(rootDir, outputPathArg);
const artifactSensitivity = process.env.ARTIFACT_SENSITIVITY ?? 'internal';

const gateSpecs = [
  ['lint', process.env.GATE_LINT],
  ['build', process.env.GATE_BUILD],
  ['knip', process.env.GATE_KNIP],
  ['unit', process.env.GATE_UNIT],
  ['integration', process.env.GATE_INTEGRATION],
  ['e2e', process.env.GATE_E2E],
  ['contracts', process.env.GATE_CONTRACTS],
  ['frontend-compat', process.env.GATE_FRONTEND_COMPAT],
];

function normalizeResult(value) {
  if (!value) {
    return 'UNKNOWN';
  }
  const normalized = value.toLowerCase();
  if (normalized === 'success' || normalized === 'passed') {
    return 'PASS';
  }
  if (normalized === 'failure' || normalized === 'failed') {
    return 'FAIL';
  }
  if (normalized === 'cancelled') {
    return 'CANCELLED';
  }
  if (normalized === 'skipped') {
    return 'SKIPPED';
  }
  return value.toUpperCase();
}

const gates = gateSpecs.map(([name, status]) => ({
  name,
  status: normalizeResult(status),
}));

const requiredGateNames = ['lint', 'build', 'knip', 'unit', 'integration', 'e2e'];
const requiredGatesGreen = gates
  .filter((gate) => requiredGateNames.includes(gate.name))
  .every((gate) => gate.status === 'PASS');

const contractsGreen = gates.find((gate) => gate.name === 'contracts')?.status === 'PASS';

const openApiSnapshotPath = 'contracts/openapi/openapi.v1.snapshot.json';
const openApiSnapshotExists = existsSync(path.join(rootDir, openApiSnapshotPath));

const sloAlertPath = path.join(rootDir, 'monitoring/prometheus/alerts.yml');
const sloRequiredRules = [
  'BackendSLOErrorRateCritical',
  'BackendSLOP95LatencyWarning',
  'BackendDependencyReadinessCritical',
];

let sloRulePresence = sloRequiredRules.map((rule) => ({ rule, present: false }));
if (existsSync(sloAlertPath)) {
  const alertsText = readFileSync(sloAlertPath, 'utf8');
  sloRulePresence = sloRequiredRules.map((rule) => ({
    rule,
    present: alertsText.includes(`alert: ${rule}`),
  }));
}
const sloCompliant = sloRulePresence.every((entry) => entry.present);

const syntheticTestPath = path.join(rootDir, 'tests/contracts/synthetic-endpoints.test.ts');
const syntheticCoverage = {
  health: false,
  contacts: false,
  donationsIntent: false,
};

if (existsSync(syntheticTestPath)) {
  const syntheticText = readFileSync(syntheticTestPath, 'utf8');
  syntheticCoverage.health = syntheticText.includes('/api/health');
  syntheticCoverage.contacts = syntheticText.includes('/api/contacts');
  syntheticCoverage.donationsIntent = syntheticText.includes('/api/donations/intent');
}

const syntheticCompliant =
  syntheticCoverage.health && syntheticCoverage.contacts && syntheticCoverage.donationsIntent;

const branchProtectionSnapshotPath = 'artifacts/governance/branch-protection-main.json';
const branchProtectionSnapshotExists = existsSync(path.join(rootDir, branchProtectionSnapshotPath));

const blockingReasons = [];
for (const gate of gates) {
  if (requiredGateNames.includes(gate.name) && gate.status !== 'PASS') {
    blockingReasons.push(`Required gate "${gate.name}" is ${gate.status}`);
  }
}
if (!contractsGreen) {
  blockingReasons.push('Contracts gate is not PASS');
}
if (!openApiSnapshotExists) {
  blockingReasons.push(`OpenAPI snapshot missing at ${openApiSnapshotPath}`);
}
if (!syntheticCompliant) {
  blockingReasons.push('Synthetic endpoint coverage is incomplete');
}
if (!sloCompliant) {
  blockingReasons.push('Required SLO alert rules are incomplete');
}
if (!branchProtectionSnapshotExists) {
  blockingReasons.push(`Branch protection snapshot missing at ${branchProtectionSnapshotPath}`);
}

const overallStatus =
  requiredGatesGreen &&
  contractsGreen &&
  openApiSnapshotExists &&
  sloCompliant &&
  syntheticCompliant &&
  branchProtectionSnapshotExists
    ? 'GREEN'
    : 'ATTENTION';

const nowIso = new Date().toISOString();
const report = `# Backend Release Report

Generated: ${nowIso}

## Context

- Event: ${process.env.GITHUB_EVENT_NAME ?? 'local'}
- Ref: ${process.env.GITHUB_REF_NAME ?? process.env.GITHUB_REF ?? 'local'}
- Commit: ${process.env.GITHUB_SHA ?? 'local'}
- Workflow run: ${process.env.GITHUB_RUN_ID ?? 'local'}

## Gate Status

| Gate | Status |
| --- | --- |
${gates.map((gate) => `| ${gate.name} | ${gate.status} |`).join('\n')}

## Contract Drift

- Contracts job: ${contractsGreen ? 'PASS' : 'NOT PASS'}
- OpenAPI snapshot present (${openApiSnapshotPath}): ${openApiSnapshotExists ? 'YES' : 'NO'}
- Branch protection snapshot present (${branchProtectionSnapshotPath}): ${branchProtectionSnapshotExists ? 'YES' : 'NO'}

## Synthetic Coverage

- /api/health check present: ${syntheticCoverage.health ? 'YES' : 'NO'}
- /api/contacts check present: ${syntheticCoverage.contacts ? 'YES' : 'NO'}
- /api/donations/intent check present: ${syntheticCoverage.donationsIntent ? 'YES' : 'NO'}

## SLO Compliance Signals

| Rule | Present |
| --- | --- |
${sloRulePresence.map((entry) => `| ${entry.rule} | ${entry.present ? 'YES' : 'NO'} |`).join('\n')}

## Overall

- Required gate set green: ${requiredGatesGreen ? 'YES' : 'NO'}
- Contracts + snapshot green: ${contractsGreen && openApiSnapshotExists ? 'YES' : 'NO'}
- Synthetic endpoint coverage in-repo: ${syntheticCompliant ? 'YES' : 'NO'}
- SLO alert rule coverage in-repo: ${sloCompliant ? 'YES' : 'NO'}
- Release readiness verdict: ${overallStatus}

## Blocking Reasons

${blockingReasons.length > 0 ? blockingReasons.map((reason) => `- ${reason}`).join('\n') : '- None'}

## Rollback Handles

1. Revert CI/workflow changes in \`.github/workflows/backend-gates.yml\`.
2. Restore prior \`package.json\` gate scripts if gate instability is introduced.
3. Keep contract artifacts and schema lock tests to avoid compatibility blind spots.
`;

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, report, 'utf8');

const jsonOutputPath = outputPath.replace(/\.md$/, '.json');
const jsonPayload = {
  generatedAt: nowIso,
  sensitivity: artifactSensitivity,
  context: {
    event: process.env.GITHUB_EVENT_NAME ?? 'local',
    ref: process.env.GITHUB_REF_NAME ?? process.env.GITHUB_REF ?? 'local',
    commit: process.env.GITHUB_SHA ?? 'local',
    runId: process.env.GITHUB_RUN_ID ?? 'local',
  },
  gates,
  contract: {
    contractsGreen,
    openApiSnapshotPath,
    openApiSnapshotExists,
    branchProtectionSnapshotPath,
    branchProtectionSnapshotExists,
  },
  syntheticCoverage,
  sloRulePresence,
  blockingReasons,
  overallStatus,
};
writeFileSync(jsonOutputPath, `${JSON.stringify(jsonPayload, null, 2)}\n`, 'utf8');

console.log(`Release report generated at ${path.relative(rootDir, outputPath)}`);
