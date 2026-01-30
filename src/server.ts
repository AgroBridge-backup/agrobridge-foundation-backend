import 'dotenv/config';

import { buildApp } from './app.js';
import { startOtel } from './observability/otel.js';

async function main() {
  await startOtel();

  const app = await buildApp();
  const port = app.env.PORT;
  const host = '0.0.0.0';

  await app.listen({ port, host });

  app.log.info({ port }, 'server listening');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
