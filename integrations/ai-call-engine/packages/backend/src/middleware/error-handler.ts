import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../config/logger';
import { config } from '../config';

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  logger.error({ err: err.message, stack: err.stack, path: req.path, method: req.method }, 'Unhandled error');

  if (err instanceof ZodError || err.name === 'ZodError') {
    const zodErr = err as ZodError;
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: zodErr.errors?.map(e => ({ path: e.path.join('.'), message: e.message })),
      },
    });
    return;
  }

  const statusCode = (err as any).statusCode || 500;
  const isProduction = config.nodeEnv === 'production';

  res.status(statusCode).json({
    success: false,
    error: {
      code: (err as any).code || 'INTERNAL_ERROR',
      message: isProduction ? 'An internal error occurred' : err.message,
    },
  });
}
