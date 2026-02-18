import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateOpenApiDocument } from '../lib/contract-app.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPENAPI_SNAPSHOT_PATH = resolve(__dirname, '..', 'openapi', 'openapi.v1.snapshot.json');

async function main() {
  const doc = await generateOpenApiDocument();
  await mkdir(dirname(OPENAPI_SNAPSHOT_PATH), { recursive: true });
  await writeFile(OPENAPI_SNAPSHOT_PATH, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  console.log(`OpenAPI snapshot updated: ${OPENAPI_SNAPSHOT_PATH}`);
}

main().catch((err) => {
  console.error('Failed to export OpenAPI snapshot.');
  console.error(err);
  process.exitCode = 1;
});
