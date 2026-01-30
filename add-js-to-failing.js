#!/usr/bin/env node
import fs from 'fs';

const failingFiles = [
  'tests/unit/config/env.test.ts',
  'tests/unit/config/logger.test.ts',
  'tests/unit/auth/jwt.test.ts',
  'tests/unit/observability/db-span-logging.test.ts',
  'tests/unit/repositories/donation-repo.test.ts',
  'tests/unit/repositories/webhook-event-repo.test.ts',
  'tests/unit/routes/admin-routes.test.ts',
  'tests/unit/routes/webhooks-stripe.test.ts',
  'tests/unit/services/admin-dashboard-service.test.ts',
  'tests/unit/services/auth-service-new.test.ts',
  'tests/unit/http/response.test.ts',
  'tests/unit/utils/cursor.test.ts',
];

console.log('🔧 Adding .js to ONLY failing files...\n');

for (const file of failingFiles) {
  if (!fs.existsSync(file)) {
    console.log(`⚠️  File not found: ${file}`);
    continue;
  }

  let content = fs.readFileSync(file, 'utf-8');
  const original = content;

  // Add .js to src imports (if not already there)
  content = content.replace(
    /from ['"]\.\.\/\.\.\/src\/([^'"]+)['"](?!\.js['"])/g,
    "from '../../src/$1.js'",
  );

  // Add .js to mocks/fixtures imports (if not already there)
  content = content.replace(
    /from ['"]\.\.\/(mocks|fixtures)\/([^'"]+)['"](?!\.js['"])/g,
    "from '../$1/$2.js'",
  );

  // Add .js to helpers imports (if not already there)
  content = content.replace(
    /from ['"]\.\.\/helpers\/([^'"]+)['"](?!\.js['"])/g,
    "from '../helpers/$1.js'",
  );

  // Add .js to errors imports (if not already there)
  content = content.replace(
    /from ['"]\.\.\/\.\.\/errors\/([^'"]+)['"](?!\.js['"])/g,
    "from '../../src/errors/$1.js'",
  );

  // Add .js to webhooks imports (if not already there)
  content = content.replace(
    /from ['"]\.\.\/\.\.\/webhooks\/([^'"]+)['"](?!\.js['"])/g,
    "from '../../src/webhooks/$1.js'",
  );

  // Add .js to http imports (if not already there)
  content = content.replace(
    /from ['"]\.\.\/\.\.\/http\/([^'"]+)['"](?!\.js['"])/g,
    "from '../../src/http/$1.js'",
  );

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf-8');
    console.log(`✅ Fixed: ${file}`);
  } else {
    console.log(`✓ No changes: ${file}`);
  }
}

console.log('\n✨ Done!');
