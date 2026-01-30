#!/usr/bin/env node
import fs from 'fs';

const files = [
  'tests/unit/repositories/admin-user-repo.test.ts',
  'tests/unit/repositories/contact-request-repo.test.ts',
  'tests/unit/repositories/donation-repo.test.ts',
  'tests/unit/repositories/webhook-event-repo.test.ts',
  'tests/unit/services/admin-dashboard-service.test.ts',
  'tests/unit/services/auth-service-new.test.ts',
];

console.log('🔧 Fixing mock/fixture imports...\n');

for (const file of files) {
  if (!fs.existsSync(file)) continue;

  let content = fs.readFileSync(file, 'utf-8');
  const original = content;

  // Fix mock/fixture imports
  content = content.replace(
    /from ['"]\.\.\/(mocks|fixtures)\/([^'"]+)\.js['"]/g,
    "from '../$1/$2'",
  );

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf-8');
    console.log(`✅ ${file}`);
  }
}

console.log('\n✨ Done!');
