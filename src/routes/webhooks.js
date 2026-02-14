import { Router } from 'express';
import {
  handleWhatsAppWebhook,
  getWebhookData,
  clearWebhookData,
  verifyWebhook,
  triggerFlow,
  testWebhook,
} from '../controllers/webhookController.js';

const router = Router();

/**
 * Incoming Webhook for WhatsApp Cloud API
 * POST /api/webhooks/whatsapp
 */
router.post('/whatsapp', handleWhatsAppWebhook);

/**
 * Get stored webhook data from db.json
 * GET /api/webhooks/data
 */
router.get('/data', getWebhookData);

/**
 * Clear stored webhook data
 * DELETE /api/webhooks/data
 */
router.delete('/data', clearWebhookData);

/**
 * Webhook Verification (GET)
 * GET /api/webhooks/whatsapp
 */
router.get('/whatsapp', verifyWebhook);

/**
 * Direct Flow Trigger Webhook
 * POST /api/webhooks/trigger/:flowId
 */
router.post('/trigger/:flowId', triggerFlow);

/**
 * Test Webhook Endpoint
 * POST /api/webhooks/test
 */
router.post('/test', testWebhook);

export default router;
