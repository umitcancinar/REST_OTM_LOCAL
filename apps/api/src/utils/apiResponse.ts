// ==========================================
// Standardized API Response Helper
// ==========================================

import { Response } from 'express';

interface ApiResponseOptions<T> {
  res: Response;
  statusCode?: number;
  success?: boolean;
  message?: string;
  data?: T;
  meta?: Record<string, unknown>;
}

export function apiResponse<T>({
  res,
  statusCode = 200,
  success = true,
  message = 'Success',
  data,
  meta,
}: ApiResponseOptions<T>): Response {
  return res.status(statusCode).json({
    success,
    message,
    data,
    meta,
    timestamp: new Date().toISOString(),
  });
}

export function apiError(
  res: Response,
  statusCode: number,
  message: string,
  errors?: unknown,
): Response {
  return res.status(statusCode).json({
    success: false,
    message,
    errors,
    timestamp: new Date().toISOString(),
  });
}

/** Paginated response helper */
export function paginatedResponse<T>(
  res: Response,
  data: T[],
  total: number,
  page: number,
  limit: number,
): Response {
  return apiResponse({
    res,
    data,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
    },
  });
}
