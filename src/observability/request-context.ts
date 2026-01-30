import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyBaseLogger } from 'fastify';

type Store = {
  log: FastifyBaseLogger;
};

const als = new AsyncLocalStorage<Store>();

export const requestContext = {
  // Establishes request-scoped context.
  // IMPORTANT: the provided callback must execute the rest of the request pipeline.
  // Fastify continues the lifecycle after this hook returns, so we rely on ALS being
  // preserved across async boundaries for the same request.
  run(log: FastifyBaseLogger): void {
    als.enterWith({ log });
  },
  getLog(): FastifyBaseLogger | undefined {
    return als.getStore()?.log;
  },
};
