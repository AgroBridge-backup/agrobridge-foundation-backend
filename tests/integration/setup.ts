import { beforeAll, afterAll } from 'vitest';

import { startTestDb, stopTestDb } from './test-db.js';

// Real Postgres via Testcontainers.
// This is the backbone for "accuracy": routes/repos/services run against a real DB.
beforeAll(async () => {
  await startTestDb();
}, 120_000);

afterAll(async () => {
  await stopTestDb();
});
