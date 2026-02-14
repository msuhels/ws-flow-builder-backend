-- Add 'http' node type to the nodes table check constraint
ALTER TABLE nodes DROP CONSTRAINT IF EXISTS nodes_type_check;
ALTER TABLE nodes ADD CONSTRAINT nodes_type_check CHECK (type IN ('start', 'message', 'button', 'list', 'delay', 'condition', 'input', 'media', 'note', 'handoff', 'subflow', 'tag', 'webhook', 'http'));
