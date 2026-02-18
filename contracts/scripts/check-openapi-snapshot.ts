import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateOpenApiDocument } from '../lib/contract-app.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPENAPI_SNAPSHOT_PATH = resolve(__dirname, '..', 'openapi', 'openapi.v1.snapshot.json');

async function main() {
  const current = await generateOpenApiDocument();

  let expectedRaw: string;
  try {
    expectedRaw = await readFile(OPENAPI_SNAPSHOT_PATH, 'utf8');
  } catch (err) {
    console.error(`OpenAPI snapshot missing: ${OPENAPI_SNAPSHOT_PATH}`);
    console.error('Run: npm run contracts:openapi:export');
    if (err) console.error(err);
    process.exitCode = 1;
    return;
  }

  let expected: unknown;
  try {
    expected = JSON.parse(expectedRaw);
  } catch (err) {
    console.error(`OpenAPI snapshot is invalid JSON: ${OPENAPI_SNAPSHOT_PATH}`);
    if (err) console.error(err);
    process.exitCode = 1;
    return;
  }

  if (JSON.stringify(current) !== JSON.stringify(expected)) {
    console.error('OpenAPI snapshot drift detected.');
    console.error('Run: npm run contracts:openapi:export');
    process.exitCode = 1;
    return;
  }

  console.log('OpenAPI snapshot is up to date.');
}

main().catch((err) => {
  console.error('Failed to check OpenAPI snapshot.');
  console.error(err);
  process.exitCode = 1;
});
