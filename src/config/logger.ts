import type { LoggerOptions } from 'pino';

export function buildLoggerOptions(nodeEnv: string): LoggerOptions {
  return {
    level: nodeEnv === 'production' ? 'info' : 'debug',
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        'password',
        '*.password',
        '*.passwordHash',
      ],
      remove: true,
    },
  };
}
