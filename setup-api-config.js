import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const whatsappToken = process.env.WHATSAPP_TOKEN;
const phoneNumberId = process.env.PHONE_NUMBER_ID;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

if (!whatsappToken || !phoneNumberId) {
  console.error('❌ Missing WhatsApp credentials (WHATSAPP_TOKEN, PHONE_NUMBER_ID)');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function setupApiConfig() {
  try {
    console.log('🔍 Checking existing API config...');
    
    // Check if config exists
    const { data: existing, error: checkError } = await supabase
      .from('api_config')
      .select('*')
      .limit(1)
      .maybeSingle();
    
    if (checkError) {
      console.error('❌ Error checking config:', checkError);
      return;
    }
    
    if (existing) {
      console.log('✓ API config already exists:', {
        id: existing.id,
        base_url: existing.base_url,
        has_api_key: !!existing.api_key,
        business_number_id: existing.business_number_id,
        is_active: existing.is_active
      });
      
      // Update with current env values
      console.log('\n📝 Updating with current .env values...');
      const { error: updateError } = await supabase
        .from('api_config')
        .update({
          api_key: whatsappToken,
          business_number_id: phoneNumberId,
          base_url: 'https://graph.facebook.com',
          is_active: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id);
      
      if (updateError) {
        console.error('❌ Error updating config:', updateError);
      } else {
        console.log('✅ API config updated successfully!');
      }
    } else {
      console.log('📝 No config found, creating new one...');
      
      const { data: newConfig, error: insertError } = await supabase
        .from('api_config')
        .insert({
          base_url: 'https://graph.facebook.com',
          api_key: whatsappToken,
          business_number_id: phoneNumberId,
          is_active: true
        })
        .select()
        .single();
      
      if (insertError) {
        console.error('❌ Error creating config:', insertError);
      } else {
        console.log('✅ API config created successfully!');
        console.log('Config ID:', newConfig.id);
      }
    }
    
    console.log('\n✅ Setup complete! Your WhatsApp API is now configured.');
    
  } catch (error) {
    console.error('❌ Setup failed:', error);
  }
}

setupApiConfig();
