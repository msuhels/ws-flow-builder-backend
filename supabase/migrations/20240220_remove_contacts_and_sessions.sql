-- Migration: Remove contacts and contact_sessions tables
-- Date: 2024-02-20
-- Description: Removing CRM features and session management to simplify the system to stateless flows

-- Drop contact_sessions table (depends on contacts)
DROP TABLE IF EXISTS contact_sessions CASCADE;

-- Drop contacts table
DROP TABLE IF EXISTS contacts CASCADE;

-- Note: This makes the system stateless
-- Flows will no longer track:
-- - User session state
-- - Variables collected during conversation
-- - Multi-step conversation continuity
-- - Contact information and tags
