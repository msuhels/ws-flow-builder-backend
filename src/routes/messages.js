import { Router } from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { sendMessage } from '../controllers/messageController.js';

const router = Router();

/**
 * Send Message (Manual or Test)
 * POST /api/messages/send
 */
router.post('/send', protect, sendMessage);

export default router;
