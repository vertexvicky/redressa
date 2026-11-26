import { Router } from 'express';
import { handleVoiceWebhook } from '../controllers/webhook.controller';

const router = Router();
router.post('/voice', handleVoiceWebhook);
export default router;
