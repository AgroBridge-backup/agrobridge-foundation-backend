import { execSync } from 'node:child_process';

// Accuracy gate: integration/coverage tests require a real container runtime.
// We fail fast with a clear error instead of producing misleading results.
try {
  execSync('docker info', { stdio: 'ignore' });
} catch {
   
  console.error('Docker is required for integration tests (Testcontainers). Start Docker Desktop and retry.');
  process.exit(1);
}
