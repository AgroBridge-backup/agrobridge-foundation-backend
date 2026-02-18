import { trace } from '@opentelemetry/api';
import type { RedisClientType } from 'redis';

import { getRedisClient } from '../cache/redis-client.js';
import { loadEnv } from '../config/env.js';
import { requestContext } from '../observability/request-context.js';

/**
 * Idempotency layer for money-touching endpoints.
 *
 * ## How it works
 * 1. Client sends `Idempotency-Key: <uuid>` header with POST requests.
 * 2. On first request: execute handler, cache response in Redis with TTL.
 * 3. On duplicate request (same key): return cached response immediately.
 * 4. On conflict (key in-flight): return 409 to prevent double-processing.
 *
 * ## Storage
 * Uses Redis with 24h TTL. Key format: `idempotency:<key>`.
 * States: 'processing' → '{"status":...,"body":...}'.
 *
 * @author Alejandro Navarro Ayala - CEO & Founder, AgroBridge
 * @security Critical — prevents duplicate Stripe checkout sessions
 */

const IDEMPOTENCY_TTL_SEC = 86_400; // 24 hours
const PROCESSING_TTL_SEC = 60; // Lock timeout for in-flight requests

export interface IdempotencyResult<T> {
    /** Whether the response came from cache */
    cached: boolean;
    status: number;
    body: T;
}

export class IdempotencyService {
    private redis: RedisClientType | null = null;

    private getRedis(): RedisClientType | null {
        if (this.redis) return this.redis;
        try {
            const env = loadEnv();
            this.redis = getRedisClient(env);
            return this.redis;
        } catch {
            return null;
        }
    }

    /**
     * Execute a handler with idempotency protection.
     *
     * @param key - The idempotency key from the client
     * @param handler - The actual business logic to execute
     * @returns The response (cached or fresh)
     */
    async execute<T>(
        key: string,
        handler: () => Promise<{ status: number; body: T }>,
    ): Promise<IdempotencyResult<T>> {
        const tracer = trace.getTracer('agrobridge.idempotency');
        const log = requestContext.getLog();
        const redis = this.getRedis();

        // If Redis is unavailable, fall through to direct execution
        // (fail-open: better to risk a duplicate than reject valid requests)
        if (!redis) {
            log?.warn('Idempotency: Redis unavailable, executing without protection');
            const result = await handler();
            return { cached: false, ...result };
        }

        const redisKey = `idempotency:${key}`;

        return tracer.startActiveSpan('idempotency.check', async (span) => {
            span.setAttribute('idempotency.key', key);

            try {
                // Try to acquire the processing lock (SET NX with short TTL)
                const acquired = await redis.set(redisKey, 'processing', {
                    NX: true,
                    EX: PROCESSING_TTL_SEC,
                });

                if (acquired) {
                    // First request with this key — execute the handler
                    span.setAttribute('idempotency.status', 'new');
                    log?.info({ idempotencyKey: key }, 'Idempotency: new request');

                    try {
                        const result = await handler();

                        // Cache the successful response
                        const cached = JSON.stringify({
                            status: result.status,
                            body: result.body,
                        });
                        await redis.set(redisKey, cached, { EX: IDEMPOTENCY_TTL_SEC });

                        span.setAttribute('idempotency.cached_response', true);
                        return { cached: false, ...result };
                    } catch (err) {
                        // On handler failure, remove the lock so retry is possible
                        await redis.del(redisKey).catch(() => { });
                        throw err;
                    }
                }

                // Key already exists — check if it's still processing or has a result
                const existing = await redis.get(redisKey);

                if (existing === 'processing') {
                    // Another request is still processing — conflict
                    span.setAttribute('idempotency.status', 'conflict');
                    log?.warn({ idempotencyKey: key }, 'Idempotency: request in flight');
                    return {
                        cached: true,
                        status: 409,
                        body: {
                            ok: false,
                            error: {
                                code: 'IDEMPOTENCY_CONFLICT',
                                message: 'A request with this idempotency key is already being processed.',
                            },
                        } as unknown as T,
                    };
                }

                if (existing) {
                    // We have a cached response — return it
                    span.setAttribute('idempotency.status', 'cached');
                    log?.info({ idempotencyKey: key }, 'Idempotency: returning cached response');

                    const parsed = JSON.parse(existing) as { status: number; body: T };
                    return { cached: true, ...parsed };
                }

                // Edge case: key existed but was deleted between SET and GET
                span.setAttribute('idempotency.status', 'race_fallthrough');
                const result = await handler();
                return { cached: false, ...result };
            } catch (err) {
                span.recordException(err as Error);
                span.setStatus({ code: 2 });
                throw err;
            } finally {
                span.end();
            }
        });
    }

    /**
     * Validate an idempotency key format.
     * Must be a valid UUID v4 to prevent key injection.
     */
    static isValidKey(key: string): boolean {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key);
    }
}

// Singleton
let instance: IdempotencyService | null = null;
export function getIdempotencyService(): IdempotencyService {
    if (!instance) {
        instance = new IdempotencyService();
    }
    return instance;
}
