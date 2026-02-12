-- Update Nodes Table Check Constraint to include new node types
ALTER TABLE nodes DROP CONSTRAINT IF EXISTS nodes_type_check;
ALTER TABLE nodes ADD CONSTRAINT nodes_type_check CHECK (type IN ('message', 'button', 'list', 'delay', 'condition', 'input', 'media', 'note', 'handoff', 'subflow'));

-- Create Contacts Table to store attributes
CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone_number TEXT NOT NULL UNIQUE,
  name TEXT,
  email TEXT,
  attributes JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Update UserProgress to reference contacts if needed, or just keep it for flow state
-- Adding entry/exit tracking to flow_analytics (new table or update message_logs)
CREATE TABLE IF NOT EXISTS flow_analytics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flow_id UUID REFERENCES flows(id) ON DELETE CASCADE,
  node_id TEXT, -- References node.id
  event_type TEXT CHECK (event_type IN ('entry', 'exit', 'drop_off')),
  count INTEGER DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(flow_id, node_id, event_type)
);
