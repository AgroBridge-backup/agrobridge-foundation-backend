#!/usr/bin/env node
import fs from 'fs';

const files = [
  'tests/unit/config/logger.test.ts',
  'tests/unit/auth/jwt.test.ts',
  'tests/unit/observability/db-span-logging.test.ts',
  'tests/unit/http/response.test.ts',
  'tests/unit/utils/cursor.test.ts',
  'tests/unit/routes/admin-routes.test.ts',
  'tests/unit/routes/webhooks-stripe.test.ts',
];

console.log('🔧 Adding app-error import to files that need it...\n');

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.log(`⚠️  File not found: ${file}`);
    continue;
  }

  let content = fs.readFileSync(file, 'utf-8');
  const original = content;

  // Add app-error import after vitest import
  content = content.replace(
    /(from 'vitest';)/,
    "$1\nimport { Errors } from '../../src/errors/app-error.js';",
  );

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf-8');
    console.log(`✅ Fixed: ${file}`);
  } else {
    console.log(`✓ No changes: ${file}`);
  }
}

console.log('\n✨ Done!');
