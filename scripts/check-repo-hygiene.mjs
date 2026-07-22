import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const ignoredDirs = new Set([
  '.git',
  'artifacts',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
]);

const issues = [];

function walk(dirPath) {
  for (const entry of readdirSync(dirPath)) {
    const absolutePath = path.join(dirPath, entry);
    const relativePath = path.relative(rootDir, absolutePath);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      if (!ignoredDirs.has(entry)) {
        walk(absolutePath);
      }
      continue;
    }

    if (/\.bak\d*$/i.test(entry)) {
      issues.push(`Disallowed backup file tracked: ${relativePath}`);
    }

    if (entry.startsWith('.eslintrc')) {
      issues.push(`Legacy ESLint config detected: ${relativePath}`);
    }
  }
}

walk(rootDir);

if (!existsSync(path.join(rootDir, 'eslint.config.js'))) {
  issues.push('Missing canonical ESLint flat config: eslint.config.js');
}

if (!existsSync(path.join(rootDir, '.github/workflows/backend-gates.yml'))) {
  issues.push('Missing required CI workflow: .github/workflows/backend-gates.yml');
}

if (issues.length > 0) {
  console.error('Repository hygiene checks failed:');
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log('Repository hygiene checks passed.');
