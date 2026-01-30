import { z } from 'zod';

export const loginRequestBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const loginResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    message: z.string(),
  }),
});

export const loginErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.enum(['UNAUTHORIZED', 'VALIDATION_ERROR']),
    message: z.string(),
  }),
});

export const loginRouteSchema = {
  summary: 'Admin Login',
  description: 'Authenticate admin user and set JWT cookie',
  tags: ['Authentication'],
  body: loginRequestBodySchema,
  response: {
    200: loginResponseSchema,
    401: loginErrorSchema,
    422: loginErrorSchema,
  },
};
