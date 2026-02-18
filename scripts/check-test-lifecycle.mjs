import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const targetDirs = ['tests/e2e', 'tests/integration'];
const issues = [];

function collectTestFiles(startDir) {
  const files = [];
  const absoluteStart = path.join(rootDir, startDir);

  if (!existsSync(absoluteStart)) {
    return files;
  }

  function walk(dirPath) {
    for (const entry of readdirSync(dirPath)) {
      const absolutePath = path.join(dirPath, entry);
      const stats = statSync(absolutePath);

      if (stats.isDirectory()) {
        walk(absolutePath);
        continue;
      }

      if (entry.endsWith('.test.ts')) {
        files.push(absolutePath);
      }
    }
  }

  walk(absoluteStart);
  return files;
}

for (const targetDir of targetDirs) {
  const files = collectTestFiles(targetDir);

  for (const filePath of files) {
    const relativePath = path.relative(rootDir, filePath);
    const source = readFileSync(filePath, 'utf8');
    const lines = source.split(/\r?\n/);
    let hasBuildAppCall = false;

    for (let idx = 0; idx < lines.length; idx += 1) {
      const line = lines[idx];
      const trimmed = line.trim();

      if (trimmed.startsWith('//')) {
        continue;
      }

      if (line.includes('buildApp(')) {
        hasBuildAppCall = true;
        if (!line.includes('await buildApp(')) {
          issues.push(
            `${relativePath}:${idx + 1} buildApp(...) must be awaited (use await buildApp(...))`,
          );
        }
      }
    }

    if (!hasBuildAppCall) {
      continue;
    }

    if (!/\bawait\s+[A-Za-z_$][\w$]*\.ready\(/.test(source)) {
      issues.push(`${relativePath} must call await <app>.ready() before requests`);
    }

    if (!/\bawait\s+[A-Za-z_$][\w$]*\.close\(/.test(source)) {
      issues.push(`${relativePath} must call await <app>.close() during teardown`);
    }
  }
}

if (issues.length > 0) {
  console.error('Test harness lifecycle checks failed:');
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log('Test harness lifecycle checks passed.');
