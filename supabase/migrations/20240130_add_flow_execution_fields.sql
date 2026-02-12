-- Add first_node_id to flows table to track the starting node
ALTER TABLE flows 
ADD COLUMN IF NOT EXISTS first_node_id UUID REFERENCES nodes(id) ON DELETE SET NULL;

-- Add execution_trace to contact_sessions for debugging
ALTER TABLE contact_sessions 
ADD COLUMN IF NOT EXISTS execution_trace JSONB DEFAULT '[]'::jsonb;

-- Add ended_at timestamp to contact_sessions
ALTER TABLE contact_sessions 
ADD COLUMN IF NOT EXISTS ended_at TIMESTAMP WITH TIME ZONE;

-- Create error_logs table for tracking flow execution errors
CREATE TABLE IF NOT EXISTS error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number VARCHAR(20),
  context VARCHAR(255),
  error_message TEXT,
  error_stack TEXT,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add index for faster error log queries
CREATE INDEX IF NOT EXISTS idx_error_logs_phone ON error_logs(phone_number);
CREATE INDEX IF NOT EXISTS idx_error_logs_timestamp ON error_logs(timestamp DESC);

-- Add buttonIndex to connections (stored in JSONB connections array)
-- This is already handled in the JSONB structure, no schema change needed

-- Add comment for documentation
COMMENT ON COLUMN flows.first_node_id IS 'The first node to execute when flow is triggered';
COMMENT ON COLUMN contact_sessions.execution_trace IS 'Array of execution events for debugging';
COMMENT ON COLUMN contact_sessions.ended_at IS 'When the session ended (completed, error, or paused)';
COMMENT ON TABLE error_logs IS 'Logs of flow execution errors for debugging';
