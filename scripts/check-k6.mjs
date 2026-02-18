import { execSync } from 'node:child_process';

try {
  execSync('k6 version', { stdio: 'ignore' });
} catch {
  console.error('k6 is required for Tier 3 load tests. Install k6 and retry.');
  process.exit(1);
}
