import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { logger } from '../config/logger';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    logger.warn({ path: req.path, ip: req.ip }, 'Missing authorization header');
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authorization header is required' },
    });
    return;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    logger.warn({ path: req.path }, 'Malformed authorization header');
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authorization header must use Bearer scheme' },
    });
    return;
  }

  const token = parts[1];
  if (!token || token !== config.apiAuthToken) {
    logger.warn({ path: req.path }, 'Invalid authorization token');
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Invalid authorization token' },
    });
    return;
  }

  next();
}
