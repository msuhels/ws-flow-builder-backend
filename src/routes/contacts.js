import { Router } from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  getAllContacts,
  getContactById,
  updateContact,
  deleteContact,
  getAllTags,
} from '../controllers/contactController.js';

const router = Router();

/**
 * Get All Contacts
 * GET /api/contacts
 */
router.get('/', protect, getAllContacts);

/**
 * Get All Unique Tags
 * GET /api/contacts/tags/list
 */
router.get('/tags/list', protect, getAllTags);

/**
 * Get Contact by ID
 * GET /api/contacts/:id
 */
router.get('/:id', protect, getContactById);

/**
 * Update Contact
 * PUT /api/contacts/:id
 */
router.put('/:id', protect, updateContact);

/**
 * Delete Contact
 * DELETE /api/contacts/:id
 */
router.delete('/:id', protect, deleteContact);

export default router;
