import { Router } from 'express';
import { login } from '../controllers/authController.js';

const router = Router();

/**
 * User Login
 * POST /api/auth/login
 */
router.post('/login', login);

export default router;
