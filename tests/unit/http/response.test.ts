import { describe, it, expect } from 'vitest';
import { Errors } from '../../src/errors/app-error.js';
import { ok, fail } from '../../src/http/response.js';

describe('HTTP Response Helpers', () => {
  describe('ok', () => {
    it('should create success response', () => {
      const data = { message: 'Success' };
      const response = ok(data);

      expect(response).toEqual({
        ok: true,
        data: { message: 'Success' },
      });
    });

    it('should handle null data', () => {
      const response = ok(null);

      expect(response).toEqual({
        ok: true,
        data: null,
      });
    });

    it('should handle complex nested data', () => {
      const data = {
        items: [{ id: 1 }, { id: 2 }],
        meta: { total: 2, page: 1 },
      };
      const response = ok(data);

      expect(response).toEqual({
        ok: true,
        data,
      });
    });

    it('should handle array data', () => {
      const data = [1, 2, 3];
      const response = ok(data);

      expect(response).toEqual({
        ok: true,
        data: [1, 2, 3],
      });
    });
  });

  describe('fail', () => {
    it('should create error response', () => {
      const error = {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
      };
      const response = fail(error);

      expect(response).toEqual({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input' },
      });
    });

    it('should handle error with details', () => {
      const error = {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        details: {
          fields: ['email', 'password'],
        },
      };
      const response = fail(error);

      expect(response).toEqual({
        ok: false,
        error,
      });
    });

    it('should handle error with empty details', () => {
      const error = {
        code: 'UNAUTHORIZED',
        message: 'Not authorized',
        details: {},
      };
      const response = fail(error);

      expect(response).toEqual({
        ok: false,
        error,
      });
    });
  });
});
