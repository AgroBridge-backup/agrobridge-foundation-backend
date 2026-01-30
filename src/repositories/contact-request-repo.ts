import type { PrismaClient } from '@prisma/client';

import { withDbSpan } from '../observability/db-span.js';

export class ContactRequestRepository {
  constructor(private readonly prisma: PrismaClient) {}

  create(input: { name: string; email: string; message: string }) {
    return withDbSpan({
      name: 'db.contact_request.create',
      model: 'ContactRequest',
      operation: 'create',
      fn: async () =>
        this.prisma.contactRequest.create({
          data: {
            name: input.name,
            email: input.email,
            message: input.message,
            status: 'NEW',
          },
        }),
    });
  }
}
