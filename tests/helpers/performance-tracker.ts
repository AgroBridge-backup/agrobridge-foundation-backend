/**
 * Performance Tracker
 * Monitors and tracks test performance metrics
 * 
 * @author Alejandro Navarro Ayala - CEO & Founder, AgroBridge
 */

import { performance } from 'perf_hooks';
import * as os from 'os';

export interface PerformanceMetric {
  name: string;
  value: number;
  unit: 'ms' | 'bytes' | 'count' | 'percent';
  timestamp: number;
  tags?: Record<string, string>;
}

export interface TestPerformanceSnapshot {
  testName: string;
  startTime: number;
  endTime: number;
  duration: number;
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  cpu: {
    user: number;
    system: number;
  };
  metrics: PerformanceMetric[];
}

export interface PerformanceThresholds {
  maxDuration?: number;
  maxMemoryIncrease?: number;
  maxHeapUsed?: number;
  maxCpuPercent?: number;
}

export interface PerformanceViolation {
  metric: string;
  actual: number;
  threshold: number;
  severity: 'warning' | 'error';
}

/**
 * Performance Tracker class
 */
export class PerformanceTracker {
  private metrics: PerformanceMetric[] = [];
  private snapshots: TestPerformanceSnapshot[] = [];
  private currentTest: string | null = null;
  private testStartTime: number = 0;
  private initialMemory: NodeJS.MemoryUsage | null = null;
  private initialCpuUsage: NodeJS.CpuUsage | null = null;

  /**
   * Start tracking a test
   */
  startTest(testName: string): void {
    this.currentTest = testName;
    this.testStartTime = performance.now();
    this.initialMemory = process.memoryUsage();
    this.initialCpuUsage = process.cpuUsage();
    this.metrics = [];
  }

  /**
   * End tracking and generate snapshot
   */
  endTest(): TestPerformanceSnapshot {
    if (!this.currentTest) {
      throw new Error('No test currently running. Call startTest() first.');
    }

    const endTime = performance.now();
    const duration = endTime - this.testStartTime;
    const finalMemory = process.memoryUsage();
    const finalCpuUsage = process.cpuUsage(this.initialCpuUsage!);

    const snapshot: TestPerformanceSnapshot = {
      testName: this.currentTest,
      startTime: this.testStartTime,
      endTime,
      duration,
      memory: {
        heapUsed: finalMemory.heapUsed,
        heapTotal: finalMemory.heapTotal,
        external: finalMemory.external,
        rss: finalMemory.rss
      },
      cpu: {
        user: finalCpuUsage.user / 1000, // Convert to ms
        system: finalCpuUsage.system / 1000
      },
      metrics: [...this.metrics]
    };

    this.snapshots.push(snapshot);
    this.currentTest = null;
    
    return snapshot;
  }

  /**
   * Record a custom metric
   */
  recordMetric(
    name: string,
    value: number,
    unit: PerformanceMetric['unit'],
    tags?: Record<string, string>
  ): void {
    this.metrics.push({
      name,
      value,
      unit,
      timestamp: Date.now(),
      tags
    });
  }

  /**
   * Record timing for an operation
   */
  async timeOperation<T>(
    name: string,
    operation: () => Promise<T>,
    tags?: Record<string, string>
  ): Promise<T> {
    const start = performance.now();
    const result = await operation();
    const duration = performance.now() - start;

    this.recordMetric(name, duration, 'ms', tags);
    
    return result;
  }

  /**
   * Time a synchronous operation
   */
  timeSyncOperation<T>(
    name: string,
    operation: () => T,
    tags?: Record<string, string>
  ): T {
    const start = performance.now();
    const result = operation();
    const duration = performance.now() - start;

    this.recordMetric(name, duration, 'ms', tags);
    
    return result;
  }

  /**
   * Record memory usage
   */
  recordMemoryUsage(label: string = 'memory'): void {
    const usage = process.memoryUsage();
    
    this.recordMetric(`${label}-heap-used`, usage.heapUsed, 'bytes');
    this.recordMetric(`${label}-heap-total`, usage.heapTotal, 'bytes');
    this.recordMetric(`${label}-external`, usage.external, 'bytes');
    this.recordMetric(`${label}-rss`, usage.rss, 'bytes');
  }

  /**
   * Check performance against thresholds
   */
  checkThresholds(
    snapshot: TestPerformanceSnapshot,
    thresholds: PerformanceThresholds
  ): PerformanceViolation[] {
    const violations: PerformanceViolation[] = [];

    if (thresholds.maxDuration && snapshot.duration > thresholds.maxDuration) {
      violations.push({
        metric: 'duration',
        actual: snapshot.duration,
        threshold: thresholds.maxDuration,
        severity: 'error'
      });
    }

    if (thresholds.maxHeapUsed && snapshot.memory.heapUsed > thresholds.maxHeapUsed) {
      violations.push({
        metric: 'heap-used',
        actual: snapshot.memory.heapUsed,
        threshold: thresholds.maxHeapUsed,
        severity: 'warning'
      });
    }

    if (thresholds.maxMemoryIncrease && this.initialMemory) {
      const memoryIncrease = snapshot.memory.heapUsed - this.initialMemory.heapUsed;
      if (memoryIncrease > thresholds.maxMemoryIncrease) {
        violations.push({
          metric: 'memory-increase',
          actual: memoryIncrease,
          threshold: thresholds.maxMemoryIncrease,
          severity: 'warning'
        });
      }
    }

    if (thresholds.maxCpuPercent) {
      const totalCpu = snapshot.cpu.user + snapshot.cpu.system;
      const cpuPercent = (totalCpu / snapshot.duration) * 100;
      
      if (cpuPercent > thresholds.maxCpuPercent) {
        violations.push({
          metric: 'cpu-percent',
          actual: cpuPercent,
          threshold: thresholds.maxCpuPercent,
          severity: 'warning'
        });
      }
    }

    return violations;
  }

  /**
   * Assert performance thresholds
   */
  assertThresholds(
    snapshot: TestPerformanceSnapshot,
    thresholds: PerformanceThresholds
  ): void {
    const violations = this.checkThresholds(snapshot, thresholds);
    const errors = violations.filter(v => v.severity === 'error');

    if (errors.length > 0) {
      const messages = errors.map(v =>
        `  ${v.metric}: ${this.formatValue(v.actual, v.metric)} (max: ${this.formatValue(v.threshold, v.metric)})`
      );
      
      throw new Error(
        `Performance thresholds exceeded:\n${messages.join('\n')}`
      );
    }
  }

  /**
   * Generate performance report
   */
  generateReport(): {
    totalTests: number;
    averageDuration: number;
    totalMemoryUsed: number;
    slowestTest: string;
    fastestTest: string;
    recommendations: string[];
  } {
    if (this.snapshots.length === 0) {
      return {
        totalTests: 0,
        averageDuration: 0,
        totalMemoryUsed: 0,
        slowestTest: '',
        fastestTest: '',
        recommendations: []
      };
    }

    const durations = this.snapshots.map(s => s.duration);
    const totalMemory = this.snapshots.reduce((sum, s) => sum + s.memory.heapUsed, 0);
    
    const slowest = this.snapshots.reduce((max, s) => 
      s.duration > max.duration ? s : max
    );
    
    const fastest = this.snapshots.reduce((min, s) => 
      s.duration < min.duration ? s : min
    );

    const recommendations: string[] = [];
    
    if (slowest.duration > 5000) {
      recommendations.push(`Test '${slowest.testName}' is very slow (${slowest.duration.toFixed(2)}ms). Consider optimization.`);
    }
    
    const avgMemory = totalMemory / this.snapshots.length;
    if (avgMemory > 500 * 1024 * 1024) { // 500MB
      recommendations.push('High average memory usage detected. Check for memory leaks.');
    }

    return {
      totalTests: this.snapshots.length,
      averageDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      totalMemoryUsed: totalMemory,
      slowestTest: `${slowest.testName} (${slowest.duration.toFixed(2)}ms)`,
      fastestTest: `${fastest.testName} (${fastest.duration.toFixed(2)}ms)`,
      recommendations
    };
  }

  /**
   * Export metrics in Prometheus format
   */
  exportPrometheusMetrics(): string {
    const lines: string[] = [];
    
    this.snapshots.forEach((snapshot, index) => {
      const labels = `test="${snapshot.testName}",index="${index}"`;
      
      lines.push(`test_duration_ms{${labels}} ${snapshot.duration.toFixed(2)}`);
      lines.push(`test_memory_heap_used_bytes{${labels}} ${snapshot.memory.heapUsed}`);
      lines.push(`test_memory_heap_total_bytes{${labels}} ${snapshot.memory.heapTotal}`);
      lines.push(`test_cpu_user_ms{${labels}} ${snapshot.cpu.user.toFixed(2)}`);
      lines.push(`test_cpu_system_ms{${labels}} ${snapshot.cpu.system.toFixed(2)}`);
    });

    return lines.join('\n');
  }

  /**
   * Export metrics in JSON format
   */
  exportJSON(): string {
    return JSON.stringify({
      snapshots: this.snapshots,
      report: this.generateReport(),
      exportedAt: new Date().toISOString()
    }, null, 2);
  }

  /**
   * Clear all tracked data
   */
  clear(): void {
    this.metrics = [];
    this.snapshots = [];
    this.currentTest = null;
  }

  /**
   * Get all snapshots
   */
  getSnapshots(): TestPerformanceSnapshot[] {
    return [...this.snapshots];
  }

  /**
   * Get current system metrics
   */
  getSystemMetrics(): {
    loadAvg: number[];
    freeMem: number;
    totalMem: number;
    cpus: number;
  } {
    return {
      loadAvg: os.loadavg(),
      freeMem: os.freemem(),
      totalMem: os.totalmem(),
      cpus: os.cpus().length
    };
  }

  /**
   * Format value for display
   */
  private formatValue(value: number, metric: string): string {
    if (metric.includes('memory') || metric.includes('heap')) {
      return `${(value / 1024 / 1024).toFixed(2)} MB`;
    }
    if (metric.includes('duration') || metric.includes('time')) {
      return `${value.toFixed(2)} ms`;
    }
    if (metric.includes('percent')) {
      return `${value.toFixed(2)}%`;
    }
    return value.toString();
  }
}

/**
 * Singleton instance
 */
export const performanceTracker = new PerformanceTracker();

/**
 * Decorator for tracking test performance
 */
export function trackPerformance(
  thresholds?: PerformanceThresholds
): MethodDecorator {
  return function (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      performanceTracker.startTest(propertyKey.toString());
      
      try {
        const result = await originalMethod.apply(this, args);
        const snapshot = performanceTracker.endTest();
        
        if (thresholds) {
          performanceTracker.assertThresholds(snapshot, thresholds);
        }
        
        return result;
      } catch (error) {
        performanceTracker.endTest();
        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Helper to benchmark an operation
 */
export async function benchmark<T>(
  name: string,
  operation: () => Promise<T>,
  iterations: number = 100
): Promise<{
  name: string;
  iterations: number;
  totalTime: number;
  avgTime: number;
  minTime: number;
  maxTime: number;
  opsPerSecond: number;
}> {
  const times: number[] = [];

  // Warm up
  await operation();

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await operation();
    times.push(performance.now() - start);
  }

  const totalTime = times.reduce((a, b) => a + b, 0);
  
  return {
    name,
    iterations,
    totalTime,
    avgTime: totalTime / iterations,
    minTime: Math.min(...times),
    maxTime: Math.max(...times),
    opsPerSecond: (iterations / totalTime) * 1000
  };
}