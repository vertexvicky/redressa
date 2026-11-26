import { Router } from 'express';
import { requestClosedEventSchema } from '@ai-call-engine/shared';
import { authMiddleware } from '../middleware/auth';
import { requestValidator } from '../middleware/request-validator';
import { handleRequestClosed, getEvent } from '../controllers/event.controller';

const router = Router();
router.post('/request-closed', authMiddleware, requestValidator(requestClosedEventSchema), handleRequestClosed);
router.get('/:id', authMiddleware, getEvent);
export default router;
