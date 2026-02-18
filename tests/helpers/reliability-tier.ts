export function isTier3Enabled(): boolean {
  return process.env.TEST_TIER3 === '1';
}

export function getEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function nowMs(): number {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const bounded = Math.max(0, Math.min(1, quantile));
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * bounded));
  return sorted[index]!;
}

export function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return Number.POSITIVE_INFINITY;
  return numerator / denominator;
}
