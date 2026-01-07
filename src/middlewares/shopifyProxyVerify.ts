// ...existing code...
/* eslint-disable @typescript-eslint/no-unused-vars */
import type { Request, Response, NextFunction } from 'express';

// keep params typed so TS/ESLint can validate them; prefix unused params with _
function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const e = err as { status?: number; message?: string; stack?: string };
  console.error('❌ SERVER ERROR:', e.stack ?? e);
  const status = e.status ?? 500;
  res.status(status).json({
    error: true,
    message: e.message ?? 'Something went wrong on the server.',
  });
}

module.exports = { errorHandler };
// ...existing code...
