import { Request, Response, NextFunction } from 'express';
import { updateCallFromWebhook } from '../services/call.service';
import { getVoiceProvider } from '../providers/provider.factory';
import { logger } from '../config/logger';
import { config } from '../config';

export async function handleVoiceWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const provider = getVoiceProvider();

    if (config.voiceProvider !== 'mock') {
      const signature = (req.headers['x-vapi-signature'] as string) || '';
      const isValid = provider.validateWebhook(req.body, signature, config.vapi.webhookSecret);

      if (!isValid) {
        logger.warn('Invalid webhook signature');
        res.status(401).json({
          success: false,
          error: { code: 'INVALID_WEBHOOK_SIGNATURE', message: 'Webhook signature verification failed' },
        });
        return;
      }
    }

    const update = await provider.handleWebhook(req.body, req.headers as Record<string, string>);
    updateCallFromWebhook(update);

    res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
}
