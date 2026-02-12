-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Drop existing tables to reset schema
DROP TABLE IF EXISTS message_logs CASCADE;
DROP TABLE IF EXISTS api_config CASCADE;
DROP TABLE IF EXISTS user_progress CASCADE;
DROP TABLE IF EXISTS nodes CASCADE;
DROP TABLE IF EXISTS flows CASCADE;

-- Create Flows Table
CREATE TABLE IF NOT EXISTS flows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT CHECK (trigger_type IN ('keyword', 'manual', 'campaign')),
  trigger_value TEXT,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create Nodes Table
-- Changing ID to TEXT to support frontend-generated IDs (e.g. from React Flow)
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY, 
  flow_id UUID REFERENCES flows(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('message', 'button', 'list', 'delay', 'condition')),
  name TEXT NOT NULL,
  properties JSONB DEFAULT '{}'::jsonb,
  connections JSONB DEFAULT '[]'::jsonb,
  position JSONB DEFAULT '{"x": 0, "y": 0}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create UserProgress Table
CREATE TABLE IF NOT EXISTS user_progress (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone_number TEXT NOT NULL,
  flow_id UUID REFERENCES flows(id) ON DELETE SET NULL,
  current_node_id TEXT, -- References nodes.id (which is TEXT now)
  context JSONB DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  last_activity TIMESTAMPTZ DEFAULT NOW()
);

-- Create ApiConfig Table
CREATE TABLE IF NOT EXISTS api_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  business_number_id TEXT,
  last_tested TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create MessageLog Table
CREATE TABLE IF NOT EXISTS message_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone_number TEXT NOT NULL,
  flow_id UUID REFERENCES flows(id) ON DELETE SET NULL,
  node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
  message_type TEXT NOT NULL,
  content JSONB DEFAULT '{}'::jsonb,
  status TEXT DEFAULT 'sent',
  wati_message_id TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_nodes_flow_id ON nodes(flow_id);
CREATE INDEX IF NOT EXISTS idx_user_progress_phone ON user_progress(phone_number);
CREATE INDEX IF NOT EXISTS idx_message_logs_phone ON message_logs(phone_number);
CREATE INDEX IF NOT EXISTS idx_message_logs_flow ON message_logs(flow_id);
