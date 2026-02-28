import express from 'express';
import {
  getTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
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

// Get single template by ID
router.get('/:id', getTemplateById);

// Create new template
router.post('/', createTemplate);

// Update template (only DRAFT)
router.put('/:id', updateTemplate);

// Submit template to Meta for approval
router.post('/:id/submit', submitTemplateToMeta);

// Sync template status from Meta
router.get('/:id/sync', syncTemplateStatus);

// Delete template
router.delete('/:id', deleteTemplate);

export default router;
