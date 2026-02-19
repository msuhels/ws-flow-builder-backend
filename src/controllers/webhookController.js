import supabase from '../config/supabase.js';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { storeUserMessage, storeBotMessage } from './conversationController.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// WhatsApp API Configuration
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || '123456';
const WHATSAPP_API_URL = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;

// Path to db.json for storing webhook data
const DB_JSON_PATH = path.join(__dirname, '..', 'db.json');

/**
 * Get next node and format for WhatsApp (Stateless - no session tracking)
 */
async function getNextNode(isFirstMessage, current_node_id, phoneNumber, isButtonClick = false, flowId) {
  try {
    let node;

    if (isFirstMessage) {
      console.log(`🚀 Starting flow - fetching first node`);
      // Get the first node with specific ID
      const { data, error } = await supabase
        .from('nodes')
        .select('*')
        .eq('id', '4d01c7af-4e22-46ba-82cb-8c710344de29')
        .maybeSingle();

      if (error) throw error;
      node = data;
    } else if (isButtonClick) {
      const { data: nextNode, error: nextError } = await supabase
        .from('nodes')
        .select('*')
        .eq('previous_node_id', current_node_id)
        .maybeSingle();

      if (nextError) throw nextError;
      if (!nextNode) {
        console.error(`❌ Next node not found: ${nextNodeId}`);
        return null;
      }

      node = nextNode;
    }

    if (!node) {
      console.log(`⛔ No next node found, end of flow`);
      return null;
    }

    console.log(`📍 Processing node: ${node.id} (${node.type}) - "${node.name}"`);

    // Parse properties if it's a string
    const properties = typeof node.properties === 'string'
      ? JSON.parse(node.properties)
      : node.properties;

    // Format based on node type
    if (node.type === 'button') {
      // Node has buttons - format as interactive button message
      const buttons = properties?.buttons || [];
      console.log(`🔘 Button node with ${buttons.length} buttons`);

      return {
        messaging_product: 'whatsapp',
        to: phoneNumber,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: {
            text: properties?.label || node.name || 'Choose an option'
          },
          action: {
            buttons: buttons.slice(0, 3).map((btn) => ({
              type: 'reply',
              reply: {
                id: btn.btn_id,
                title: btn.text
              }
            }))
          }
        }
      };
    } else if (node.type === 'message') {
      // Simple text message - check if it has buttons
      const buttons = properties?.buttons || [];

      if (buttons.length > 0) {
        console.log(`� Message node with ${buttons.length} buttons`);
        return {
          messaging_product: 'whatsapp',
          to: phoneNumber,
          type: 'interactive',
          interactive: {
            type: 'button',
            body: {
              text: properties?.label || node.name || 'Choose an option'
            },
            action: {
              buttons: buttons.slice(0, 3).map((btn) => ({
                type: 'reply',
                reply: {
                  id: btn.btn_id,
                  title: btn.text
                }
              }))
            }
          }
        };
      } else {
        console.log(`💬 Plain message node - will auto-continue`);
        const messageText = properties?.label || node.name || 'Hello 👋';

        const messagePayload = {
          messaging_product: 'whatsapp',
          to: phoneNumber,
          type: 'text',
          text: {
            body: messageText
          }
        };

        // Send this message first
        await sendReply(messagePayload);
        console.log(`✅ Plain message sent, continuing to next node...`);

        // Then get and return the next node
        return await getNextNode(false, node.id, phoneNumber);
      }
    } else if (node.type === 'http') {
      // HTTP Request node - make API call (no variable storage without sessions)
      console.log(`🌐 HTTP node - making API request`);
      try {
        const {
          url,
          method,
          authType,
          bearerToken,
          basicUsername,
          basicPassword,
          apiKeyHeader,
          apiKeyValue,
          body,
          headers,
          timeout
        } = properties;

        if (url) {
          console.log(`🌐 Making HTTP ${method || 'GET'} request to: ${url}`);

          let customHeaders = {};
          if (headers) {
            try {
              customHeaders = typeof headers === 'string' ? JSON.parse(headers) : headers;
            } catch (e) {
              console.error('❌ Invalid headers JSON:', e);
            }
          }

          // Setup authentication
          if (authType === 'bearer' && bearerToken) {
            customHeaders['Authorization'] = `Bearer ${bearerToken}`;
          } else if (authType === 'basic' && basicUsername && basicPassword) {
            const credentials = Buffer.from(`${basicUsername}:${basicPassword}`).toString('base64');
            customHeaders['Authorization'] = `Basic ${credentials}`;
          } else if (authType === 'apikey' && apiKeyHeader && apiKeyValue) {
            customHeaders[apiKeyHeader] = apiKeyValue;
          }

          let requestBody = null;
          if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
            try {
              requestBody = typeof body === 'string' ? JSON.parse(body) : body;
            } catch (e) {
              console.error('❌ Invalid body JSON:', e);
            }
          }

          // Make HTTP request
          const response = await axios({
            method: method || 'GET',
            url: url,
            data: requestBody,
            headers: customHeaders,
            timeout: (timeout || 30) * 1000,
            validateStatus: () => true
          });

          console.log(`✅ HTTP request completed with status ${response.status}`);
        }
      } catch (error) {
        console.error('❌ HTTP request failed:', error.message);
      }

      // HTTP node doesn't send a message, continue to next node
      return await getNextNode(false, node.id, phoneNumber);
    } else {
      // Default to text message for other types
      return {
        messaging_product: 'whatsapp',
        to: phoneNumber,
        type: 'text',
        text: {
          body: properties?.label || node.name || 'Message'
        }
      };
    }
  } catch (error) {
    console.error('Error getting next node:', error);
    return {
      messaging_product: 'whatsapp',
      to: phoneNumber,
      type: 'text',
      text: {
        body: 'Sorry, something went wrong. Please try again.'
      }
    };
  }
}

async function sendReply(messageContent) {
  try {
    await axios.post(
      WHATSAPP_API_URL,
      messageContent,
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`✅ Reply sent to ${messageContent.to}`);

    // Store bot message in conversations table
    const phoneNumber = messageContent.to;
    let messageText = '';

    // Extract message text based on message type
    if (messageContent.type === 'text') {
      messageText = messageContent.text?.body || '';
    } else if (messageContent.type === 'interactive') {
      if (messageContent.interactive?.type === 'button') {
        const bodyText = messageContent.interactive.body?.text || '';
        const buttons = messageContent.interactive.action?.buttons || [];
        const buttonTexts = buttons.map(btn => btn.reply?.title).filter(Boolean);

        if (buttonTexts.length > 0) {
          messageText = `${bodyText}\n\n${buttonTexts.map((text, idx) => `${idx + 1}. ${text}`).join('\n')}`;
        } else {
          messageText = bodyText;
        }
      }
    }

    if (messageText && phoneNumber) {
      await storeBotMessage(phoneNumber, messageText, null, null, null, 'sent');
    }

    return true;
  } catch (error) {
    console.error('❌ Error sending reply:', error.response?.data || error.message);
    return false;
  }
}

/**
 * Store webhook data to db.json
 */
function storeWebhookData(data) {
  try {
    let dbData = { webhooks: [] };

    if (fs.existsSync(DB_JSON_PATH)) {
      const fileContent = fs.readFileSync(DB_JSON_PATH, 'utf-8');
      dbData = JSON.parse(fileContent);
    }

    dbData.webhooks.push({
      timestamp: new Date().toISOString(),
      data: data
    });

    if (dbData.webhooks.length > 100) {
      dbData.webhooks = dbData.webhooks.slice(-100);
    }

    fs.writeFileSync(DB_JSON_PATH, JSON.stringify(dbData, null, 2));
  } catch (error) {
    console.error('❌ Error storing webhook data:', error);
  }
}

/**
 * Send a text message to a WhatsApp user
 */
async function sendTextMessage(to, message) {
  try {
    await axios.post(
      WHATSAPP_API_URL,
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'text',
        text: { body: message }
      },
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`✅ Text message sent to ${to}`);
  } catch (error) {
    console.error('❌ Error sending text message:', error.response?.data || error.message);
  }
}

/**
 * Mark message as read
 */
async function markMessageAsRead(messageId) {
  try {
    await axios.post(
      WHATSAPP_API_URL,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId
      },
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (error) {
    // Silently fail
  }
}

/**
 * Handle template status update webhook
 */
async function handleTemplateStatusUpdate(webhookData) {
  try {
    console.log('📋 Processing template status update webhook');

    const entry = webhookData.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (change?.field !== 'message_template_status_update') {
      return;
    }

    const { event, message_template_id } = value;

    const { data: template } = await supabase
      .from('templates')
      .select('*')
      .eq('meta_template_id', String(message_template_id))
      .maybeSingle();

    if (!template) {
      console.log(`⚠️ Template not found: ${message_template_id}`);
      return;
    }

    await supabase
      .from('templates')
      .update({
        status: event,
        updated_at: new Date().toISOString(),
      })
      .eq('id', template.id);

    console.log(`✅ Template status updated: ${event}`);
  } catch (error) {
    console.error('❌ Error handling template status update:', error);
  }
}

/**
 * Incoming Webhook for WhatsApp Cloud API
 */
export const handleWhatsAppWebhook = async (req, res) => {
  try {
    const body = req.body;
    let flowId = 'd0adc94d-a85e-44c9-8dfa-0bab5fcd5d9e';

    storeWebhookData(body);

    if (body.object === 'whatsapp_business_account') {
      const firstChange = body.entry?.[0]?.changes?.[0];
      if (firstChange?.field === 'message_template_status_update') {
        await handleTemplateStatusUpdate(body);
        return res.sendStatus(200);
      }

      for (const entry of body.entry) {
        const changes = entry.changes;

        for (const change of changes) {
          const value = change.value;

          if (value.messages && value.messages.length > 0) {
            const message = value.messages[0];
            const from = message.from;
            const messageType = message.type;
            const messageId = message.id;
            let messageContent = null;

            console.log(`📩 Received message from ${from}, type: ${messageType}`);

            if (messageType === 'text') {
              console.log(`💬 Text message: ${message.text.body}`);
              await storeUserMessage(from, message.text.body);

              if (message.text.body.toLowerCase().includes('hi') || message.text.body.toLowerCase().includes('hello')) {
                messageContent = await getNextNode(true, null, from, false, flowId);
              } else {
                await sendTextMessage(from, "Sorry, I didn't understand that. Please type 'Hi' or 'Hello' to see options.");
              }
            } else if (messageType === 'interactive') {
              const buttonId = message.interactive.button_reply.id;
              const buttonText = message.interactive.button_reply.title;
              console.log(`� Button clicked: ${buttonId}`);

              await storeUserMessage(from, buttonText);
              messageContent = await getNextNode(false, buttonId, from, true, flowId);
            }

            if (messageContent) {
              sendReply(messageContent);
            }

            await markMessageAsRead(messageId);
          }
        }
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    res.sendStatus(200);
  }
};

/**
 * Get stored webhook data from db.json
 */
export const getWebhookData = (req, res) => {
  try {
    if (fs.existsSync(DB_JSON_PATH)) {
      const fileContent = fs.readFileSync(DB_JSON_PATH, 'utf-8');
      const dbData = JSON.parse(fileContent);
      res.status(200).json(dbData);
    } else {
      res.status(200).json({ webhooks: [] });
    }
  } catch (error) {
    console.error('❌ Error reading webhook data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to read webhook data'
    });
  }
};

/**
 * Clear stored webhook data
 */
export const clearWebhookData = (req, res) => {
  try {
    const emptyData = { webhooks: [] };
    fs.writeFileSync(DB_JSON_PATH, JSON.stringify(emptyData, null, 2));
    res.status(200).json({
      success: true,
      message: 'Webhook data cleared successfully'
    });
  } catch (error) {
    console.error('❌ Error clearing webhook data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear webhook data'
    });
  }
};

/**
 * Webhook Verification (GET)
 */
export const verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('✅ Webhook verified successfully');
      res.status(200).send(challenge);
    } else {
      console.log('❌ Webhook verification failed');
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
};

/**
 * Direct Flow Trigger Webhook
 */
export const triggerFlow = async (req, res) => {
  try {
    const { flowId } = req.params;
    const body = req.body;

    if (body.object === 'whatsapp_business_account') {
      const firstChange = body.entry?.[0]?.changes?.[0];
      if (firstChange?.field === 'message_template_status_update') {
        await handleTemplateStatusUpdate(body);
        return res.sendStatus(200);
      }

      for (const entry of body.entry) {
        const changes = entry.changes;

        for (const change of changes) {
          const value = change.value;

          if (value.messages && value.messages.length > 0) {
            const message = value.messages[0];
            const from = message.from;
            const messageType = message.type;
            const messageId = message.id;
            let messageContent = null;

            console.log(`📩 Received message from ${from}, type: ${messageType}`);

            if (messageType === 'text') {
              console.log(`💬 Text message: ${message.text.body}`);
              await storeUserMessage(from, message.text.body);

              if (message.text.body.toLowerCase().includes('hi') || message.text.body.toLowerCase().includes('hello')) {
                messageContent = await getNextNode(true, null, from, false, flowId);
              } else {
                await sendTextMessage(from, "Sorry, I didn't understand that. Please type 'Hi' or 'Hello' to see options.");
              }
            } else if (messageType === 'interactive') {
              const buttonId = message.interactive.button_reply.id;
              const buttonText = message.interactive.button_reply.title;
              console.log(`🔘 Button clicked: ${buttonId}`);

              await storeUserMessage(from, buttonText);
              messageContent = await getNextNode(false, buttonId, from, true, flowId);
            }

            if (messageContent) {
              sendReply(messageContent);
            }

            await markMessageAsRead(messageId);
          }
        }
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    res.sendStatus(200);
  }
};
