// src/middleware/asyncHandler.ts
import { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Wraps async route handlers to properly catch errors and pass them to Express error handler.
 * This prevents unhandled promise rejections and ensures consistent error handling.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export default asyncHandler;
