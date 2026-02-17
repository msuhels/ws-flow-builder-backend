-- Create conversations table to store all messages (bot and manual)
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  message_type VARCHAR(20) NOT NULL CHECK (message_type IN ('bot', 'manual', 'user')),
  -- bot: automated from flow, manual: sent from conversation chat, user: received from user
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('sent', 'received')),
  -- sent: messages we sent (bot or manual), received: messages from user
  status VARCHAR(20) DEFAULT 'sent',
  wati_message_id VARCHAR(255),
  flow_id UUID REFERENCES flows(id) ON DELETE SET NULL,
  node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_conversations_phone_number ON conversations(phone_number);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_phone_created ON conversations(phone_number, created_at DESC);

-- Create a view for conversation list with last message
CREATE OR REPLACE VIEW conversation_list AS
SELECT 
  phone_number,
  MAX(created_at) as last_message_at,
  (
    SELECT message 
    FROM conversations c2 
    WHERE c2.phone_number = c1.phone_number 
    ORDER BY created_at DESC 
    LIMIT 1
  ) as last_message,
  (
    SELECT direction 
    FROM conversations c2 
    WHERE c2.phone_number = c1.phone_number 
    ORDER BY created_at DESC 
    LIMIT 1
  ) as last_message_direction
FROM conversations c1
GROUP BY phone_number
ORDER BY last_message_at DESC;
