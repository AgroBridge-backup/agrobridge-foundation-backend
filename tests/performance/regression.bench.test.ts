import { describe, it, expect } from 'vitest';
import { TieredRateLimiter } from '../../../src/rate-limiting/tiered-rate-limiter.js';
import { InMemoryRateLimitStore } from '../../../src/rate-limiting/in-memory-rate-limit-store.js';
import { RateLimitTier } from '../../../src/rate-limiting/tier-config.js';
import {
  average,
  getEnvNumber,
  isTier3Enabled,
  nowMs,
  percentile,
  ratio,
  sleep,
} from '../helpers/reliability-tier.js';

type LatencyStats = {
  p50: number;
  p95: number;
  p99: number;
  mean: number;
};

const describeTier3 = isTier3Enabled() ? describe : describe.skip;

const LATENCY_ITERATIONS = Math.floor(getEnvNumber('TEST_TIER3_LATENCY_ITERATIONS', 6000));
const THROUGHPUT_ITERATIONS = Math.floor(getEnvNumber('TEST_TIER3_THROUGHPUT_ITERATIONS', 10000));
const THROUGHPUT_CONCURRENCY = Math.floor(getEnvNumber('TEST_TIER3_THROUGHPUT_CONCURRENCY', 100));
const TIER_THROUGHPUT_ITERATIONS = Math.floor(
  getEnvNumber('TEST_TIER3_TIER_THROUGHPUT_ITERATIONS', 2500),
);
const RESOURCE_ITERATIONS = Math.floor(getEnvNumber('TEST_TIER3_RESOURCE_ITERATIONS', 8000));
const ERROR_ITERATIONS = Math.floor(getEnvNumber('TEST_TIER3_ERROR_ITERATIONS', 2500));
const CLEANUP_BUFFER_MS = getEnvNumber('TEST_TIER3_CLEANUP_BUFFER_MS', 250);
const RESOURCE_SETTLE_MS = getEnvNumber('TEST_TIER3_RESOURCE_SETTLE_MS', 150);

const LATENCY_P99_RATIO_MAX = getEnvNumber('TEST_TIER3_LATENCY_P99_RATIO_MAX', 1.8);
const LATENCY_P95_RATIO_MAX = getEnvNumber('TEST_TIER3_LATENCY_P95_RATIO_MAX', 1.8);
const LATENCY_P50_RATIO_MAX = getEnvNumber('TEST_TIER3_LATENCY_P50_RATIO_MAX', 1.8);
const THROUGHPUT_REPEAT_MIN_RATIO = getEnvNumber('TEST_TIER3_THROUGHPUT_REPEAT_MIN_RATIO', 0.7);
const THROUGHPUT_CONCURRENT_MIN_RATIO = getEnvNumber(
  'TEST_TIER3_THROUGHPUT_CONCURRENT_MIN_RATIO',
  0.4,
);
const TIER_THROUGHPUT_REPEAT_MIN_RATIO = getEnvNumber(
  'TEST_TIER3_TIER_THROUGHPUT_REPEAT_MIN_RATIO',
  0.6,
);
const MEMORY_LINEAR_RATIO_MAX = getEnvNumber('TEST_TIER3_MEMORY_LINEAR_RATIO_MAX', 1.8);
const MEMORY_LINEAR_FLOOR_MB = getEnvNumber('TEST_TIER3_MEMORY_LINEAR_FLOOR_MB', 24);
const MEMORY_LINEAR_JITTER_MB = getEnvNumber('TEST_TIER3_MEMORY_LINEAR_JITTER_MB', 6);
const MEMORY_CLEANUP_PHASE_RATIO_MAX = getEnvNumber('TEST_TIER3_MEMORY_CLEANUP_PHASE_RATIO_MAX', 1.8);
const MEMORY_CLEANUP_FLOOR_MB = getEnvNumber('TEST_TIER3_MEMORY_CLEANUP_FLOOR_MB', 40);
const MEMORY_CLEANUP_JITTER_MB = getEnvNumber('TEST_TIER3_MEMORY_CLEANUP_JITTER_MB', 8);
const SCALABILITY_UNIT_COST_RATIO_MAX = getEnvNumber('TEST_TIER3_SCALABILITY_UNIT_COST_RATIO_MAX', 3.5);
const BURST_DEGRADATION_RATIO_MAX = getEnvNumber('TEST_TIER3_BURST_DEGRADATION_RATIO_MAX', 2.4);
const RESOURCE_GROWTH_RATIO_MAX = getEnvNumber('TEST_TIER3_RESOURCE_GROWTH_RATIO_MAX', 0.6);
const RESOURCE_GROWTH_FLOOR = Math.floor(getEnvNumber('TEST_TIER3_RESOURCE_GROWTH_FLOOR', 60));
const RESOURCE_STABILITY_RATIO_MAX = getEnvNumber('TEST_TIER3_RESOURCE_STABILITY_RATIO_MAX', 1.8);
const ERROR_PATH_P99_RATIO_MAX = getEnvNumber('TEST_TIER3_ERROR_PATH_P99_RATIO_MAX', 1.8);
const ERROR_PATH_P99_BASELINE_FLOOR_MS = getEnvNumber('TEST_TIER3_ERROR_PATH_P99_BASELINE_FLOOR_MS', 2);
const ERROR_PATH_P99_ABSOLUTE_MAX_MS = getEnvNumber('TEST_TIER3_ERROR_PATH_P99_ABSOLUTE_MAX_MS', 12);

describeTier3('Rate Limiting Performance Regression Tests', () => {
  describe('latency tests', () => {
    it('keeps percentile latencies within repeated-run envelope', async () => {
      const limiter = new TieredRateLimiter(new InMemoryRateLimitStore());

      const baseline = await collectLatencyStats(limiter, LATENCY_ITERATIONS, 'latency-baseline');
      const repeated = await collectLatencyStats(limiter, LATENCY_ITERATIONS, 'latency-repeat');

      assertLatencyOrdering(baseline);
      assertLatencyOrdering(repeated);

      expect(ratio(repeated.p99, Math.max(0.001, baseline.p99))).toBeLessThanOrEqual(
        LATENCY_P99_RATIO_MAX,
      );
      expect(ratio(repeated.p95, Math.max(0.001, baseline.p95))).toBeLessThanOrEqual(
        LATENCY_P95_RATIO_MAX,
      );
      expect(ratio(repeated.p50, Math.max(0.001, baseline.p50))).toBeLessThanOrEqual(
        LATENCY_P50_RATIO_MAX,
      );
    });
  });

  describe('throughput tests', () => {
    it('keeps sequential throughput stable across repeated runs', async () => {
      const limiter = new TieredRateLimiter(new InMemoryRateLimitStore());

      const firstRun = await runSequentialThroughput(
        limiter,
        THROUGHPUT_ITERATIONS,
        'throughput-first',
        RateLimitTier.PUBLIC,
      );
      const secondRun = await runSequentialThroughput(
        limiter,
        THROUGHPUT_ITERATIONS,
        'throughput-second',
        RateLimitTier.PUBLIC,
      );

      expect(ratio(secondRun.rps, Math.max(0.001, firstRun.rps))).toBeGreaterThanOrEqual(
        THROUGHPUT_REPEAT_MIN_RATIO,
      );
    });

    it('keeps concurrent throughput within sequential envelope', async () => {
      const limiter = new TieredRateLimiter(new InMemoryRateLimitStore());

      const sequential = await runSequentialThroughput(
        limiter,
        THROUGHPUT_ITERATIONS,
        'throughput-sequential',
        RateLimitTier.PUBLIC,
      );
      const concurrent = await runConcurrentThroughput(
        limiter,
        THROUGHPUT_ITERATIONS,
        THROUGHPUT_CONCURRENCY,
        'throughput-concurrent',
        RateLimitTier.PUBLIC,
      );

      expect(ratio(concurrent.rps, Math.max(0.001, sequential.rps))).toBeGreaterThanOrEqual(
        THROUGHPUT_CONCURRENT_MIN_RATIO,
      );
    });

    it('keeps per-tier throughput stable across repeated runs', async () => {
      const tiers = [
        RateLimitTier.PUBLIC,
        RateLimitTier.STRICT,
        RateLimitTier.ADMIN,
        RateLimitTier.VIP_ADMIN,
      ];

      for (const tier of tiers) {
        const limiter = new TieredRateLimiter(new InMemoryRateLimitStore());
        const firstRun = await runSequentialThroughput(
          limiter,
          TIER_THROUGHPUT_ITERATIONS,
          `tier-${tier}-run-1`,
          tier,
        );
        const secondRun = await runSequentialThroughput(
          limiter,
          TIER_THROUGHPUT_ITERATIONS,
          `tier-${tier}-run-2`,
          tier,
        );

        expect(ratio(secondRun.rps, Math.max(0.001, firstRun.rps))).toBeGreaterThanOrEqual(
          TIER_THROUGHPUT_REPEAT_MIN_RATIO,
        );
      }
    });
  });

  describe('memory tests', () => {
    it('keeps memory growth close to linear as unique keys double', async () => {
      const limiter = new TieredRateLimiter(new InMemoryRateLimitStore());
      const usersPerPhase = 40000;

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
        MEMORY_LINEAR_FLOOR_MB,
        phase1GrowthMB * MEMORY_LINEAR_RATIO_MAX + MEMORY_LINEAR_JITTER_MB,
      );

      expect(phase2GrowthMB).toBeLessThanOrEqual(maxAllowedPhase2GrowthMB);
    });

    it('keeps post-cleanup memory growth bounded to first phase envelope', async () => {
      const limiter = new TieredRateLimiter(new InMemoryRateLimitStore());
      const shortWindowMs = 100;
      const usersPerPhase = 30000;

      const memoryBefore = process.memoryUsage().heapUsed;

      for (let i = 0; i < usersPerPhase; i++) {
        await limiter.checkLimit(`cleanup-phase-1-${i}`, RateLimitTier.PUBLIC, shortWindowMs);
      }
      const memoryAfterPhase1 = process.memoryUsage().heapUsed;

      await sleep(shortWindowMs + CLEANUP_BUFFER_MS);

      for (let i = 0; i < usersPerPhase; i++) {
        await limiter.checkLimit(`cleanup-phase-2-${i}`, RateLimitTier.PUBLIC, shortWindowMs);
      }
      const memoryAfterPhase2 = process.memoryUsage().heapUsed;

      const phase1GrowthMB = Math.max(0, (memoryAfterPhase1 - memoryBefore) / 1024 / 1024);
      const phase2GrowthMB = Math.max(0, (memoryAfterPhase2 - memoryAfterPhase1) / 1024 / 1024);
      const maxAllowedPhase2GrowthMB = Math.max(
        MEMORY_CLEANUP_FLOOR_MB,
        phase1GrowthMB * MEMORY_CLEANUP_PHASE_RATIO_MAX + MEMORY_CLEANUP_JITTER_MB,
      );

      expect(phase2GrowthMB).toBeLessThanOrEqual(maxAllowedPhase2GrowthMB);
    });
  });

  describe('scalability tests', () => {
    it('scales near linearly with request count', async () => {
      const limiter = new TieredRateLimiter(new InMemoryRateLimitStore());
      const scales = [5000, 10000, 20000, 40000];
      const timings: number[] = [];

      for (const scale of scales) {
        const start = nowMs();
        for (let i = 0; i < scale; i++) {
          await limiter.checkLimit(`scale-user-${scale}-${i}`, RateLimitTier.PUBLIC);
        }
        timings.push(nowMs() - start);
      }

      for (let i = 1; i < timings.length; i++) {
        const previousUnitCost = timings[i - 1]! / scales[i - 1]!;
        const currentUnitCost = timings[i]! / scales[i]!;
        expect(ratio(currentUnitCost, Math.max(0.001, previousUnitCost))).toBeLessThanOrEqual(
          SCALABILITY_UNIT_COST_RATIO_MAX,
        );
      }
    });

    it('keeps burst throughput within baseline degradation envelope', async () => {
      const limiter = new TieredRateLimiter(new InMemoryRateLimitStore());

      const baseline = await runSequentialThroughput(
        limiter,
        3000,
        'burst-baseline',
        RateLimitTier.PUBLIC,
      );

      const burstStart = nowMs();
      await Promise.all(
        Array.from({ length: 5000 }, (_, i) =>
          limiter.checkLimit(`burst-user-${i}`, RateLimitTier.PUBLIC),
        ),
      );
      const burstDurationMs = nowMs() - burstStart;
      const burstRps = (5000 / Math.max(0.001, burstDurationMs)) * 1000;

      expect(ratio(baseline.rps, Math.max(0.001, burstRps))).toBeLessThanOrEqual(
        BURST_DEGRADATION_RATIO_MAX,
      );
    });
  });

  describe('resource usage tests', () => {
    it('keeps active resource growth within envelope', async () => {
      const limiter = new TieredRateLimiter(new InMemoryRateLimitStore());
      const before = getActiveResourceCount();

      for (let i = 0; i < RESOURCE_ITERATIONS; i++) {
        await limiter.checkLimit(`resource-user-${i}`, RateLimitTier.PUBLIC);
      }

      await sleep(RESOURCE_SETTLE_MS);
      const after = getActiveResourceCount();
      const increase = Math.max(0, after - before);
      const allowedIncrease = Math.max(RESOURCE_GROWTH_FLOOR, Math.ceil(before * RESOURCE_GROWTH_RATIO_MAX));

      expect(increase).toBeLessThanOrEqual(allowedIncrease);
    });

    it('keeps repeated burst resource growth stable', async () => {
      const limiter = new TieredRateLimiter(new InMemoryRateLimitStore());

      const firstIncrease = await measureResourceIncrease(limiter, RESOURCE_ITERATIONS);
      const secondIncrease = await measureResourceIncrease(limiter, RESOURCE_ITERATIONS);

      const allowedSecondIncrease = Math.max(
        RESOURCE_GROWTH_FLOOR,
        Math.ceil(firstIncrease * RESOURCE_STABILITY_RATIO_MAX),
      );

      expect(secondIncrease).toBeLessThanOrEqual(allowedSecondIncrease);
    });
  });

  describe('error handling performance', () => {
    it('keeps synthetic error-path p99 latency within baseline envelope', async () => {
      const limiter = new TieredRateLimiter(new InMemoryRateLimitStore());

      const baseline = await collectLatencyStats(limiter, ERROR_ITERATIONS, 'error-baseline');
      const syntheticErrorPath = await collectErrorPathLatencyStats(
        limiter,
        ERROR_ITERATIONS,
        'error-path',
      );
      const effectiveBaselineP99 = Math.max(ERROR_PATH_P99_BASELINE_FLOOR_MS, baseline.p99);
      const allowedP99 = Math.max(
        ERROR_PATH_P99_ABSOLUTE_MAX_MS,
        effectiveBaselineP99 * ERROR_PATH_P99_RATIO_MAX,
      );
      expect(syntheticErrorPath.p99).toBeLessThanOrEqual(allowedP99);
    });
  });
});

async function collectLatencyStats(
  limiter: TieredRateLimiter,
  iterations: number,
  prefix: string,
): Promise<LatencyStats> {
  const latencies: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = nowMs();
    await limiter.checkLimit(`${prefix}-${i}`, RateLimitTier.PUBLIC);
    latencies.push(nowMs() - start);
  }

  return {
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    p99: percentile(latencies, 0.99),
    mean: average(latencies),
  };
}

async function collectErrorPathLatencyStats(
  limiter: TieredRateLimiter,
  iterations: number,
  prefix: string,
): Promise<LatencyStats> {
  const latencies: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = nowMs();
    try {
      await limiter.checkLimit(`${prefix}-${i}`, RateLimitTier.PUBLIC);
      if (i % 10 === 0) {
        throw new Error('synthetic test error');
      }
    } catch {}
    latencies.push(nowMs() - start);
  }

  return {
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    p99: percentile(latencies, 0.99),
    mean: average(latencies),
  };
}

function assertLatencyOrdering(stats: LatencyStats): void {
  expect(stats.p50).toBeLessThanOrEqual(stats.p95);
  expect(stats.p95).toBeLessThanOrEqual(stats.p99);
  expect(stats.mean).toBeGreaterThanOrEqual(0);
}

async function runSequentialThroughput(
  limiter: TieredRateLimiter,
  iterations: number,
  prefix: string,
  tier: RateLimitTier,
): Promise<{ rps: number; durationMs: number }> {
  const start = nowMs();

  for (let i = 0; i < iterations; i++) {
    await limiter.checkLimit(`${prefix}-${i}`, tier);
  }

  const durationMs = nowMs() - start;
  return {
    durationMs,
    rps: (iterations / Math.max(0.001, durationMs)) * 1000,
  };
}

async function runConcurrentThroughput(
  limiter: TieredRateLimiter,
  iterations: number,
  concurrency: number,
  prefix: string,
  tier: RateLimitTier,
): Promise<{ rps: number; durationMs: number }> {
  const requestsPerWorker = Math.ceil(iterations / concurrency);

  const start = nowMs();
  await Promise.all(
    Array.from({ length: concurrency }, async (_, workerIndex) => {
      for (let i = 0; i < requestsPerWorker; i++) {
        await limiter.checkLimit(`${prefix}-${workerIndex}-${i}`, tier);
      }
    }),
  );
  const durationMs = nowMs() - start;
  const totalRequests = requestsPerWorker * concurrency;

  return {
    durationMs,
    rps: (totalRequests / Math.max(0.001, durationMs)) * 1000,
  };
}

function getActiveResourceCount(): number {
  if (!process.getActiveResourcesInfo) {
    return 0;
  }
  return process.getActiveResourcesInfo().length;
}

async function measureResourceIncrease(
  limiter: TieredRateLimiter,
  iterations: number,
): Promise<number> {
  const before = getActiveResourceCount();

  for (let i = 0; i < iterations; i++) {
    await limiter.checkLimit(`resource-burst-${i}`, RateLimitTier.PUBLIC);
  }

  await sleep(RESOURCE_SETTLE_MS);
  const after = getActiveResourceCount();
  return Math.max(0, after - before);
}
