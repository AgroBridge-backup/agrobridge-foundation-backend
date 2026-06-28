export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(opts: { statusCode: number; code: ErrorCode; message: string; details?: unknown }) {
    super(opts.message);
    this.statusCode = opts.statusCode;
    this.code = opts.code;
    this.details = opts.details;
  }
}

export const Errors = {
  validation: (details?: unknown) =>
    new AppError({ statusCode: 422, code: 'VALIDATION_ERROR', message: 'Invalid input', details }),
  unauthorized: () => new AppError({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Unauthorized' }),
  forbidden: () => new AppError({ statusCode: 403, code: 'FORBIDDEN', message: 'Forbidden' }),
  notFound: (message = 'Not found') =>
    new AppError({ statusCode: 404, code: 'NOT_FOUND', message }),
  conflict: (message = 'Conflict') => new AppError({ statusCode: 409, code: 'CONFLICT', message }),
  internal: () =>
    new AppError({ statusCode: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' }),
  serviceUnavailable: (message = 'Service unavailable') =>
    new AppError({ statusCode: 503, code: 'SERVICE_UNAVAILABLE', message }),
};
