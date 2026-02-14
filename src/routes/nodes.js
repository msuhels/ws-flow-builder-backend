import { Router } from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  createNode,
  updateNode,
  deleteNode,
  batchUpdateNodes,
} from '../controllers/nodeController.js';

const router = Router();

/**
 * Create Node (Single)
 * POST /api/nodes
 */
router.post('/', protect, createNode);

/**
 * Update Node
 * PUT /api/nodes/:id
 */
router.put('/:id', protect, updateNode);

/**
 * Delete Node
 * DELETE /api/nodes/:id
 */
router.delete('/:id', protect, deleteNode);

/**
 * Batch Update Nodes (Sync Flow)
 * POST /api/nodes/batch
 */
router.post('/batch', protect, batchUpdateNodes);

export default router;
