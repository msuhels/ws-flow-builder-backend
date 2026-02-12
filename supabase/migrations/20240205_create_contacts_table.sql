-- Create Contacts Table
CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone_number VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(255),
  attributes JSONB DEFAULT '{}'::jsonb,
  tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  last_interaction_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for performance (only for columns that exist)
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone_number);
CREATE INDEX IF NOT EXISTS idx_contacts_last_interaction ON contacts(last_interaction_at);

-- Fix first_node_id type mismatch (UUID -> TEXT) and remove foreign key
-- First check if column exists, if not add it as TEXT
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'flows' AND column_name = 'first_node_id'
  ) THEN
    -- Column exists, alter it
    ALTER TABLE flows DROP CONSTRAINT IF EXISTS flows_first_node_id_fkey;
    ALTER TABLE flows ALTER COLUMN first_node_id TYPE TEXT USING first_node_id::TEXT;
  ELSE
    -- Column doesn't exist, add it
    ALTER TABLE flows ADD COLUMN first_node_id TEXT;
  END IF;
END $$;
