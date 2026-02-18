#!/usr/bin/env node

import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const requiredFiles = [
  'contracts/openapi/openapi.v1.snapshot.json',
  'contracts/schemas/post-api-donations-intent.response.v1.json',
  'contracts/schemas/post-api-donations-intent.response.v1.ts',
  'contracts/schemas/post-api-contacts.response.v1.json',
  'contracts/schemas/post-api-contacts.response.v1.ts',
];

async function fileExists(pathname) {
  try {
    await access(pathname);
    return true;
  } catch {
    return false;
  }
}

async function validateJson(pathname) {
  const raw = await readFile(pathname, 'utf8');
  try {
    JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${pathname}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  const missing = [];
  for (const relative of requiredFiles) {
    const fullPath = resolve(relative);
    if (!(await fileExists(fullPath))) {
      missing.push(relative);
    }
  }

  if (missing.length > 0) {
    console.error('Contract preflight failed. Missing required contract assets:');
    for (const entry of missing) {
      console.error(`- ${entry}`);
    }
    process.exit(1);
  }

  await validateJson(resolve('contracts/openapi/openapi.v1.snapshot.json'));
  await validateJson(resolve('contracts/schemas/post-api-donations-intent.response.v1.json'));
  await validateJson(resolve('contracts/schemas/post-api-contacts.response.v1.json'));

  console.log('Contract preflight passed.');
}

main().catch((error) => {
  console.error('Contract preflight execution failed.');
  console.error(error);
  process.exit(1);
});
