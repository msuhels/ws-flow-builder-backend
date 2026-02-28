import { Router } from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  getAllFlows,
  createFlow,
  getFlowById,
  updateFlow,
  deleteFlow,
  getFlowVariables,
} from '../controllers/flowController.js';

const router = Router();

/**
 * Get All Flows
 * GET /api/flows
 */
router.get('/', protect, getAllFlows);

/**
 * Create New Flow
 * POST /api/flows
 */
router.post('/', protect, createFlow);

/**
 * Get Flow by ID
 * GET /api/flows/:id
 */
router.get('/:id', protect, getFlowById);

/**
 * Get Available Variables for a Flow
 * GET /api/flows/:id/variables
 */
router.get('/:id/variables', protect, getFlowVariables);

/**
 * Update Flow
 * PUT /api/flows/:id
 */
router.put('/:id', protect, updateFlow);

/**
 * Delete Flow
 * DELETE /api/flows/:id
 */
router.delete('/:id', protect, deleteFlow);

export default router;
