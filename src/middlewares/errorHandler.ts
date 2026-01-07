import { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const message =
    err instanceof Error ? err.message : typeof err === 'string' ? err : 'Server error';
  console.error('❌ SERVER ERROR:', err);
  res.status(500).json({ error: true, message });
}
