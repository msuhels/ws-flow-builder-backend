import { FlowEngine } from '../services/flowEngine.js';
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
 * Interpolate variables in text
 * Replaces {{variableName}} or {{variableName.nested.path}} with actual values from context
 */
function interpolateVariables(text, context) {
  if (!text) return text;

  console.log(`🔄 Interpolating variables in text. Context keys:`, Object.keys(context));

  return text.replace(/\{\{([\w.]+)\}\}/g, (match, varPath) => {
    try {
      const keys = varPath.split('.');
      let value = context;

      for (const key of keys) {
        if (value && typeof value === 'object' && key in value) {
          value = value[key];
        } else {
          // Variable doesn't exist - remove the placeholder entirely
          console.log(`⚠️ Variable not found: ${varPath}, removing from message`);
          return '';
        }
      }

      if (value !== undefined && value !== null) {
        if (typeof value === 'object') {
          return JSON.stringify(value);
        }
        console.log(`✓ Replaced {{${varPath}}} with: ${String(value)}`);
        return String(value);
      }

      // Variable exists but is null/undefined - remove placeholder
      console.log(`⚠️ Variable ${varPath} is null/undefined, removing from message`);
      return '';
    } catch (e) {
      console.error('Error interpolating variable:', varPath, e);
      return '';
    }
  });
}

/**
 * Find the node that contains a specific button ID
 * @param {string} buttonId - The button ID to search for
 * @returns {object|null} The node containing this button
 */
async function findNodeByButtonId(buttonId) {
  try {
    console.log(`🔍 Searching for node with button ID: ${buttonId}`);

    // Query directly using JSONB contains operator
    // This searches for any node where properties->buttons array contains an object with btn_id = buttonId
    const { data: nodes, error } = await supabase
      .from('nodes')
      .select('*')
      .contains('properties->buttons', [{ btn_id: buttonId }]);

    if (error) throw error;

    if (nodes && nodes.length > 0) {
      console.log(`✅ Found button in node: ${nodes[0].id} (${nodes[0].type})`);
      return nodes[0];
    }

    console.log(`❌ No node found with button ID: ${buttonId}`);
    return null;
  } catch (error) {
    console.error('Error finding node by button ID:', error);
    return null;
  }
}

/**
 * Get next node and format for WhatsApp
 * @param {boolean} isFirstMessage - Whether this is the first message
 * @param {string} current_node_id - The current node ID to find next from
 * @param {string} phoneNumber - The recipient phone number
 * @param {boolean} isButtonClick - Whether this is from a button click
 * @returns {object} Formatted WhatsApp message payload
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

      // Create a new session for this flow
      if (node) {
        console.log(`📝 Creating new session for phone: ${phoneNumber}`);

        // First, get or create contact
        const { data: existingContact } = await supabase
          .from('contacts')
          .select('*')
          .eq('phone_number', phoneNumber)
          .maybeSingle();

        let contactId = existingContact?.id;

        if (!existingContact) {
          const { data: newContact } = await supabase
            .from('contacts')
            .insert({
              phone_number: phoneNumber,
              last_interaction_at: new Date().toISOString()
            })
            .select()
            .single();
          contactId = newContact?.id;
          console.log(`✅ Created new contact: ${contactId}`);
        }

        // Create session
        const { data: newSession, error: sessionError } = await supabase
          .from('contact_sessions')
          .insert({
            contact_id: contactId,
            phone_number: phoneNumber,
            flow_id: node.flow_id,
            current_node_id: node.id,
            status: 'active',
            context: {},
            last_interaction_at: new Date().toISOString()
          })
          .select()
          .single();

        if (sessionError) {
          console.error(`❌ Error creating session:`, sessionError);
        } else {
          console.log(`✅ Session created: ${newSession.id}`);
        }
      }
    } else if (isButtonClick) {
      // If this is a button click, find the node that contains this button
      console.log(`🔘 Button clicked with ID: ${current_node_id}`);
      const nodeWithButton = await findNodeByButtonId(current_node_id);

      if (!nodeWithButton) {
        console.log(`❌ Could not find node with button ID: ${current_node_id}`);
        return null;
      }

      // Now get the next node from this node's connections
      const connections = nodeWithButton.connections || [];

      if (connections.length === 0) {
        console.log(`⚠️ No connections found for node: ${nodeWithButton.id}`);
        return null;
      }

      // Find which button was clicked
      const properties = typeof nodeWithButton.properties === 'string'
        ? JSON.parse(nodeWithButton.properties)
        : nodeWithButton.properties;

      const buttons = properties?.buttons || [];
      const clickedButtonIndex = buttons.findIndex(btn => btn.btn_id === current_node_id);

      console.log(`🔘 Clicked button index: ${clickedButtonIndex} (out of ${buttons.length} buttons)`);

      if (clickedButtonIndex === -1) {
        console.log(`❌ Could not find which button was clicked with ID: ${current_node_id}`);
        return null;
      }

      // Find the connection that matches this button index
      // Use the LAST matching connection (most recent) in case there are duplicates
      const matchingConnections = connections.filter(conn => conn.buttonIndex === clickedButtonIndex);

      if (matchingConnections.length === 0) {
        console.log(`❌ No connection found for button index: ${clickedButtonIndex}`);
        console.log(`Available connections:`, connections.map(c => `button ${c.buttonIndex} -> ${c.targetNodeId.substring(0, 8)}...`));
        return null;
      }

      const matchingConnection = matchingConnections[matchingConnections.length - 1]; // Take the last one
      console.log(`✅ Found ${matchingConnections.length} connection(s) for button ${clickedButtonIndex}, using the most recent one`);

      const nextNodeId = matchingConnection.targetNodeId;
      console.log(`🔗 Moving from button ${clickedButtonIndex} of node ${nodeWithButton.id} to ${nextNodeId}`);

      // Debug: Check if this node exists
      const { data: checkNode, error: checkError } = await supabase
        .from('nodes')
        .select('id, name, type, flow_id')
        .eq('id', nextNodeId)
        .maybeSingle();

      console.log(`🔍 Checking if node ${nextNodeId} exists:`, checkNode ? `YES - ${checkNode.type} "${checkNode.name}"` : 'NO');

      if (!checkNode) {
        // List all nodes to help debug
        const { data: allNodes } = await supabase
          .from('nodes')
          .select('id, name, type, flow_id')
          .limit(20);

        console.log(`📋 All nodes in database (${allNodes?.length || 0} total):`);
        allNodes?.forEach(n => {
          console.log(`  - ${n.id} (${n.type}) "${n.name}" [flow: ${n.flow_id}]`);
        });
      }

      // Fetch the next node
      const { data: nextNode, error: nextError } = await supabase
        .from('nodes')
        .select('*')
        .eq('id', nextNodeId)
        .maybeSingle();

      if (nextError) {
        console.error(`❌ Error fetching next node:`, nextError);
        throw nextError;
      }

      if (!nextNode) {
        console.error(`❌ Next node not found in database: ${nextNodeId}`);
        console.error(`⚠️ This usually means the flow hasn't been saved yet. Please save the flow in the builder!`);
        return null;
      }

      node = nextNode;
    } else {
      console.log(`➡️ Moving to next node from: ${current_node_id}`);
      // Get the current node to find its connections
      const { data: currentNode, error: currentError } = await supabase
        .from('nodes')
        .select('*')
        .eq('id', current_node_id)
        .maybeSingle();

      if (currentError) throw currentError;

      if (!currentNode) {
        console.log(`❌ Current node not found: ${current_node_id}`);
        return null;
      }

      // Get the next node from connections
      const connections = currentNode.connections || [];

      if (connections.length === 0) {
        console.log(`⚠️ No connections found for node: ${current_node_id}`);
        return null;
      }

      // Get the first connection's target node
      const nextNodeId = connections[0].targetNodeId;

      if (!nextNodeId) {
        console.log(`⚠️ No targetNodeId in connection`);
        return null;
      }

      console.log(`🔗 Moving from node ${current_node_id} to ${nextNodeId}`);

      // Fetch the next node
      const { data: nextNode, error: nextError } = await supabase
        .from('nodes')
        .select('*')
        .eq('id', nextNodeId)
        .maybeSingle();

      if (nextError) {
        console.error(`❌ Error fetching next node:`, nextError);
        throw nextError;
      }

      if (!nextNode) {
        console.error(`❌ Next node not found in database: ${nextNodeId}`);
        console.error(`⚠️ This usually means the flow hasn't been saved yet. Please save the flow in the builder!`);
        return null;
      }

      node = nextNode;
    }

    if (!node) {
      console.log(`⛔ No next node found, end of flow`);
      return null;
    }

    console.log(`📍 Processing node: ${node.id} (${node.type}) - "${node.name}"`);

    // Get session context for variable interpolation
    const { data: session } = await supabase
      .from('contact_sessions')
      .select('*')
      .eq('phone_number', phoneNumber)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const context = session?.context || {};
    console.log(`📦 Session context keys:`, Object.keys(context).length > 0 ? Object.keys(context) : 'empty');
    if (Object.keys(context).length > 0) {
      console.log(`📦 Session context data:`, JSON.stringify(context, null, 2));
    }

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
            text: interpolateVariables(properties?.label || node.name || 'Choose an option', context)
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
        console.log(`💬 Message node with ${buttons.length} buttons - will STOP after sending`);
        // Message with buttons - send and STOP (wait for user reply)
        return {
          messaging_product: 'whatsapp',
          to: phoneNumber,
          type: 'interactive',
          interactive: {
            type: 'button',
            body: {
              text: interpolateVariables(properties?.label || node.name || 'Choose an option', context)
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
        console.log(`💬 Plain message node - will auto-continue after sending`);
        // Plain message without buttons - send and continue to next node
        const messageText = interpolateVariables(properties?.label || node.name || 'Hello 👋 How can I help you?', context);
        console.log(`📤 Sending message: "${messageText.substring(0, 50)}${messageText.length > 50 ? '...' : ''}"`);

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
      // HTTP Request node - make API call and save response to variable
      console.log(`🌐 HTTP node - preparing API request`);
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
          timeout,
          responseVariable
        } = properties;

        if (url) {
          console.log(`🌐 Making HTTP ${method || 'GET'} request to: ${url}`);

          // Parse custom headers
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
            console.log(`🔐 Using Bearer token authentication`);
          } else if (authType === 'basic' && basicUsername && basicPassword) {
            const credentials = Buffer.from(`${basicUsername}:${basicPassword}`).toString('base64');
            customHeaders['Authorization'] = `Basic ${credentials}`;
            console.log(`🔐 Using Basic authentication`);
          } else if (authType === 'apikey' && apiKeyHeader && apiKeyValue) {
            customHeaders[apiKeyHeader] = apiKeyValue;
            console.log(`🔐 Using API Key authentication (${apiKeyHeader})`);
          }

          // Parse request body
          let requestBody = null;
          if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
            try {
              requestBody = typeof body === 'string' ? JSON.parse(body) : body;
              console.log(`📦 Request body:`, JSON.stringify(requestBody).substring(0, 100));
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
            validateStatus: () => true // Accept any status code
          });

          console.log(`✅ HTTP request completed with status ${response.status}`);
          console.log(`📥 Response data:`, JSON.stringify(response.data).substring(0, 200));

          // Store response in session context if variable name provided
          if (responseVariable) {
            console.log(`💾 Saving response to variable: ${responseVariable}`);
            // Get or create session for this phone number
            const { data: session } = await supabase
              .from('contact_sessions')
              .select('*')
              .eq('phone_number', phoneNumber)
              .eq('status', 'active')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (session) {
              // Save only the response data (not status/headers)
              const updatedContext = {
                ...(session.context || {}),
                [responseVariable]: response.data
              };

              await supabase
                .from('contact_sessions')
                .update({
                  context: updatedContext,
                  last_interaction_at: new Date().toISOString()
                })
                .eq('id', session.id);

              console.log(`✅ Response saved to variable: ${responseVariable}`);
              console.log(`📦 Updated session context:`, JSON.stringify(updatedContext, null, 2));
            } else {
              console.log(`⚠️ No active session found to save variable`);
              console.log(`🔍 Attempting to create session for phone: ${phoneNumber}`);

              // Try to create a session if it doesn't exist
              const { data: contact } = await supabase
                .from('contacts')
                .select('*')
                .eq('phone_number', phoneNumber)
                .maybeSingle();

              if (contact) {
                // Get the flow_id from the current node
                const { data: currentNode } = await supabase
                  .from('nodes')
                  .select('flow_id')
                  .eq('id', node.id)
                  .single();

                const { data: createdSession, error: createError } = await supabase
                  .from('contact_sessions')
                  .insert({
                    contact_id: contact.id,
                    phone_number: phoneNumber,
                    flow_id: currentNode?.flow_id,
                    current_node_id: node.id,
                    status: 'active',
                    context: {
                      [responseVariable]: response.data
                    },
                    last_interaction_at: new Date().toISOString()
                  })
                  .select()
                  .single();

                if (createError) {
                  console.error(`❌ Error creating session:`, createError);
                } else {
                  console.log(`✅ Session created and response saved: ${createdSession.id}`);
                  console.log(`📦 New session context:`, JSON.stringify(createdSession.context, null, 2));
                }
              } else {
                console.error(`❌ Contact not found for phone: ${phoneNumber}`);
              }
            }
          }

          // HTTP node doesn't send a message, continue to next node
          console.log(`🔄 HTTP node completed, moving to next node...`);

          // Get the next node after this HTTP node
          return await getNextNode(false, node.id, phoneNumber);
        }
      } catch (error) {
        console.error('❌ HTTP request failed:', error.message);
        // Continue to next node even on error
        return await getNextNode(false, node.id, phoneNumber);
      }
    } else {
      // Default to text message for other types
      return {
        messaging_product: 'whatsapp',
        to: phoneNumber,
        type: 'text',
        text: {
          body: interpolateVariables(properties?.label || node.name || 'Message', context)
        }
      };
    }
  } catch (error) {
    console.error('Error getting next node:', error);
    // Return default message on error
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
        // Include button text in the message
        const bodyText = messageContent.interactive.body?.text || '';
        const buttons = messageContent.interactive.action?.buttons || [];
        const buttonTexts = buttons.map(btn => btn.reply?.title).filter(Boolean);

        if (buttonTexts.length > 0) {
          messageText = `${bodyText}\n\n${buttonTexts.map((text, idx) => `${idx + 1}. ${text}`).join('\n')}`;
        } else {
          messageText = bodyText;
        }
      } else if (messageContent.interactive?.type === 'list') {
        const bodyText = messageContent.interactive.body?.text || '';
        const sections = messageContent.interactive.action?.sections || [];
        const listItems = sections.flatMap(section =>
          (section.rows || []).map(row => row.title)
        ).filter(Boolean);

        if (listItems.length > 0) {
          messageText = `${bodyText}\n\n${listItems.map((text, idx) => `${idx + 1}. ${text}`).join('\n')}`;
        } else {
          messageText = bodyText;
        }
      }
    }

    if (messageText && phoneNumber) {
      console.log(`[Webhook] Storing bot message: "${messageText.substring(0, 50)}..."`);
      await storeBotMessage(phoneNumber, messageText, null, null, null, 'sent');
      console.log(`[Webhook] ✓ Bot message stored in conversations`);
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
 * Handle template status update webhook
 * Updates template status in database when Meta sends status change notification
 */
async function handleTemplateStatusUpdate(webhookData) {
  try {
    console.log('📋 Processing template status update webhook');

    // Extract template status data from webhook
    const entry = webhookData.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (change?.field !== 'message_template_status_update') {
      console.log('⚠️ Not a template status update webhook');
      return;
    }

    const {
      event,
      message_template_id,
      message_template_name,
      message_template_language,
      reason
    } = value;

    console.log(`📋 Template: ${message_template_name} (${message_template_id})`);
    console.log(`📋 Status: ${event}`);
    console.log(`📋 Reason: ${reason}`);

    // Find template in database by meta_template_id
    const { data: template, error: fetchError } = await supabase
      .from('templates')
      .select('*')
      .eq('meta_template_id', String(message_template_id))
      .maybeSingle();

    if (fetchError) {
      console.error('❌ Error fetching template:', fetchError);
      return;
    }

    if (!template) {
      console.log(`⚠️ Template not found in database: ${message_template_id}`);
      return;
    }

    console.log(`✅ Found template in database: ${template.id} (${template.name})`);

    // Update template status
    const { error: updateError } = await supabase
      .from('templates')
      .update({
        status: event,
        updated_at: new Date().toISOString(),
      })
      .eq('id', template.id);

    if (updateError) {
      console.error('❌ Error updating template status:', updateError);
      return;
    }

    console.log(`✅ Template status updated: ${template.status} -> ${event}`);

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
    // Store webhook data to db.json
    // storeWebhookData(body);

    // Check if this is a WhatsApp message event
    if (body.object === 'whatsapp_business_account') {
      // Check if this is a template status update
      const firstChange = body.entry?.[0]?.changes?.[0];
      if (firstChange?.field === 'message_template_status_update') {
        console.log('📋 Received template status update webhook');
        await handleTemplateStatusUpdate(body);
        return res.sendStatus(200);
      }

      // Loop through entries for regular messages
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

              // Store user message in conversations
              await storeUserMessage(from, message.text.body);

              if (message.text.body.toLowerCase().includes('hi') || message.text.body.toLowerCase().includes('hello')) {
                messageContent = await getNextNode(true, null, from, false, flowId);
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
              const buttonText = message.interactive.button_reply.title;
              console.log(`🔘 Button clicked: ${buttonId}`);

              // Store user button click in conversations
              await storeUserMessage(from, buttonText);

              messageContent = await getNextNode(false, buttonId, from, true, flowId); // true = isButtonClick




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
              // storeWebhookData(messageContent);
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
    const body = req.body;

    // Store webhook data to db.json
    // storeWebhookData(body);

    // Check if this is a WhatsApp message event
    if (body.object === 'whatsapp_business_account') {
      // Check if this is a template status update
      const firstChange = body.entry?.[0]?.changes?.[0];
      if (firstChange?.field === 'message_template_status_update') {
        console.log('📋 Received template status update webhook');
        await handleTemplateStatusUpdate(body);
        return res.sendStatus(200);
      }

      // Loop through entries for regular messages
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

              // Store user message in conversations
              await storeUserMessage(from, message.text.body);

              if (message.text.body.toLowerCase().includes('hi') || message.text.body.toLowerCase().includes('hello')) {
                messageContent = await getNextNode(true, null, from, false, flowId);
              } else {
                await sendTextMessage(from, "Sorry, I didn't understand that. Please type 'Hi' or 'Hello' to see options.");
              }

            } else if (messageType === 'interactive') {
              // User clicked a button
              const buttonId = message.interactive.button_reply.id;
              const buttonText = message.interactive.button_reply.title;
              console.log(`🔘 Button clicked: ${buttonId}`);

              // Store user button click in conversations
              await storeUserMessage(from, buttonText);

              messageContent = await getNextNode(false, buttonId, from, true, flowId); // true = isButtonClick
            }
            if (messageContent) {
              // storeWebhookData(messageContent);
              sendReply(messageContent);
            }
            // Mark message as read
            await markMessageAsRead(messageId);
          }
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
