import express from 'express';
import { 
  getConversations, 
  getConversationMessages, 
  sendConversationMessage 
} from '../controllers/conversationController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// Get all conversations
router.get('/', getConversations);

// Get messages for specific phone number
router.get('/:phoneNumber', getConversationMessages);

// Send message from conversation chat
router.post('/send', sendConversationMessage);

export default router;
