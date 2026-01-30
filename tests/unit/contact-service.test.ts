import { describe, expect, it } from 'vitest';

import { ContactService } from '../../src/services/contact-service.js';

describe('ContactService', () => {
  it('validates input', async () => {
    const svc = new ContactService({ create: async () => ({ id: 'x' }) } as any);
    await expect(svc.create({ name: '', email: 'nope', message: '' })).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    });
  });

  it('creates contact request', async () => {
    const svc = new ContactService({ create: async () => ({ id: 'c1' }) } as any);
    const res = await svc.create({ name: 'A', email: 'a@b.com', message: 'hi' });
    expect(res).toEqual({ id: 'c1' });
  });
});
