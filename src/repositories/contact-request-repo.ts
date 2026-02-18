import type { PrismaClient, ContactRequest, ContactRequestStatus } from '@prisma/client';

import { withDbSpan } from '../observability/db-span.js';

/**
 * Contact Request Repository
 * 
 * Handles database operations for contact form submissions.
 * All data is expected to be pre-sanitized by ContactService.
 * 
 * @author Alejandro Navarro Ayala - CEO & Founder, AgroBridge
 * @security Data must be sanitized before reaching this layer
 */

export type ContactStatus = ContactRequestStatus;

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

  async findById(id: string): Promise<ContactRequest | null> {
    return withDbSpan({
      name: 'db.contact_request.findById',
      model: 'ContactRequest',
      operation: 'findUnique',
      fn: async () =>
        this.prisma.contactRequest.findUnique({
          where: { id },
        }),
    });
  }

  async listPaged(options: {
    page: number;
    pageSize: number;
    filters?: { status?: ContactRequestStatus };
    sort?: { field: 'createdAt'; direction: 'asc' | 'desc' };
  }): Promise<[ContactRequest[], number]> {
    const { page, pageSize, filters = {}, sort = { field: 'createdAt', direction: 'desc' } } = options;
    const skip = (page - 1) * pageSize;

    return withDbSpan({
      name: 'db.contact_request.listPaged',
      model: 'ContactRequest',
      operation: 'findMany',
      fn: async () => {
        const [items, total] = await Promise.all([
          this.prisma.contactRequest.findMany({
            where: filters,
            orderBy: { [sort.field]: sort.direction },
            skip,
            take: pageSize,
          }),
          this.prisma.contactRequest.count({ where: filters }),
        ]);
        return [items, total];
      },
    });
  }

  async listAll(): Promise<ContactRequest[]> {
    return withDbSpan({
      name: 'db.contact_request.listAll',
      model: 'ContactRequest',
      operation: 'findMany',
      fn: async () =>
        this.prisma.contactRequest.findMany({
          orderBy: { createdAt: 'desc' },
        }),
    });
  }

  async updateStatus(id: string, status: ContactRequestStatus, _updatedBy: string): Promise<ContactRequest | null> {
    return withDbSpan({
      name: 'db.contact_request.updateStatus',
      model: 'ContactRequest',
      operation: 'update',
      fn: async () => {
        try {
          return await this.prisma.contactRequest.update({
            where: { id },
            data: { 
              status,
              updatedAt: new Date(),
            },
          });
        } catch (err) {
          // Record not found
          return null;
        }
      },
    });
  }

  async delete(id: string): Promise<boolean> {
    return withDbSpan({
      name: 'db.contact_request.delete',
      model: 'ContactRequest',
      operation: 'delete',
      fn: async () => {
        try {
          await this.prisma.contactRequest.delete({
            where: { id },
          });
          return true;
        } catch (err) {
          // Record not found
          return false;
        }
      },
    });
  }
}
