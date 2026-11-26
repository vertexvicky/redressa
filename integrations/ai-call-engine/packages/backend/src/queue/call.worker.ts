import { RequestClosedEvent, EventStatus } from '@ai-call-engine/shared';
import { callQueue } from './index';
import { initiateCall } from '../services/call.service';
import * as eventRepo from '../database/repositories/event.repository';
import { logger } from '../config/logger';

const log = logger.child({ worker: 'call' });

export function registerCallWorker(): void {
  callQueue.process(async (job) => {
    const { eventId, payload } = job.data as { eventId: string; payload: RequestClosedEvent };

    log.info({ jobId: job.id, eventId, requestId: payload.requestId }, 'Processing call job');

    try {
      eventRepo.updateEventStatus(eventId, EventStatus.PROCESSING);
      await initiateCall(eventId, payload);
      log.info({ jobId: job.id, eventId }, 'Call job processed successfully');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      log.error({ jobId: job.id, eventId, error: message }, 'Call job failed');
      eventRepo.updateEventStatus(eventId, EventStatus.FAILED, {
        failureReason: message,
        processedAt: new Date().toISOString(),
      });
      throw err; // Re-throw so the queue handles retry
    }
  });

  log.info('Call worker registered');
}
