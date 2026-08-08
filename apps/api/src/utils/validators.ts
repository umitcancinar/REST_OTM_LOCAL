// ==========================================
// Zod Validation Helpers
// ==========================================

import { z } from 'zod';

/** Reusable pagination query schema */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

/** CUID ID param validator */
export const idParamSchema = z.object({
  id: z.string().min(1, 'ID is required'),
});

/** Common string validators */
export const validators = {
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  pin: z.string().length(4, 'PIN must be exactly 4 digits').regex(/^\d+$/, 'PIN must be numeric'),
  phone: z.string().regex(/^[\d\s\-+()]+$/, 'Invalid phone number').optional(),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens'),
  positiveNumber: z.number().positive(),
  nonNegativeNumber: z.number().min(0),
};

export type PaginationQuery = z.infer<typeof paginationSchema>;
