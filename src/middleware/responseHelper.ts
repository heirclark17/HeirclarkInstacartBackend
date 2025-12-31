// src/middleware/responseHelper.ts
import { Response } from "express";

/**
 * Standardized API response format.
 * All endpoints should use these helpers for consistent responses.
 */

export interface ApiResponse<T = any> {
  ok: boolean;
  data?: T;
  error?: string;
  message?: string;
  pagination?: PaginationInfo;
  meta?: Record<string, any>;
}

export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Send a successful response.
 */
export function sendSuccess<T>(res: Response, data: T, statusCode: number = 200): Response {
  return res.status(statusCode).json({
    ok: true,
    data,
  } as ApiResponse<T>);
}

/**
 * Send a successful response with pagination.
 */
export function sendPaginated<T>(
  res: Response,
  items: T[],
  pagination: PaginationInfo,
  statusCode: number = 200
): Response {
  return res.status(statusCode).json({
    ok: true,
    data: items,
    pagination,
  } as ApiResponse<T[]>);
}

/**
 * Send an error response.
 */
export function sendError(
  res: Response,
  error: string,
  statusCode: number = 400,
  meta?: Record<string, any>
): Response {
  const response: ApiResponse = {
    ok: false,
    error,
  };

  if (meta) {
    response.meta = meta;
  }

  return res.status(statusCode).json(response);
}

/**
 * Send a not found response.
 */
export function sendNotFound(res: Response, message: string = "Resource not found"): Response {
  return sendError(res, message, 404);
}

/**
 * Send an unauthorized response.
 */
export function sendUnauthorized(res: Response, message: string = "Unauthorized"): Response {
  return sendError(res, message, 401);
}

/**
 * Send a forbidden response.
 */
export function sendForbidden(res: Response, message: string = "Forbidden"): Response {
  return sendError(res, message, 403);
}

/**
 * Send a validation error response.
 */
export function sendValidationError(res: Response, errors: string | string[]): Response {
  const errorMessage = Array.isArray(errors) ? errors.join(", ") : errors;
  return sendError(res, errorMessage, 400, { type: "validation" });
}

/**
 * Send a server error response.
 */
export function sendServerError(res: Response, message: string = "Internal server error"): Response {
  return sendError(res, message, 500);
}

/**
 * Calculate pagination info from query params.
 */
export function getPaginationParams(
  query: { page?: string; limit?: string },
  defaults: { page: number; limit: number; maxLimit: number } = { page: 1, limit: 20, maxLimit: 100 }
): { page: number; limit: number; offset: number } {
  const page = Math.max(1, parseInt(query.page || String(defaults.page), 10) || defaults.page);
  const limit = Math.min(
    defaults.maxLimit,
    Math.max(1, parseInt(query.limit || String(defaults.limit), 10) || defaults.limit)
  );
  const offset = (page - 1) * limit;

  return { page, limit, offset };
}

/**
 * Build pagination info object.
 */
export function buildPaginationInfo(
  page: number,
  limit: number,
  total: number
): PaginationInfo {
  const totalPages = Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

export default {
  sendSuccess,
  sendPaginated,
  sendError,
  sendNotFound,
  sendUnauthorized,
  sendForbidden,
  sendValidationError,
  sendServerError,
  getPaginationParams,
  buildPaginationInfo,
};
