import 'dotenv/config';

import { buildApp } from './app.js';
import { startOtel } from './observability/otel.js';

const SHUTDOWN_TIMEOUT_MS = 15_000; // Force-exit after 15s if drain stalls

async function main() {
  await startOtel();

  const app = await buildApp();
  const port = app.env.PORT;
  const host = '0.0.0.0';

  await app.listen({ port, host });

  app.log.info({ port }, 'server listening');

  // --- Graceful shutdown ---
  // Ensures in-flight requests (especially Stripe sessions) complete before exit.
  // Fastify's close() triggers onClose hooks for Prisma disconnect, Redis disconnect, etc.
  let isShuttingDown = false;

  async function shutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    app.log.info({ signal }, 'graceful shutdown initiated');

    // Force-exit safety net: if close() hangs, exit after timeout
    const forceExitTimer = setTimeout(() => {
      app.log.error('graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExitTimer.unref(); // Don't keep the event loop alive

    try {
      // Fastify close():
      // 1. Stops listening for new connections
      // 2. Waits for in-flight requests to complete (up to connectionTimeout)
      // 3. Runs all onClose hooks (Prisma $disconnect, Redis disconnect)
      await app.close();
      app.log.info('graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during graceful shutdown');
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
