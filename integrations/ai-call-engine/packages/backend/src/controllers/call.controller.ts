import { Request, Response, NextFunction } from 'express';
import * as callService from '../services/call.service';

export async function startCall(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const call = await callService.manualCall(req.body);
    res.status(201).json({ success: true, data: call });
  } catch (err) {
    next(err);
  }
}

export async function getCall(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const call = callService.getCall(id);

    if (!call) {
      res.status(404).json({
        success: false,
        error: { code: 'CALL_NOT_FOUND', message: 'Call not found' },
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        id: call.id,
        eventId: call.eventId,
        requestId: call.requestId,
        maskedPhone: call.maskedPhone,
        status: call.status,
        duration: call.duration,
        outcome: call.outcome,
        startedAt: call.startedAt,
        endedAt: call.endedAt,
        createdAt: call.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function endCall(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    await callService.endCall(id);
    res.status(200).json({
      success: true,
      data: { message: 'Call end request sent' },
    });
  } catch (err) {
    next(err);
  }
}
