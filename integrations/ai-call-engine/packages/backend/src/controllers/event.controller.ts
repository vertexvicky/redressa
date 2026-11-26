import { Request, Response, NextFunction } from 'express';
import { RequestClosedEvent } from '@ai-call-engine/shared';
import { processRequestClosedEvent, getEventStatus } from '../services/event.service';

export async function handleRequestClosed(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const payload = req.body as RequestClosedEvent;
    const result = processRequestClosedEvent(payload);

    res.status(202).json({
      success: true,
      data: result,
    });
  } catch (err: unknown) {
    next(err);
  }
}

export async function getEvent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const event = getEventStatus(id);

    if (!event) {
      res.status(404).json({
        success: false,
        error: { code: 'EVENT_NOT_FOUND', message: 'Event not found' },
      });
      return;
    }

    res.status(200).json({ success: true, data: event });
  } catch (err) {
    next(err);
  }
}
