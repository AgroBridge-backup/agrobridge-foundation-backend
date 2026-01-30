import { describe, it, expect } from 'vitest';
import { Errors } from '../../src/errors/app-error.js';
import { buildLoggerOptions } from '../../src/config/logger.js';

describe('buildLoggerOptions', () => {
  it('should use info level for production', () => {
    const options = buildLoggerOptions('production');

    expect(options.level).toBe('info');
  });

  it('should use debug level for development', () => {
    const options = buildLoggerOptions('development');

    expect(options.level).toBe('debug');
  });

  it('should use debug level for test', () => {
    const options = buildLoggerOptions('test');

    expect(options.level).toBe('debug');
  });

  it('should configure redaction paths', () => {
    const options = buildLoggerOptions('production');

    expect(options.redact).toBeDefined();
    expect(options.redact?.paths).toEqual([
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'password',
      '*.password',
      '*.passwordHash',
    ]);
    expect(options.redact?.remove).toBe(true);
  });
});
