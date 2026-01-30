import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAdmin } from '../../auth/jwt.js';
import { ok } from '../../http/response.js';
import { DonationRepository } from '../../repositories/donation-repo.js';
import { AdminDashboardService } from '../../services/admin-dashboard-service.js';
import type { DonationStatus } from '../../api/schemas/admin.schema.js';

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z
    .enum(['PENDING', 'SUCCEEDED', 'EXPIRED'])
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? undefined : v)),
  sort: z
    .string()
    .default('createdAt:desc')
    .refine((v) => v === 'createdAt:desc' || v === 'createdAt:asc'),
  cursor: z.string().optional(),
  mode: z.enum(['offset', 'cursor']).default('offset'),
});

function getAdminDashboardService(app: FastifyInstance): AdminDashboardService {
  const key = Symbol.for('agrobridge.adminDashboardService');
  const store = app as unknown as { [key: symbol]: AdminDashboardService | undefined };
  const existing = store[key];
  if (existing) return existing;

  const repo = new DonationRepository(app.prisma);
  const svc = new AdminDashboardService(repo);
  store[key] = svc;
  return svc;
}

export async function adminRoutes(app: FastifyInstance) {
  app.get('/admin/donations', async (req) => {
    await requireAdmin(req);

    const q = listQuerySchema.parse(req.query);
    const [field, direction] = q.sort.split(':') as ['createdAt', 'asc' | 'desc'];
    const status: DonationStatus | undefined = q.status;

    const repo = new DonationRepository(app.prisma);
    // Offset pagination kept for compatibility.
    if (q.mode === 'offset') {
      const [items, total] = await repo.listPaged({
        page: q.page,
        pageSize: q.pageSize,
        filters: status ? { status } : {},
        sort: { field, direction },
      });

      const totalPages = Math.max(1, Math.ceil(total / q.pageSize));

      return ok({
        items,
        meta: {
          mode: 'offset',
          page: q.page,
          pageSize: q.pageSize,
          total,
          totalPages,
        },
      });
    }

    // Cursor pagination (recommended at scale).
    const { decodeCursor, encodeCursor } = await import('../../utils/cursor.js');

    if (q.cursor && direction === 'asc') {
      // Cursor pagination is supported for both directions, but default sort is desc.
      // Keep this explicit to avoid accidental API misuse.
    }

    const cursorVal = q.cursor ? decodeCursor(q.cursor) : undefined;
    const payload: {
      pageSize: number;
      filters: { status?: 'PENDING' | 'SUCCEEDED' | 'EXPIRED' };
      direction: 'asc' | 'desc';
      cursor?: { createdAt: Date; id: string };
    } = {
      pageSize: q.pageSize,
      filters: status ? { status } : {},
      direction,
    };

    if (cursorVal) payload.cursor = cursorVal;

    const result = await repo.listCursor(payload);

    return ok({
      items: result.items,
      meta: {
        mode: 'cursor',
        pageSize: q.pageSize,
        nextCursor: result.nextCursor ? encodeCursor(result.nextCursor) : null,
      },
    });
  });

  app.get('/admin/dashboard', async (req) => {
    await requireAdmin(req);

    const svc = getAdminDashboardService(app);

    const metrics = await svc.getMetrics({ ttlMs: 15_000 });

    return ok(metrics);
  });
}
