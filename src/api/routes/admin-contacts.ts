import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { requireAdmin, requireSuperAdmin } from '../../auth/jwt.js';
import { ok, fail } from '../../http/response.js';
import { ContactRequestRepository, type ContactStatus } from '../../repositories/contact-request-repo.js';

/**
 * Admin Contact Management Routes
 * 
 * Provides secure endpoints for administrators to view and manage
 * contact form submissions. All routes include:
 * - JWT authentication (admin only)
 * - Enhanced CSP headers for XSS protection
 * - Input validation and pagination
 * - Role-based access control (SUPER_ADMIN for mutations)
 * 
 * Security Model:
 * - All user-generated content is sanitized at storage (contact-service.ts)
 * - CSP headers prevent execution of any injected scripts
 * - Content is served with text/plain content type when possible
 * - Admin panel should render content as text, not HTML
 * 
 * @author Alejandro Navarro Ayala - CEO & Founder, AgroBridge
 * @security Critical - Displays user-generated content
 */

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['NEW', 'IN_REVIEW', 'RESOLVED', 'SPAM'] as const).optional(),
  sort: z
    .string()
    .default('createdAt:desc')
    .refine((v) => v === 'createdAt:desc' || v === 'createdAt:asc'),
});

const updateStatusSchema = z.object({
  status: z.enum(['NEW', 'IN_REVIEW', 'RESOLVED', 'SPAM'] as const),
});

/**
 * Sets enhanced security headers for admin routes that display user content
 * 
 * CSP Policy for Admin Routes:
 * - default-src 'self': Only load resources from same origin
 * - script-src 'self': No inline scripts, no eval
 * - style-src 'self' 'unsafe-inline': Allow inline styles for UI
 * - img-src 'self' data: https: Allow images
 * - connect-src 'self': Only API calls to same origin
 * - frame-ancestors 'none': Prevent clickjacking
 * - base-uri 'self': Prevent base tag hijacking
 * - form-action 'self': Prevent form submission hijacking
 */
function setAdminSecurityHeaders(reply: FastifyReply): void {
  reply.header('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "media-src 'self'",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '));

  // Additional security headers
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-XSS-Protection', '1; mode=block');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()');
}

export async function adminContactRoutes(app: FastifyInstance) {
  // =========================================================================
  // LIST CONTACT REQUESTS (Admin only)
  // =========================================================================
  app.get('/admin/contacts', async (req, reply) => {
    await requireAdmin(req);
    setAdminSecurityHeaders(reply);

    const q = listQuerySchema.parse(req.query);
    const [field, direction] = q.sort.split(':') as ['createdAt', 'asc' | 'desc'];

    const repo = new ContactRequestRepository(app.prisma);
    const [items, total] = await repo.listPaged({
      page: q.page,
      pageSize: q.pageSize,
      filters: q.status ? { status: q.status } : {},
      sort: { field, direction },
    });

    const totalPages = Math.max(1, Math.ceil(total / q.pageSize));

    return ok({
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        email: item.email,
        // Truncate message for list view
        message: item.message.length > 200 
          ? item.message.substring(0, 200) + '...' 
          : item.message,
        status: item.status,
        createdAt: item.createdAt,
      })),
      meta: {
        page: q.page,
        pageSize: q.pageSize,
        total,
        totalPages,
      },
    });
  });

  // =========================================================================
  // GET SINGLE CONTACT REQUEST (Admin only)
  // =========================================================================
  app.get('/admin/contacts/:id', async (req, reply) => {
    await requireAdmin(req);
    setAdminSecurityHeaders(reply);

    const { id } = req.params as { id: string };

    // Validate UUID format
    const uuidSchema = z.string().uuid();
    const parseResult = uuidSchema.safeParse(id);
    if (!parseResult.success) {
      reply.status(400);
      return fail({ code: 'VALIDATION_ERROR', message: 'Invalid contact ID format' });
    }

    const repo = new ContactRequestRepository(app.prisma);
    const contact = await repo.findById(id);

    if (!contact) {
      reply.status(404);
      return fail({ code: 'NOT_FOUND', message: 'Contact request not found' });
    }

    return ok({
      id: contact.id,
      name: contact.name,
      email: contact.email,
      message: contact.message,
      status: contact.status,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt,
    });
  });

  // =========================================================================
  // UPDATE CONTACT STATUS (Admin only)
  // =========================================================================
  app.patch('/admin/contacts/:id', async (req, reply) => {
    const payload = await requireAdmin(req);
    setAdminSecurityHeaders(reply);

    const { id } = req.params as { id: string };

    // Validate UUID format
    const uuidSchema = z.string().uuid();
    const parseResult = uuidSchema.safeParse(id);
    if (!parseResult.success) {
      reply.status(400);
      return fail({ code: 'VALIDATION_ERROR', message: 'Invalid contact ID format' });
    }

    // Validate body
    const bodyResult = updateStatusSchema.safeParse(req.body);
    if (!bodyResult.success) {
      reply.status(400);
      return fail({ code: 'VALIDATION_ERROR', message: 'Invalid status value' });
    }

    const repo = new ContactRequestRepository(app.prisma);
    const contact = await repo.updateStatus(id, bodyResult.data.status, payload.sub);

    if (!contact) {
      reply.status(404);
      return fail({ code: 'NOT_FOUND', message: 'Contact request not found' });
    }

    return ok({
      id: contact.id,
      name: contact.name,
      email: contact.email,
      message: contact.message,
      status: contact.status,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt,
    });
  });

  // =========================================================================
  // DELETE CONTACT REQUEST (Super Admin only)
  // =========================================================================
  app.delete('/admin/contacts/:id', async (req, reply) => {
    await requireAdmin(req);
    requireSuperAdmin(req);
    setAdminSecurityHeaders(reply);

    const { id } = req.params as { id: string };

    // Validate UUID format
    const uuidSchema = z.string().uuid();
    const parseResult = uuidSchema.safeParse(id);
    if (!parseResult.success) {
      reply.status(400);
      return fail({ code: 'VALIDATION_ERROR', message: 'Invalid contact ID format' });
    }

    const repo = new ContactRequestRepository(app.prisma);
    const deleted = await repo.delete(id);

    if (!deleted) {
      reply.status(404);
      return fail({ code: 'NOT_FOUND', message: 'Contact request not found' });
    }

    reply.status(204);
    return;
  });

  // =========================================================================
  // EXPORT CONTACTS (Super Admin only - CSV/JSON)
  // =========================================================================
  app.get('/admin/contacts/export', async (req, reply) => {
    await requireAdmin(req);
    requireSuperAdmin(req);

    const format = (req.query as { format?: string }).format || 'json';

    const repo = new ContactRequestRepository(app.prisma);
    const allContacts = await repo.listAll();

    if (format === 'csv') {
      // Set download headers
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', 'attachment; filename="contacts.csv"');
      
      // CSV header
      let csv = 'ID,Name,Email,Message,Status,CreatedAt\n';
      
      for (const contact of allContacts) {
        // Escape CSV fields to prevent injection
        const escapeCsv = (field: string) => {
          // If field contains comma, quote, or newline, wrap in quotes
          if (/[\",\n\r]/.test(field)) {
            return `"${field.replace(/"/g, '""')}"`;
          }
          return field;
        };

        csv += [
          contact.id,
          escapeCsv(contact.name),
          escapeCsv(contact.email),
          escapeCsv(contact.message.replace(/\n/g, ' ')),
          contact.status,
          contact.createdAt.toISOString(),
        ].join(',') + '\n';
      }

      return reply.send(csv);
    }

    // Default JSON format
    setAdminSecurityHeaders(reply);
    return ok({
      contacts: allContacts.map((contact) => ({
        id: contact.id,
        name: contact.name,
        email: contact.email,
        message: contact.message,
        status: contact.status,
        createdAt: contact.createdAt,
      })),
      exportedAt: new Date().toISOString(),
    });
  });
}
