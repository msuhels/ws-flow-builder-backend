import { Router, type Request, type Response } from 'express';
import { protect } from '../middleware/authMiddleware.js';
import supabase from '../config/supabase.js';
import axios from 'axios';

const router = Router();

/**
 * Send Message (Manual or Test)
 * POST /api/messages/send
 */
router.post('/send', protect, async (req: Request, res: Response): Promise<void> => {
  try {
    const { phoneNumber, message, flowId, nodeId } = req.body;

    // 1. Get WhatsApp API Config
    const { data: config } = await supabase
      .from('api_config')
      .select('*')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (!config || !config.api_key || !config.business_number_id) {
        res.status(400).json({ success: false, message: 'WhatsApp API (Cloud) not configured' });
        return;
    }

    const version = 'v17.0';
    const url = `https://graph.facebook.com/${version}/${config.business_number_id}/messages`;

    // 2. Prepare Payload (Cloud API Format)
    const waPayload: any = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phoneNumber,
        type: 'text',
        text: { body: typeof message === 'string' ? message : JSON.stringify(message) }
    };

    let waResponseId = '';
    let status = 'failed';

    // 3. Send to WhatsApp Cloud API
    try {
        const response = await axios.post(url, waPayload, {
            headers: { 
                'Authorization': `Bearer ${config.api_key}`,
                'Content-Type': 'application/json'
            }
        });
        
        waResponseId = response.data.messages?.[0]?.id;
        status = 'sent';
        
    } catch (apiError: any) {
        console.error('WhatsApp Cloud API Error:', apiError.response?.data || apiError.message);
        status = 'failed';
    }

    // 4. Log Message
    await supabase.from('message_logs').insert({
        phone_number: phoneNumber,
        flow_id: flowId,
        node_id: nodeId,
        message_type: 'text',
        content: message,
        status,
        wati_message_id: waResponseId,
    });

    if (status === 'sent') {
        res.status(200).json({ success: true, message: 'Message sent successfully', messageId: waResponseId });
    } else {
        res.status(500).json({ success: false, message: 'Failed to send message via WhatsApp Cloud API' });
    }

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

export default router;
