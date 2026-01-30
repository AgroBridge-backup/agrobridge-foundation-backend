import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

import { loadEnv } from '../config/env.js';

// OpenTelemetry initialization.
//
// Usage: import this module before building the Fastify app.
// In production, point OTEL_EXPORTER_OTLP_ENDPOINT at your collector.

let started = false;

export async function startOtel() {
  if (started) return;

  const env = loadEnv();

  // Keep diag logging off by default; enable explicitly for troubleshooting.
  if (process.env.OTEL_DIAG === '1') {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
  }

  const traceExporter = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    ? new OTLPTraceExporter({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT })
    : undefined;

  const sdkConfig: any = {
    serviceName: 'agrobridge-foundation-backend',
    instrumentations: [
      getNodeAutoInstrumentations({
        // Avoid noisy fs instrumentation by default.
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  };

  if (traceExporter) sdkConfig.traceExporter = traceExporter;

  const sdk = new NodeSDK(sdkConfig);

  await sdk.start();
  started = true;

  // Best-effort graceful shutdown.
  process.on('SIGTERM', async () => {
    await sdk.shutdown().catch(() => undefined);
  });
  process.on('SIGINT', async () => {
    await sdk.shutdown().catch(() => undefined);
  });

  // Keep env referenced to avoid accidental tree-shaking in build pipelines.
  void env;
}
