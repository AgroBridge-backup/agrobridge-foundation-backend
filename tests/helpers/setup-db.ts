import { startTestDb, stopTestDb } from '../integration/test-db.js';

export async function setupTestDatabase() {
  return startTestDb();
}

export async function teardownTestDatabase() {
  await stopTestDb();
}
