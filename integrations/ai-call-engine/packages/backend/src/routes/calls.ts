import { Router } from 'express';
import { manualCallRequestSchema } from '@ai-call-engine/shared';
import { authMiddleware } from '../middleware/auth';
import { requestValidator } from '../middleware/request-validator';
import { startCall, getCall, endCall } from '../controllers/call.controller';

const router = Router();
router.post('/', authMiddleware, requestValidator(manualCallRequestSchema), startCall);
router.get('/:id', authMiddleware, getCall);
router.post('/:id/end', authMiddleware, endCall);
export default router;
