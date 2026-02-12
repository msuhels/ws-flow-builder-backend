-- Create Contact Sessions table to track flow state
CREATE TABLE IF NOT EXISTS contact_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL, -- Redundant but useful for quick lookup
  flow_id UUID REFERENCES flows(id) ON DELETE SET NULL,
  current_node_id TEXT, -- ID from the JSON node structure
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'expired')),
  context JSONB DEFAULT '{}'::jsonb, -- Store temporary flow variables
  last_interaction_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_contact_sessions_phone ON contact_sessions(phone_number);
CREATE INDEX IF NOT EXISTS idx_contact_sessions_status ON contact_sessions(status);

-- Update contacts to ensure phone is unique if not already
-- (Already done in previous migration, but good to double check mentally)
