/**
 * Express Application Setup
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { logger } from './utils/logger.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import settingsRoutes from './routes/settings.js';
import flowRoutes from './routes/flows.js';
import nodeRoutes from './routes/nodes.js';
import messageRoutes from './routes/messages.js';
import webhookRoutes from './routes/webhooks.js';
import contactRoutes from './routes/contacts.js';
import templateRoutes from './routes/templates.js';
import conversationRoutes from './routes/conversations.js';

// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware (development only)
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    logger.debug(`${req.method} ${req.path}`);
    next();
  });
}

/**
 * API Routes
 */
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/flows', flowRoutes);
app.use('/api/nodes', nodeRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/conversations', conversationRoutes);

/**
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Error handler middleware
 */
app.use((error, req, res, next) => {
  logger.error('Error:', error.message);
  if (process.env.NODE_ENV === 'development') {
    logger.error('Stack:', error.stack);
  }
  
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
  });
});

/**
 * 404 handler
 */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.path,
  });
});

export default app;
