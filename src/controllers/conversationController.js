import supabase from '../config/supabase.js';
import axios from 'axios';

/**
 * Get all conversations (list of users with last message)
 */
export const getConversations = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('conversation_list')
      .select('*')
      .order('last_message_at', { ascending: false });

    if (error) throw error;

    res.status(200).json({ 
      success: true, 
      data: data || [] 
    });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch conversations' 
    });
  }
};

/**
 * Get messages for a specific phone number
 */
export const getConversationMessages = async (req, res) => {
  try {
    const { phoneNumber } = req.params;

    console.log('[Conversation] Fetching messages for:', phoneNumber);

    if (!phoneNumber) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone number is required' 
      });
    }

    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('phone_number', phoneNumber)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[Conversation] Error fetching messages:', error);
      throw error;
    }

    console.log('[Conversation] Found messages:', data?.length || 0);
    console.log('[Conversation] Message types:', data?.map(m => m.message_type).join(', '));

    res.status(200).json({ 
      success: true, 
      data: data || [] 
    });
  } catch (error) {
    console.error('[Conversation] Error fetching conversation messages:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch messages',
      error: error.message
    });
  }
};

/**
 * Send manual message from conversation chat
 */
export const sendConversationMessage = async (req, res) => {
  try {
    const { phoneNumber, message } = req.body;

    console.log('[Conversation] Send message request:', { phoneNumber, message });

    if (!phoneNumber || !message) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone number and message are required' 
      });
    }

    // Get WhatsApp API Config
    const { data: config, error: configError } = await supabase
      .from('api_config')
      .select('*')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    console.log('[Conversation] API Config:', config ? 'Found' : 'Not found', configError);

    if (!config || !config.api_key || !config.business_number_id) {
      console.error('[Conversation] Missing API config:', { 
        hasConfig: !!config, 
        hasApiKey: !!config?.api_key, 
        hasBusinessId: !!config?.business_number_id 
      });
      return res.status(400).json({ 
        success: false, 
        message: 'WhatsApp API not configured. Please configure in Settings.' 
      });
    }

    const version = 'v17.0';
    const url = `https://graph.facebook.com/${version}/${config.business_number_id}/messages`;

    // Prepare WhatsApp payload
    const waPayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phoneNumber,
      type: 'text',
      text: { body: message }
    };

    let waResponseId = '';
    let status = 'sent';

    // Send to WhatsApp
    try {
      console.log('[Conversation] Sending to WhatsApp:', { to: phoneNumber, url });
      const response = await axios.post(url, waPayload, {
        headers: { 
          'Authorization': `Bearer ${config.api_key}`,
          'Content-Type': 'application/json'
        }
      });
      
      waResponseId = response.data.messages?.[0]?.id;
      status = 'sent';
      console.log('[Conversation] WhatsApp response:', { waResponseId, status });
    } catch (apiError) {
      console.error('[Conversation] WhatsApp API Error:', apiError.response?.data || apiError.message);
      status = 'failed';
      
      // Return error details
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to send message via WhatsApp',
        error: apiError.response?.data || apiError.message
      });
    }

    // Store in conversations table
    const { data: conversationData, error: conversationError } = await supabase
      .from('conversations')
      .insert({
        phone_number: phoneNumber,
        message: message,
        message_type: 'manual',
        direction: 'sent',
        status: status,
        wati_message_id: waResponseId
      })
      .select()
      .single();

    if (conversationError) {
      console.error('[Conversation] Error storing conversation:', conversationError);
    } else {
      console.log('[Conversation] Message stored:', conversationData?.id);
    }

    if (status === 'sent') {
      res.status(200).json({ 
        success: true, 
        message: 'Message sent successfully',
        data: conversationData
      });
    } else {
      res.status(500).json({ 
        success: false, 
        message: 'Failed to send message via WhatsApp' 
      });
    }

  } catch (error) {
    console.error('[Conversation] Error sending message:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: error.message
    });
  }
};

/**
 * Store bot message in conversations (called from flowEngine)
 */
export const storeBotMessage = async (phoneNumber, message, flowId, nodeId, waMessageId, status = 'sent') => {
  try {
    console.log('[Conversation] Storing bot message:', { 
      phoneNumber, 
      messageLength: message?.length, 
      flowId, 
      nodeId, 
      waMessageId, 
      status 
    });
    
    const result = await supabase.from('conversations').insert({
      phone_number: phoneNumber,
      message: typeof message === 'string' ? message : JSON.stringify(message),
      message_type: 'bot',
      direction: 'sent',
      status: status,
      wati_message_id: waMessageId,
      flow_id: flowId,
      node_id: nodeId
    });
    
    if (result.error) {
      console.error('[Conversation] Error storing bot message:', result.error);
    } else {
      console.log('[Conversation] ✓ Bot message stored successfully');
    }
  } catch (error) {
    console.error('[Conversation] Error storing bot message:', error);
  }
};

/**
 * Store user message in conversations (called from webhook)
 */
export const storeUserMessage = async (phoneNumber, message) => {
  try {
    await supabase.from('conversations').insert({
      phone_number: phoneNumber,
      message: message,
      message_type: 'user',
      direction: 'received',
      status: 'received'
    });
  } catch (error) {
    console.error('Error storing user message:', error);
  }
};
