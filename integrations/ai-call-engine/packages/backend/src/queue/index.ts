import { v4 as uuid } from 'uuid';
import { logger } from '../config/logger';
import { config } from '../config';

export interface QueueJob {
  id: string;
  type: string;
  data: Record<string, unknown>;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'dead';
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  processedAt?: string;
  error?: string;
}

type JobProcessor = (job: QueueJob) => Promise<void>;

class JobQueue {
  private jobs: Map<string, QueueJob> = new Map();
  private processor: JobProcessor | null = null;
  private running = false;
  private processing = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  add(params: { type: string; data: Record<string, unknown>; maxAttempts?: number }): string {
    const id = uuid();
    const job: QueueJob = {
      id,
      type: params.type,
      data: params.data,
      status: 'pending',
      attempts: 0,
      maxAttempts: params.maxAttempts ?? config.maxRetryAttempts,
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(id, job);
    logger.info({ jobId: id, type: params.type }, 'Job added to queue');

    // Process immediately if running
    if (this.running && !this.processing) {
      this.processNext();
    }

    return id;
  }

  process(handler: JobProcessor): void {
    this.processor = handler;
  }

  private async processNext(): Promise<void> {
    if (this.processing || !this.processor) return;

    const pendingJob = Array.from(this.jobs.values()).find(j => j.status === 'pending');
    if (!pendingJob) return;

    this.processing = true;
    pendingJob.status = 'processing';
    pendingJob.attempts += 1;
    pendingJob.processedAt = new Date().toISOString();

    try {
      await this.processor(pendingJob);
      pendingJob.status = 'completed';
      logger.info({ jobId: pendingJob.id }, 'Job completed');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      pendingJob.error = message;

      if (pendingJob.attempts >= pendingJob.maxAttempts) {
        pendingJob.status = 'dead';
        logger.error({ jobId: pendingJob.id, attempts: pendingJob.attempts }, 'Job moved to dead letter');
      } else {
        // Exponential backoff retry
        const delay = config.retryDelayBaseMs * Math.pow(2, pendingJob.attempts - 1);
        pendingJob.status = 'pending';
        logger.warn({ jobId: pendingJob.id, attempts: pendingJob.attempts, retryIn: delay }, 'Job will retry');
        setTimeout(() => {
          if (this.running) this.processNext();
        }, delay);
      }
    } finally {
      this.processing = false;
      // Check for more jobs
      if (this.running) {
        setTimeout(() => this.processNext(), 100);
      }
    }
  }

  start(): void {
    this.running = true;
    logger.info('Job queue started');
    this.processNext();

    // Poll for pending jobs periodically
    this.timer = setInterval(() => {
      if (this.running && !this.processing) this.processNext();
    }, 2000);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('Job queue stopped');
  }

  getJob(id: string): QueueJob | null {
    return this.jobs.get(id) ?? null;
  }

  getStats(): { pending: number; processing: number; completed: number; failed: number; dead: number } {
    const stats = { pending: 0, processing: 0, completed: 0, failed: 0, dead: 0 };
    for (const job of this.jobs.values()) {
      stats[job.status as keyof typeof stats]++;
    }
    return stats;
  }

  /** For testing: clear all jobs */
  clear(): void {
    this.jobs.clear();
  }
}

export const callQueue = new JobQueue();
