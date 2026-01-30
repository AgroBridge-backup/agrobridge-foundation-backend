import { describe, it, expect } from 'vitest';
import { Errors } from '../../src/errors/app-error.js';
import { encodeCursor, decodeCursor } from '../../src/utils/cursor.js';

describe('Cursor Utils', () => {
  const testCursor = {
    createdAt: new Date('2024-01-01T00:00:00Z'),
    id: '123e4567-e89b-12d3-a456-426614174000',
  };

  describe('encodeCursor', () => {
    it('should encode cursor to base64url string', () => {
      const encoded = encodeCursor(testCursor);

      expect(typeof encoded).toBe('string');
      expect(encoded.length).toBeGreaterThan(0);
    });

    it('should handle special characters in ID', () => {
      const cursorWithSpecialChars = {
        createdAt: new Date('2024-01-01T00:00:00Z'),
        id: '123e4567-e89b-12d3-a456-426614174000!@#$%^&*()',
      };

      const encoded = encodeCursor(cursorWithSpecialChars);
      const decoded = decodeCursor(encoded);

      expect(decoded.id).toBe(cursorWithSpecialChars.id);
      expect(decoded.createdAt.toISOString()).toBe(cursorWithSpecialChars.createdAt.toISOString());
    });

    it('should handle Unicode in ID', () => {
      const cursorWithUnicode = {
        createdAt: new Date('2024-01-01T00:00:00Z'),
        id: '123e4567-🎉-test-unicode-中文',
      };

      const encoded = encodeCursor(cursorWithUnicode);
      const decoded = decodeCursor(encoded);

      expect(decoded.id).toBe(cursorWithUnicode.id);
    });
  });

  describe('decodeCursor', () => {
    it('should decode cursor from base64url string', () => {
      const encoded = encodeCursor(testCursor);
      const decoded = decodeCursor(encoded);

      expect(decoded.id).toBe(testCursor.id);
      expect(decoded.createdAt).toEqual(testCursor.createdAt);
    });

    it('should handle malformed cursor', () => {
      expect(() => decodeCursor('invalid-cursor')).toThrow();
    });

    it('should handle invalid base64url', () => {
      expect(() => decodeCursor('!!!invalid!!!')).toThrow();
    });

    it('should handle invalid JSON', () => {
      const invalidBase64 = Buffer.from('not valid json', 'utf8').toString('base64url');
      expect(() => decodeCursor(invalidBase64)).toThrow();
    });

    it('should handle invalid date format', () => {
      const invalidDateCursor = Buffer.from(
        JSON.stringify({ createdAt: 'invalid-date', id: '123' }),
        'utf8',
      ).toString('base64url');

      expect(() => decodeCursor(invalidDateCursor)).toThrow();
    });

    it('should handle large timestamp values', () => {
      const futureCursor = {
        createdAt: new Date('2099-12-31T23:59:59Z'),
        id: '123e4567-e89b-12d3-a456-426614174000',
      };

      const encoded = encodeCursor(futureCursor);
      const decoded = decodeCursor(encoded);

      expect(decoded.createdAt).toEqual(futureCursor.createdAt);
    });
  });

  describe('roundtrip', () => {
    it('should encode and decode successfully', () => {
      const encoded = encodeCursor(testCursor);
      const decoded = decodeCursor(encoded);

      expect(decoded.id).toBe(testCursor.id);
      expect(decoded.createdAt).toEqual(testCursor.createdAt);
    });

    it('should handle multiple roundtrips', () => {
      let cursor = testCursor;
      for (let i = 0; i < 10; i++) {
        const encoded = encodeCursor(cursor);
        cursor = decodeCursor(encoded);
      }

      expect(cursor.id).toBe(testCursor.id);
      expect(cursor.createdAt).toEqual(testCursor.createdAt);
    });
  });
});
