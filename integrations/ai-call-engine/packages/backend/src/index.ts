import express, { Express, Request, Response } from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import { logger } from './config/logger';
import { initDb, closeDb } from './database';
import { callQueue } from './queue';
import { registerCallWorker } from './queue/call.worker';
import { rateLimiter } from './middleware/rate-limit';
import { errorHandler } from './middleware/error-handler';
import eventsRouter from './routes/events';
import callsRouter from './routes/calls';
import webhooksRouter from './routes/webhooks';

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '10kb' }));

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      success: true,
      data: {
        status: 'ok',
        provider: config.voiceProvider,
        demoMode: config.demoMode,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      },
    });
  });

  app.use('/api', rateLimiter);
  app.use('/api/events', eventsRouter);
  app.use('/api/calls', callsRouter);
  app.use('/api/webhooks', webhooksRouter);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    });
  });

  app.use(errorHandler);

  return app;
}

export async function startServer(port: number = config.port): Promise<http.Server> {
  await initDb();
  registerCallWorker();
  callQueue.start();

  const app = createApp();
  const server = app.listen(port, () => {
    logger.info(
      {
        port,
        env: config.nodeEnv,
        provider: config.voiceProvider,
        demoMode: config.demoMode,
      },
      'AI Call Engine server started',
    );
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received — closing server gracefully');
    callQueue.stop();
    server.close(() => {
      closeDb();
      logger.info('Server closed cleanly');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

if (require.main === module) {
  startServer();
}
