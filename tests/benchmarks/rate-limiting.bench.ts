import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { createClient, type RedisClientType } from 'redis';
import { TieredRateLimiter } from '../../../src/rate-limiting/tiered-rate-limiter.js';
import { InMemoryRateLimitStore } from '../../../src/rate-limiting/in-memory-rate-limit-store.js';
import { RedisRateLimitStore } from '../../../src/rate-limiting/redis-rate-limit-store.js';
import { RateLimitTier } from '../../../src/rate-limiting/tier-config.js';
import {
  average,
  getEnvNumber,
  isTier3Enabled,
  nowMs,
  percentile,
  ratio,
} from '../helpers/reliability-tier.js';

const describeTier3 = isTier3Enabled() ? describe : describe.skip;

const LATENCY_ITERATIONS = Math.floor(getEnvNumber('TEST_TIER3_BENCH_LATENCY_ITERATIONS', 3000));
const THROUGHPUT_ITERATIONS = Math.floor(getEnvNumber('TEST_TIER3_BENCH_THROUGHPUT_ITERATIONS', 10000));

const BENCH_RUN_STABILITY_RATIO_MAX = getEnvNumber('TEST_TIER3_BENCH_RUN_STABILITY_RATIO_MAX', 2.2);
const IN_MEMORY_TO_REDIS_HZ_MIN_RATIO = getEnvNumber('TEST_TIER3_IN_MEMORY_TO_REDIS_HZ_MIN_RATIO', 0.7);
const MEMORY_PHASE2_RATIO_MAX = getEnvNumber('TEST_TIER3_BENCH_MEMORY_PHASE2_RATIO_MAX', 1.8);
const MEMORY_PHASE_FLOOR_MB = getEnvNumber('TEST_TIER3_BENCH_MEMORY_PHASE_FLOOR_MB', 6);

describeTier3('Rate Limiting Performance Benchmarks', () => {
  let redisContainer: StartedTestContainer;
  let redisClient: RedisClientType;

  beforeAll(async () => {
    redisContainer = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();

    redisClient = createClient({
      socket: {
        host: redisContainer.getHost(),
        port: redisContainer.getMappedPort(6379),
      },
    });

    await redisClient.connect();
  });

  afterAll(async () => {
    if (redisClient) {
      await redisClient.quit();
    }
    if (redisContainer) {
      await redisContainer.stop();
    }
  });

  describe('latency benchmarks', () => {
    it('keeps redis latency benchmark stable across repeated runs', async () => {
      const fallback = new InMemoryRateLimitStore();
      const limiter = new TieredRateLimiter(new RedisRateLimitStore(redisClient, fallback));

      const run1 = await runLatencyBench('Redis Latency Run 1', limiter);
      const run2 = await runLatencyBench('Redis Latency Run 2', limiter);

      expectRatioEnvelope(run2.mean, run1.mean);
      expectRatioEnvelope(run2.p99, run1.p99);
    }, 30000);

    it('keeps in-memory latency benchmark stable across repeated runs', async () => {
      const limiter = new TieredRateLimiter(new InMemoryRateLimitStore());

      const run1 = await runLatencyBench('InMemory Latency Run 1', limiter);
      const run2 = await runLatencyBench('InMemory Latency Run 2', limiter);

      expectRatioEnvelope(run2.mean, run1.mean);
      expectRatioEnvelope(run2.p99, run1.p99);
    }, 30000);
  });

  describe('throughput benchmarks', () => {
    it('keeps throughput benchmark stable for redis and in-memory stores', async () => {
      const fallback = new InMemoryRateLimitStore();
      const redisLimiter = new TieredRateLimiter(new RedisRateLimitStore(redisClient, fallback));
      const memoryLimiter = new TieredRateLimiter(new InMemoryRateLimitStore());

      const redisRun1 = await runThroughputBench('Redis Throughput Run 1', redisLimiter);
      const redisRun2 = await runThroughputBench('Redis Throughput Run 2', redisLimiter);
      const memoryRun1 = await runThroughputBench('Memory Throughput Run 1', memoryLimiter);
      const memoryRun2 = await runThroughputBench('Memory Throughput Run 2', memoryLimiter);

      expectRatioEnvelope(redisRun2.hz, redisRun1.hz);
      expectRatioEnvelope(memoryRun2.hz, memoryRun1.hz);
      expect(ratio(memoryRun2.hz, Math.max(0.001, redisRun2.hz))).toBeGreaterThanOrEqual(
        IN_MEMORY_TO_REDIS_HZ_MIN_RATIO,
      );
    }, 30000);
  });

  describe('memory benchmarks', () => {
    it('keeps second-phase memory growth bounded to first-phase envelope', async () => {
      const fallback = new InMemoryRateLimitStore();
      const limiter = new TieredRateLimiter(new RedisRateLimitStore(redisClient, fallback));
      const usersPerPhase = 50000;

      const memoryBefore = process.memoryUsage().heapUsed;
      for (let i = 0; i < usersPerPhase; i++) {
        await limiter.checkLimit(`memory-phase-1-${i}`, RateLimitTier.PUBLIC);
      }
      const memoryAfterPhase1 = process.memoryUsage().heapUsed;

      for (let i = 0; i < usersPerPhase; i++) {
        await limiter.checkLimit(`memory-phase-2-${i}`, RateLimitTier.PUBLIC);
      }
      const memoryAfterPhase2 = process.memoryUsage().heapUsed;

      const phase1GrowthMB = Math.max(0, (memoryAfterPhase1 - memoryBefore) / 1024 / 1024);
      const phase2GrowthMB = Math.max(0, (memoryAfterPhase2 - memoryAfterPhase1) / 1024 / 1024);
      const maxAllowedPhase2GrowthMB = Math.max(
        MEMORY_PHASE_FLOOR_MB,
        phase1GrowthMB * MEMORY_PHASE2_RATIO_MAX,
      );

      expect(phase2GrowthMB).toBeLessThanOrEqual(maxAllowedPhase2GrowthMB);
    }, 60000);
  });
});

async function runLatencyBench(
  name: string,
  limiter: TieredRateLimiter,
): Promise<{ mean: number; p99: number }> {
  const samplesMs: number[] = [];
  for (let i = 0; i < LATENCY_ITERATIONS; i++) {
    const start = nowMs();
    await limiter.checkLimit(`${name}-user-${i}`, RateLimitTier.PUBLIC);
    samplesMs.push(nowMs() - start);
  }

  return {
    mean: average(samplesMs),
    p99: percentile(samplesMs, 0.99),
  };
}

async function runThroughputBench(name: string, limiter: TieredRateLimiter): Promise<{ hz: number }> {
  const start = nowMs();
  for (let i = 0; i < THROUGHPUT_ITERATIONS; i++) {
    await limiter.checkLimit(`${name}-user-${i}`, RateLimitTier.PUBLIC);
  }
  const durationMs = nowMs() - start;

  return {
    hz: (THROUGHPUT_ITERATIONS / Math.max(0.001, durationMs)) * 1000,
  };
}

function expectRatioEnvelope(actual: number, baseline: number): void {
  const stableRatio = ratio(actual, Math.max(0.001, baseline));
  expect(stableRatio).toBeLessThanOrEqual(BENCH_RUN_STABILITY_RATIO_MAX);
}
