/**
 * Concurrency Runner
 * Helper for running concurrent operations and detecting race conditions
 * 
 * @author Alejandro Navarro Ayala - CEO & Founder, AgroBridge
 */

import { performance } from 'perf_hooks';

export interface ConcurrentOperation<T> {
  name: string;
  operation: () => Promise<T>;
}

export interface ConcurrentResult<T> {
  operationName: string;
  index: number;
  success: boolean;
  result?: T;
  error?: Error;
  startTime: number;
  endTime: number;
  duration: number;
}

export interface RaceConditionCheck {
  type: 'duplicate' | 'inconsistent' | 'lost-update' | 'dirty-read';
  description: string;
  affectedOperations: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface ConcurrencyReport<T> {
  totalOperations: number;
  successful: number;
  failed: number;
  totalDuration: number;
  averageDuration: number;
  minDuration: number;
  maxDuration: number;
  results: ConcurrentResult<T>[];
  raceConditions: RaceConditionCheck[];
  timingAnalysis: {
    startTimes: number[];
    endTimes: number[];
    overlaps: Array<{op1: number; op2: number; overlap: number}>;
  };
}

/**
 * Concurrency Runner class
 */
export class ConcurrencyRunner {
  private results: ConcurrentResult<unknown>[] = [];
  private startTime: number = 0;

  /**
   * Run multiple operations concurrently
   */
  async runConcurrent<T>(
    operations: ConcurrentOperation<T>[],
    options: {
      maxConcurrency?: number;
      staggerDelay?: number;
      timeout?: number;
    } = {}
  ): Promise<ConcurrencyReport<T>> {
    const { maxConcurrency = operations.length, staggerDelay = 0, timeout = 30000 } = options;
    
    this.startTime = performance.now();
    this.results = [];

    // Create operation promises with optional staggering
    const promises: Promise<void>[] = [];
    const running: Promise<void>[] = [];

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      const delay = staggerDelay * i;

      const promise = (async () => {
        if (delay > 0) {
          await new Promise(r => setTimeout(r, delay));
        }

        const opStartTime = performance.now();
        
        try {
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Operation timeout')), timeout);
          });

          const result = await Promise.race([op.operation(), timeoutPromise]);
          
          const opEndTime = performance.now();
          
          this.results.push({
            operationName: op.name,
            index: i,
            success: true,
            result,
            startTime: opStartTime - this.startTime,
            endTime: opEndTime - this.startTime,
            duration: opEndTime - opStartTime
          });
        } catch (error) {
          const opEndTime = performance.now();
          
          this.results.push({
            operationName: op.name,
            index: i,
            success: false,
            error: error as Error,
            startTime: opStartTime - this.startTime,
            endTime: opEndTime - this.startTime,
            duration: opEndTime - opStartTime
          });
        }
      })();

      promises.push(promise);
      running.push(promise);

      // Limit concurrency
      if (running.length >= maxConcurrency) {
        await Promise.race(running);
        const index = running.findIndex(p => p === promise || p === promises[promises.length - 1]);
        if (index !== -1) {
          running.splice(index, 1);
        }
      }
    }

    await Promise.all(promises);

    return this.generateReport<T>();
  }

  /**
   * Run the same operation multiple times concurrently
   */
  async runParallel<T>(
    name: string,
    operation: () => Promise<T>,
    count: number,
    options: {
      maxConcurrency?: number;
      staggerDelay?: number;
      timeout?: number;
    } = {}
  ): Promise<ConcurrencyReport<T>> {
    const operations: ConcurrentOperation<T>[] = Array.from({ length: count }, (_, i) => ({
      name: `${name}-${i}`,
      operation
    }));

    return this.runConcurrent(operations, options);
  }

  /**
   * Simulate race condition by running operations with minimal delay
   */
  async simulateRaceCondition<T>(
    operations: ConcurrentOperation<T>[],
    options: {
      delayBetweenMs?: number;
      timeout?: number;
    } = {}
  ): Promise<ConcurrencyReport<T>> {
    const { delayBetweenMs = 10, timeout = 10000 } = options;

    return this.runConcurrent(operations, {
      maxConcurrency: operations.length,
      staggerDelay: delayBetweenMs,
      timeout
    });
  }

  /**
   * Generate comprehensive concurrency report
   */
  private generateReport<T>(): ConcurrencyReport<T> {
    const endTime = performance.now();
    const totalDuration = endTime - this.startTime;

    const durations = this.results.map(r => r.duration);
    const successful = this.results.filter(r => r.success);
    const failed = this.results.filter(r => !r.success);

    // Detect race conditions
    const raceConditions = this.detectRaceConditions();

    // Calculate timing overlaps
    const overlaps = this.calculateOverlaps();

    return {
      totalOperations: this.results.length,
      successful: successful.length,
      failed: failed.length,
      totalDuration,
      averageDuration: durations.reduce((a, b) => a + b, 0) / durations.length || 0,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      results: this.results as ConcurrentResult<T>[],
      raceConditions,
      timingAnalysis: {
        startTimes: this.results.map(r => r.startTime),
        endTimes: this.results.map(r => r.endTime),
        overlaps
      }
    };
  }

  /**
   * Detect potential race conditions
   */
  private detectRaceConditions(): RaceConditionCheck[] {
    const raceConditions: RaceConditionCheck[] = [];

    // Check for duplicate results (indicating non-unique operations)
    const results = this.results
      .filter(r => r.success)
      .map(r => JSON.stringify(r.result));
    
    const duplicates = results.filter((item, index) => results.indexOf(item) !== index);
    if (duplicates.length > 0) {
      raceConditions.push({
        type: 'duplicate',
        description: `Found ${duplicates.length} duplicate results, indicating potential race condition`,
        affectedOperations: this.results
          .filter(r => r.success && duplicates.includes(JSON.stringify(r.result)))
          .map(r => r.operationName),
        severity: 'high'
      });
    }

    // Check for inconsistent states
    const successCount = this.results.filter(r => r.success).length;
    const expectedSuccess = this.results.length;
    
    if (successCount !== expectedSuccess && successCount > 0) {
      raceConditions.push({
        type: 'inconsistent',
        description: `${this.results.length - successCount} operations failed while ${successCount} succeeded - possible inconsistent state`,
        affectedOperations: this.results
          .filter(r => !r.success)
          .map(r => r.operationName),
        severity: 'medium'
      });
    }

    // Check for lost updates (very fast consecutive operations)
    const fastOps = this.results.filter(r => r.duration < 10);
    if (fastOps.length > 1) {
      raceConditions.push({
        type: 'lost-update',
        description: `${fastOps.length} operations completed in less than 10ms, potential lost update scenario`,
        affectedOperations: fastOps.map(r => r.operationName),
        severity: 'medium'
      });
    }

    // Check for timing overlaps indicating contention
    const overlaps = this.calculateOverlaps();
    const significantOverlaps = overlaps.filter(o => o.overlap > 100);
    if (significantOverlaps.length > this.results.length / 2) {
      raceConditions.push({
        type: 'dirty-read',
        description: `High contention detected with ${significantOverlaps.length} significant operation overlaps`,
        affectedOperations: significantOverlaps.map(o => 
          `${this.results[o.op1].operationName} + ${this.results[o.op2].operationName}`
        ),
        severity: 'low'
      });
    }

    return raceConditions;
  }

  /**
   * Calculate timing overlaps between operations
   */
  private calculateOverlaps(): Array<{op1: number; op2: number; overlap: number}> {
    const overlaps: Array<{op1: number; op2: number; overlap: number}> = [];

    for (let i = 0; i < this.results.length; i++) {
      for (let j = i + 1; j < this.results.length; j++) {
        const op1 = this.results[i];
        const op2 = this.results[j];

        const overlapStart = Math.max(op1.startTime, op2.startTime);
        const overlapEnd = Math.min(op1.endTime, op2.endTime);
        const overlap = Math.max(0, overlapEnd - overlapStart);

        if (overlap > 0) {
          overlaps.push({ op1: i, op2: j, overlap });
        }
      }
    }

    return overlaps.sort((a, b) => b.overlap - a.overlap);
  }

  /**
   * Assert no race conditions detected
   */
  assertNoRaceConditions(report: ConcurrencyReport<unknown>): void {
    if (report.raceConditions.length > 0) {
      const critical = report.raceConditions.filter(r => r.severity === 'critical');
      const high = report.raceConditions.filter(r => r.severity === 'high');
      
      if (critical.length > 0 || high.length > 0) {
        throw new Error(
          `Race conditions detected:\n` +
          report.raceConditions
            .filter(r => r.severity === 'critical' || r.severity === 'high')
            .map(r => `  [${r.severity.toUpperCase()}] ${r.type}: ${r.description}`)
            .join('\n')
        );
      }
    }
  }

  /**
   * Assert all operations succeeded
   */
  assertAllSucceeded(report: ConcurrencyReport<unknown>): void {
    if (report.failed > 0) {
      const failures = this.results
        .filter(r => !r.success)
        .map(r => `  ${r.operationName}: ${r.error?.message}`);
      
      throw new Error(`Concurrent operations failed:\n${failures.join('\n')}`);
    }
  }

  /**
   * Assert operation count matches expected
   */
  assertOperationCount(report: ConcurrencyReport<unknown>, expected: number): void {
    if (report.totalOperations !== expected) {
      throw new Error(
        `Expected ${expected} operations but got ${report.totalOperations}`
      );
    }
  }

  /**
   * Assert maximum duration
   */
  assertMaxDuration(report: ConcurrencyReport<unknown>, maxMs: number): void {
    if (report.maxDuration > maxMs) {
      throw new Error(
        `Operation exceeded maximum duration. Max: ${report.maxDuration}ms, Allowed: ${maxMs}ms`
      );
    }
  }
}

/**
 * Singleton instance
 */
export const concurrencyRunner = new ConcurrencyRunner();

/**
 * Run operations concurrently (convenience function)
 */
export async function runConcurrent<T>(
  operations: ConcurrentOperation<T>[],
  options?: {
    maxConcurrency?: number;
    staggerDelay?: number;
    timeout?: number;
  }
): Promise<ConcurrencyReport<T>> {
  return concurrencyRunner.runConcurrent(operations, options);
}

/**
 * Run parallel operations (convenience function)
 */
export async function runParallel<T>(
  name: string,
  operation: () => Promise<T>,
  count: number,
  options?: {
    maxConcurrency?: number;
    staggerDelay?: number;
    timeout?: number;
  }
): Promise<ConcurrencyReport<T>> {
  return concurrencyRunner.runParallel(name, operation, count, options);
}

/**
 * Simulate race condition (convenience function)
 */
export async function simulateRaceCondition<T>(
  operations: ConcurrentOperation<T>[],
  options?: {
    delayBetweenMs?: number;
    timeout?: number;
  }
): Promise<ConcurrencyReport<T>> {
  return concurrencyRunner.simulateRaceCondition(operations, options);
}

/**
 * Test for idempotency by running the same operation multiple times
 */
export async function testIdempotency<T>(
  operation: () => Promise<T>,
  options: {
    times?: number;
    expectSameResult?: boolean;
  } = {}
): Promise<{isIdempotent: boolean; results: T[]; differences: string[]}> {
  const { times = 3, expectSameResult = true } = options;
  
  const results: T[] = [];
  for (let i = 0; i < times; i++) {
    results.push(await operation());
  }

  const differences: string[] = [];
  
  if (expectSameResult) {
    const firstResult = JSON.stringify(results[0]);
    for (let i = 1; i < results.length; i++) {
      if (JSON.stringify(results[i]) !== firstResult) {
        differences.push(`Result ${i} differs from result 0`);
      }
    }
  }

  return {
    isIdempotent: differences.length === 0,
    results,
    differences
  };
}