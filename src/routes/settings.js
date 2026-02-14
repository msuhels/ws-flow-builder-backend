import { Router } from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  getApiConfig,
  updateApiConfig,
  testConnection,
} from '../controllers/settingsController.js';

const router = Router();

/**
 * Get API Configuration
 * GET /api/settings
 */
router.get('/', protect, getApiConfig);

/**
 * Update API Configuration
 * POST /api/settings
 */
router.post('/', protect, updateApiConfig);

/**
 * Test Connection
 * POST /api/settings/test
 */
router.post('/test', protect, testConnection);

export default router;
