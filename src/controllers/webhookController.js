import { FlowEngine } from '../services/flowEngine.js';
import supabase from '../config/supabase.js';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
 * Get next node and format for WhatsApp
 * @param {boolean} isFirstMessage - Whether this is the first message
 * @param {string} next_node_id - The ID to search for (node_id or btn_id)
 * @param {string} phoneNumber - The recipient phone number
 * @returns {object} Formatted WhatsApp message payload
 */
async function getNextNode(isFirstMessage, next_node_id, phoneNumber) {
  try {
    let node;

    if (isFirstMessage) {
      // Get the first node with specific ID
      const { data, error } = await supabase
        .from('nodes')
        .select('*')
        .eq('id', '2ceffbc5-89d0-4c8b-81d1-9f8c4622d0da')
        .single();

      if (error) throw error;
      node = data;
    } else {
      // Search for node where previous_node_id matches the next_node_id
      const { data, error } = await supabase
        .from('nodes')
        .select('*')
        .eq('previous_node_id', next_node_id)
        .single();

      if (error) throw error;
      node = data;
    }

    if (!node) {
      throw new Error('Node not found');
    }

    // Parse properties if it's a string
    const properties = typeof node.properties === 'string'
      ? JSON.parse(node.properties)
      : node.properties;

    // Format based on node type
    if (node.type === 'button') {
      // Node has buttons - format as interactive button message
      const buttons = properties?.buttons || [];

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
      // Simple text message
      return {
        to: phoneNumber,
        type: 'text',
        text: {
          body: properties?.label || node.name || 'Hello 👋 How can I help you?'
        }
      };
    } else {
      // Default to text message for other types
      return {
        to: phoneNumber,
        type: 'text',
        text: {
          body: properties?.label || node.name || 'Message'
        }
      };
    }
  } catch (error) {
    console.error('Error getting next node:', error);
    // Return default message on error
    return {
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

    // Read existing data if file exists
    if (fs.existsSync(DB_JSON_PATH)) {
      const fileContent = fs.readFileSync(DB_JSON_PATH, 'utf-8');
      dbData = JSON.parse(fileContent);
    }

    // Add new webhook data with timestamp
    dbData.webhooks.push({
      timestamp: new Date().toISOString(),
      data: data
    });

    // Keep only last 100 entries to prevent file from growing too large
    if (dbData.webhooks.length > 100) {
      dbData.webhooks = dbData.webhooks.slice(-100);
    }

    // Write back to file
    fs.writeFileSync(DB_JSON_PATH, JSON.stringify(dbData, null, 2));
    console.log('✅ Webhook data stored to db.json');
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
 * Send interactive buttons (Products and Services)
 */
async function sendButtons(to) {
  try {
    await axios.post(
      WHATSAPP_API_URL,
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: {
            text: 'Welcome to our company!\nPlease choose one of the options below.'
          },
          action: {
            buttons: [
              {
                type: 'reply',
                reply: {
                  id: 'products',
                  title: 'Products'
                }
              },
              {
                type: 'reply',
                reply: {
                  id: 'services',
                  title: 'Services'
                }
              }
            ]
          }
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`✅ Buttons sent to ${to}`);
  } catch (error) {
    console.error('❌ Error sending buttons:', error.response?.data || error.message);
  }
}

/**
 * Send product selection buttons
 */
async function sendProductButtons(to) {
  try {
    await axios.post(
      WHATSAPP_API_URL,
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: {
            text: 'Here are our products:\n\nPlease select a product:'
          },
          action: {
            buttons: [
              {
                type: 'reply',
                reply: {
                  id: 'product_a',
                  title: 'Product A'
                }
              },
              {
                type: 'reply',
                reply: {
                  id: 'product_b',
                  title: 'Product B'
                }
              },
              {
                type: 'reply',
                reply: {
                  id: 'product_c',
                  title: 'Product C'
                }
              }
            ]
          }
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`✅ Product buttons sent to ${to}`);
  } catch (error) {
    console.error('❌ Error sending product buttons:', error.response?.data || error.message);
  }
}

/**
 * Send service selection buttons
 */
async function sendServiceButtons(to) {
  try {
    await axios.post(
      WHATSAPP_API_URL,
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: {
            text: 'Here are our services:\n\nPlease select a service:'
          },
          action: {
            buttons: [
              {
                type: 'reply',
                reply: {
                  id: 'service_a',
                  title: 'Service A'
                }
              },
              {
                type: 'reply',
                reply: {
                  id: 'service_b',
                  title: 'Service B'
                }
              },
              {
                type: 'reply',
                reply: {
                  id: 'service_c',
                  title: 'Service C'
                }
              }
            ]
          }
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Send Service D as a separate button message (WhatsApp limitation: max 3 buttons)
    setTimeout(async () => {
      await axios.post(
        WHATSAPP_API_URL,
        {
          messaging_product: 'whatsapp',
          to: to,
          type: 'interactive',
          interactive: {
            type: 'button',
            body: {
              text: 'Or choose this service:'
            },
            action: {
              buttons: [
                {
                  type: 'reply',
                  reply: {
                    id: 'service_d',
                    title: 'Service D'
                  }
                }
              ]
            }
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );
    }, 1000);

    console.log(`✅ Service buttons sent to ${to}`);
  } catch (error) {
    console.error('❌ Error sending service buttons:', error.response?.data || error.message);
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
    // Silently fail - marking as read is not critical
  }
}

/**
 * Incoming Webhook for WhatsApp Cloud API
 */
export const handleWhatsAppWebhook = async (req, res) => {
  try {
    const body = req.body;
    // Store webhook data to db.json
    // storeWebhookData(body);

    // Check if this is a WhatsApp message event
    if (body.object === 'whatsapp_business_account') {
      // Loop through entries
      for (const entry of body.entry) {
        const changes = entry.changes;

        for (const change of changes) {
          const value = change.value;

          // Check if there are messages
          if (value.messages && value.messages.length > 0) {
            const message = value.messages[0];
            const from = message.from;
            const messageType = message.type;
            const messageId = message.id;
            let messageContent = null;

            console.log(`📩 Received message from ${from}, type: ${messageType}`);

            // Handle different message types
            if (messageType === 'text') {
              // User sent a text message - send welcome buttons
              console.log(`💬 Text message: ${message.text.body}`);

              if (message.text.body.toLowerCase().includes('hi') || message.text.body.toLowerCase().includes('hello')) {
                messageContent = await getNextNode(true, null, from);
              } else {
                await sendTextMessage(from, "Sorry, I didn't understand that. Please type 'Hi' or 'Hello' to see options.");
              }






              // await sendButtons(from);

              // // Also process through flow engine
              // const normalizedEvent = {
              //   type: 'message',
              //   from: from,
              //   messageId: messageId,
              //   text: message.text.body
              // };

              // FlowEngine.handleIncomingEvent(normalizedEvent).catch(err => {
              //   console.error("Error processing webhook event:", err);
              // });

            } else if (messageType === 'interactive') {
              // User clicked a button
              const buttonId = message.interactive.button_reply.id;
              messageContent = await getNextNode(false, buttonId, from);




              // console.log(`🔘 Button clicked: ${buttonId}`);

              // // Handle main menu button clicks
              // if (buttonId === 'products') {
              //   await sendProductButtons(from);
              // } else if (buttonId === 'services') {
              //   await sendServiceButtons(from);
              // }
              // // Handle product selections
              // else if (buttonId === 'product_a') {
              //   await sendTextMessage(from, 'You have selected Product A, we will contact you shortly.');
              // } else if (buttonId === 'product_b') {
              //   await sendTextMessage(from, 'You have selected Product B, we will contact you shortly.');
              // } else if (buttonId === 'product_c') {
              //   await sendTextMessage(from, 'You have selected Product C, we will contact you shortly.');
              // }
              // // Handle service selections
              // else if (buttonId === 'service_a') {
              //   await sendTextMessage(from, 'You have selected Service A, we will contact you shortly.');
              // } else if (buttonId === 'service_b') {
              //   await sendTextMessage(from, 'You have selected Service B, we will contact you shortly.');
              // } else if (buttonId === 'service_c') {
              //   await sendTextMessage(from, 'You have selected Service C, we will contact you shortly.');
              // } else if (buttonId === 'service_d') {
              //   await sendTextMessage(from, 'You have selected Service D, we will contact you shortly.');
              // }

              // // Also process through flow engine
              // const normalizedEvent = {
              //   type: 'button_reply',
              //   from: from,
              //   messageId: messageId,
              //   payload: buttonId,
              //   text: message.interactive.button_reply.title
              // };

              // FlowEngine.handleIncomingEvent(normalizedEvent).catch(err => {
              //   console.error("Error processing webhook event:", err);
              // });
            }
            if (messageContent) {
              storeWebhookData(messageContent);
              sendReply(messageContent);
            }
            // Mark message as read
            await markMessageAsRead(messageId);
          }

          // Handle status updates
          // if (value.statuses && value.statuses.length > 0) {
          //   const status = value.statuses[0];
          //   const normalizedEvent = {
          //     type: 'status',
          //     from: status.recipient_id,
          //     messageId: status.id,
          //     status: status.status
          //   };

          //   FlowEngine.handleIncomingEvent(normalizedEvent).catch(err => {
          //     console.error("Error processing status event:", err);
          //   });
          // }
        }
      }
    }

    // Always respond with 200 to acknowledge receipt
    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    // Still send 200 to prevent Meta from retrying
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
      error: 'Failed to read webhook data',
      message: error.message
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
      error: 'Failed to clear webhook data',
      message: error.message
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
    const { phoneNumber, data } = req.body;

    if (!phoneNumber) {
      res.status(400).json({
        success: false,
        error: 'phoneNumber is required'
      });
      return;
    }

    console.log(`[Webhook Trigger] Flow ${flowId} triggered for ${phoneNumber}`);

    // Start the flow directly
    await FlowEngine.startFlow(phoneNumber, flowId, data || {});

    // Small delay to ensure message is logged
    await new Promise(resolve => setTimeout(resolve, 100));

    // Get session info
    const session = await FlowEngine.getSession(phoneNumber);

    // Get the last message sent to this phone number
    const { data: lastMessage } = await supabase
      .from('message_logs')
      .select('*')
      .eq('phone_number', phoneNumber)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    console.log('[Webhook Trigger] Last message:', lastMessage);

    res.status(200).json({
      success: true,
      message: 'Flow triggered successfully',
      flowId: flowId,
      phoneNumber: phoneNumber,
      session: session ? {
        id: session.id,
        flowId: session.flow_id,
        currentNodeId: session.current_node_id,
        status: session.status,
        context: session.context
      } : null,
      botResponse: lastMessage ? {
        content: lastMessage.content,
        type: lastMessage.message_type,
        sentAt: lastMessage.sent_at
      } : null
    });

  } catch (error) {
    console.error('[Webhook Trigger] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Test Webhook Endpoint
 */
export const testWebhook = async (req, res) => {
  try {
    const { phoneNumber, type, text, buttonId, listId } = req.body;

    if (!phoneNumber) {
      res.status(400).json({
        success: false,
        error: 'phoneNumber is required'
      });
      return;
    }

    let normalizedEvent = {
      from: phoneNumber,
      messageId: `test_${Date.now()}`,
    };

    // Build event based on type
    switch (type) {
      case 'text':
      case 'message':
        normalizedEvent.type = 'message';
        normalizedEvent.text = text || 'test message';
        break;

      case 'button':
      case 'button_reply':
        normalizedEvent.type = 'button_reply';
        normalizedEvent.payload = buttonId || 'test_btn_0';
        normalizedEvent.text = text || 'Button clicked';
        break;

      case 'list':
      case 'list_reply':
        normalizedEvent.type = 'list_reply';
        normalizedEvent.payload = listId || 'test_list_0';
        normalizedEvent.text = text || 'List item selected';
        break;

      default:
        normalizedEvent.type = 'message';
        normalizedEvent.text = text || 'test';
    }

    console.log('[Webhook Test] Simulating event:', normalizedEvent);

    // Process the event
    await FlowEngine.handleIncomingEvent(normalizedEvent);

    // Small delay to ensure message is logged
    await new Promise(resolve => setTimeout(resolve, 100));

    // Get session info for response
    const session = await FlowEngine.getSession(phoneNumber);

    // Get the last message sent to this phone number
    const { data: lastMessage } = await supabase
      .from('message_logs')
      .select('*')
      .eq('phone_number', phoneNumber)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    console.log('[Webhook Test] Last message:', lastMessage);

    res.status(200).json({
      success: true,
      message: 'Test webhook processed',
      event: normalizedEvent,
      session: session ? {
        id: session.id,
        flowId: session.flow_id,
        currentNodeId: session.current_node_id,
        status: session.status,
        context: session.context,
        executionTrace: session.execution_trace
      } : null,
      botResponse: lastMessage ? {
        content: lastMessage.content,
        type: lastMessage.message_type,
        sentAt: lastMessage.sent_at
      } : null
    });

  } catch (error) {
    console.error('[Webhook Test] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
};
