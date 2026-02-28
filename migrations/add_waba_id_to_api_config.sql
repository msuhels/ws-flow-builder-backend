-- Add WhatsApp Business Account ID to api_config table
ALTER TABLE api_config 
ADD COLUMN IF NOT EXISTS whatsapp_business_account_id TEXT;

-- Add comment to explain the field
COMMENT ON COLUMN api_config.whatsapp_business_account_id IS 'WhatsApp Business Account ID (WABA ID) required for template management';
