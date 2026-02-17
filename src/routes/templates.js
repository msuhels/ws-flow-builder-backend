import express from 'express';
import {
  getTemplates,
  createTemplate,
  submitTemplateToMeta,
  syncTemplateStatus,
  deleteTemplate,
} from '../controllers/templateController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// Get all templates
router.get('/', getTemplates);

// Create new template
router.post('/', createTemplate);

// Submit template to Meta for approval
router.post('/:id/submit', submitTemplateToMeta);

// Sync template status from Meta
router.get('/:id/sync', syncTemplateStatus);

// Delete template
router.delete('/:id', deleteTemplate);

export default router;
