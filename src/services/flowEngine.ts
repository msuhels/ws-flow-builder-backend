import supabase from '../config/supabase.js';
import axios from 'axios';

// --- Types ---
interface FlowContext {
  [key: string]: any;
}

interface WebhookPayload {
  type: 'message' | 'button_reply' | 'list_reply' | 'status' | 'media';
  from: string; // Phone number
  text?: string;
  payload?: string; // Button ID or List ID
  media?: any;
  messageId?: string;
  status?: string; // sent, delivered, read
}

interface Node {
  id: string;
  type: string;
  properties: any;
  connections: Connection[];
}

interface Connection {
  targetNodeId: string;
  condition?: string;
  sourceHandle?: string;
  buttonIndex?: number; // Which button leads to this connection
}

// Execution trace for debugging
interface ExecutionTrace {
  timestamp: string;
  nodeId: string;
  nodeType: string;
  action: string;
  details?: any;
}

// --- Engine ---

export const FlowEngine = {
  /**
   * Main Entry Point for Webhooks
   */
  async handleIncomingEvent(payload: WebhookPayload) {
    const { from: phoneNumber, type } = payload;
    console.log(`[FlowEngine] Event from ${phoneNumber}: ${type}`, payload);

    try {
      // 1. Handle Status Updates (Delivery/Read) separately
      if (type === 'status') {
        await this.handleStatusUpdate(payload);
        return;
      }

      // 2. Find Active Session
      let session = await this.getSession(phoneNumber);

      // 3. Logic: New Flow vs Continue Flow
      if (!session) {
        // No active session. Check for Start Triggers (Keywords)
        if (type === 'message' && payload.text) {
          await this.checkStartTriggers(phoneNumber, payload.text);
        }
      } else {
        // Active Session. Process Input for Current Node
        await this.processCurrentNodeInput(session, payload);
      }
    } catch (error) {
      console.error('[FlowEngine] Error handling event:', error);
      // Log error to database for debugging
      await this.logError(phoneNumber, 'handleIncomingEvent', error);
    }
  },

  async handleStatusUpdate(payload: WebhookPayload) {
    if (!payload.messageId || !payload.status) return;
    
    try {
      // Update message logs
      await supabase
        .from('message_logs')
        .update({ status: payload.status })
        .eq('wati_message_id', payload.messageId);
    } catch (error) {
      console.error('[FlowEngine] Error updating status:', error);
    }
  },

  async getSession(phoneNumber: string) {
    try {
      const { data } = await supabase
        .from('contact_sessions')
        .select('*')
        .eq('phone_number', phoneNumber)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (!data) return null;
      
      // Check if session has expired (24 hours of inactivity)
      const lastInteraction = new Date(data.last_interaction_at || data.created_at);
      const now = new Date();
      const hoursSinceLastInteraction = (now.getTime() - lastInteraction.getTime()) / (1000 * 60 * 60);
      
      if (hoursSinceLastInteraction > 24) {
        console.log(`[FlowEngine] Session ${data.id} expired after ${hoursSinceLastInteraction.toFixed(1)} hours`);
        await this.endSession(data.id, 'expired');
        return null;
      }
      
      return data;
    } catch (error) {
      console.error('[FlowEngine] Error getting session:', error);
      return null;
    }
  },

  async checkStartTriggers(phoneNumber: string, text: string) {
    const cleanText = text.trim().toLowerCase();
    console.log(`[FlowEngine] Checking triggers for: "${cleanText}"`);

    try {
      // Find flow with matching keyword trigger
      const { data: flows } = await supabase
        .from('flows')
        .select('*')
        .eq('is_active', true)
        .eq('trigger_type', 'keyword');

      if (!flows || flows.length === 0) {
        console.log('[FlowEngine] No active keyword flows found');
        return;
      }

      const matchedFlow = flows.find(f => 
        f.trigger_value && f.trigger_value.toLowerCase() === cleanText
      );

      if (matchedFlow) {
        console.log(`[FlowEngine] ✓ Triggering Flow: ${matchedFlow.name} (ID: ${matchedFlow.id})`);
        await this.startFlow(phoneNumber, matchedFlow.id);
      } else {
        console.log('[FlowEngine] No matching flow trigger found');
      }
    } catch (error) {
      console.error('[FlowEngine] Error checking triggers:', error);
    }
  },

  async startFlow(phoneNumber: string, flowId: string, initialData: any = {}) {
    console.log(`[FlowEngine] Starting flow ${flowId} for ${phoneNumber}`);
    
    try {
      // 1. Get or Create Contact
      console.log('[FlowEngine] Step 1: Getting/creating contact...');
      let { data: contact } = await supabase
          .from('contacts')
          .select('id')
          .eq('phone_number', phoneNumber)
          .maybeSingle();

      if (!contact) {
          console.log('[FlowEngine] Contact not found, creating new...');
          const { data: newContact, error: contactError } = await supabase
              .from('contacts')
              .insert({ phone_number: phoneNumber })
              .select('id')
              .single();
          
          if (contactError) {
            console.error('[FlowEngine] Error creating contact:', contactError);
            throw contactError;
          }
          contact = newContact;
          console.log('[FlowEngine] Contact created:', contact?.id);
      } else {
        console.log('[FlowEngine] Contact found:', contact.id);
      }

      if (!contact) {
        throw new Error('Failed to create/get contact');
      }

      // 2. Fetch Flow with first_node_id
      console.log('[FlowEngine] Step 2: Fetching flow...');
      const { data: flow, error: flowError } = await supabase
          .from('flows')
          .select('*')
          .eq('id', flowId)
          .single();

      if (flowError || !flow) {
        console.error('[FlowEngine] Flow not found:', flowError);
        throw new Error(`Flow ${flowId} not found`);
      }
      
      console.log('[FlowEngine] Flow found:', flow.name, 'first_node_id:', flow.first_node_id);

      // 3. Get first node ID from flow
      const firstNodeId = flow.first_node_id;
      
      if (!firstNodeId) {
        console.error('[FlowEngine] Flow has no first_node_id set');
        return;
      }

      // 4. Fetch all nodes for this flow
      console.log('[FlowEngine] Step 3: Fetching nodes...');
      const { data: nodes, error: nodesError } = await supabase
          .from('nodes')
          .select('*')
          .eq('flow_id', flowId);

      if (nodesError) {
        console.error('[FlowEngine] Error fetching nodes:', nodesError);
        throw nodesError;
      }
      if (!nodes || nodes.length === 0) {
        console.error('[FlowEngine] Flow has no nodes');
        return;
      }
      
      console.log('[FlowEngine] Found', nodes.length, 'nodes');

      // 5. Verify first node exists
      const firstNode = nodes.find(n => n.id === firstNodeId);
      if (!firstNode) {
        console.error(`[FlowEngine] First node ${firstNodeId} not found in flow nodes`);
        return;
      }
      
      console.log('[FlowEngine] First node found:', firstNode.type, firstNode.name);

      // 6. Create Session
      console.log('[FlowEngine] Step 4: Creating session...');
      const { data: session, error: sessionError } = await supabase
          .from('contact_sessions')
          .insert({
              contact_id: contact.id,
              phone_number: phoneNumber,
              flow_id: flowId,
              current_node_id: firstNodeId,
              status: 'active',
              context: initialData,
              execution_trace: []
          })
          .select('*')
          .single();

      if (sessionError) {
        console.error('[FlowEngine] Error creating session:', sessionError);
        throw sessionError;
      }

      console.log(`[FlowEngine] ✓ Session created: ${session.id}`);

      // 7. Execute First Node
      console.log('[FlowEngine] Step 5: Executing first node...');
      console.log('[FlowEngine] First node properties:', JSON.stringify(firstNode.properties));
      await this.executeNode(session, firstNodeId, nodes);
      console.log('[FlowEngine] ✓ Flow started successfully');
    } catch (error) {
      console.error('[FlowEngine] Error starting flow:', error);
      await this.logError(phoneNumber, 'startFlow', error);
    }
  },

  async processCurrentNodeInput(session: any, payload: WebhookPayload) {
    console.log(`[FlowEngine] Processing input for session ${session.id}, node ${session.current_node_id}`);
    
    try {
      // Fetch all nodes for context
      const { data: nodes } = await supabase
          .from('nodes')
          .select('*')
          .eq('flow_id', session.flow_id);

      if (!nodes || nodes.length === 0) {
        console.error('[FlowEngine] No nodes found for flow');
        await this.endSession(session.id, 'error');
        return;
      }

      const currentNode = nodes.find(n => n.id === session.current_node_id);
      if (!currentNode) {
          console.error(`[FlowEngine] Current node ${session.current_node_id} not found`);
          await this.endSession(session.id, 'error');
          return;
      }

      console.log(`[FlowEngine] Current node type: ${currentNode.type}`);

      let nextNodeId: string | null = null;
      let variableUpdate: any = {};

      // Handle different node types
      if (currentNode.type === 'input') {
          // Handle User Input
          const variableName = currentNode.properties.variableName;
          const inputType = currentNode.properties.inputType || 'text';

          let capturedValue = null;
          if (inputType === 'text' && payload.text) {
            capturedValue = payload.text;
          } else if (inputType === 'number' && payload.text && !isNaN(Number(payload.text))) {
            capturedValue = Number(payload.text);
          } else if (inputType === 'email' && payload.text) {
            // Basic email validation
            if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.text)) {
              capturedValue = payload.text;
            }
          } else if (inputType === 'phone' && payload.text) {
            capturedValue = payload.text;
          }

          if (capturedValue !== null) {
              if (variableName) {
                  variableUpdate[variableName] = capturedValue;
              }
              
              await this.addExecutionTrace(session.id, {
                timestamp: new Date().toISOString(),
                nodeId: currentNode.id,
                nodeType: currentNode.type,
                action: 'input_captured',
                details: { variable: variableName, value: capturedValue }
              });

              // Move to next node (default connection)
              if (currentNode.connections && currentNode.connections.length > 0) {
                  nextNodeId = currentNode.connections[0].targetNodeId;
              }
          } else {
              // Invalid input. Send retry message
              await this.sendMessage(session.phone_number, {
                label: currentNode.properties.invalidMessage || "Invalid input. Please try again."
              });
              return; 
          }

      } else if (currentNode.type === 'button' || currentNode.type === 'message') {
          // Handle Button/List Reply
          if (payload.type === 'button_reply' && payload.payload) {
              // Parse button payload: format is "nodeId_btn_index"
              const buttonPayload = payload.payload;
              console.log(`[FlowEngine] Button payload: ${buttonPayload}`);
              
              // Extract button index from payload
              const match = buttonPayload.match(/_btn_(\d+)$/);
              if (match) {
                const buttonIndex = parseInt(match[1]);
                console.log(`[FlowEngine] Button index: ${buttonIndex}`);
                
                // Find connection for this button
                const connection = currentNode.connections?.find(
                  (c: Connection) => c.buttonIndex === buttonIndex
                );
                
                if (connection) {
                  nextNodeId = connection.targetNodeId;
                  console.log(`[FlowEngine] ✓ Routing to node: ${nextNodeId}`);
                  
                  await this.addExecutionTrace(session.id, {
                    timestamp: new Date().toISOString(),
                    nodeId: currentNode.id,
                    nodeType: currentNode.type,
                    action: 'button_clicked',
                    details: { buttonIndex, targetNode: nextNodeId, buttonText: payload.text }
                  });
                } else {
                  console.error(`[FlowEngine] No connection found for button index ${buttonIndex}`);
                  // Fallback to first connection
                  if (currentNode.connections && currentNode.connections.length > 0) {
                    nextNodeId = currentNode.connections[0].targetNodeId;
                  }
                }
              } else {
                console.error(`[FlowEngine] Invalid button payload format: ${buttonPayload}`);
                // Fallback to first connection
                if (currentNode.connections && currentNode.connections.length > 0) {
                  nextNodeId = currentNode.connections[0].targetNodeId;
                }
              }
          } else if (payload.type === 'list_reply' && payload.payload) {
              // Similar logic for list replies
              const listPayload = payload.payload;
              const match = listPayload.match(/_list_(\d+)$/);
              if (match) {
                const listIndex = parseInt(match[1]);
                const connection = currentNode.connections?.find(
                  (c: Connection) => c.buttonIndex === listIndex
                );
                if (connection) {
                  nextNodeId = connection.targetNodeId;
                  
                  await this.addExecutionTrace(session.id, {
                    timestamp: new Date().toISOString(),
                    nodeId: currentNode.id,
                    nodeType: currentNode.type,
                    action: 'list_selected',
                    details: { listIndex, targetNode: nextNodeId, listText: payload.text }
                  });
                }
              }
          } else {
              // Text message received when expecting button - might be user typing instead
              console.log('[FlowEngine] Text received when expecting button/list');
              // Could either ignore or treat as invalid
              return;
          }
      } else if (currentNode.type === 'condition') {
          // Evaluate condition and route accordingly
          const result = await this.evaluateCondition(currentNode, session.context);
          const handle = result ? 'true' : 'false';
          
          const connection = currentNode.connections?.find(
            (c: Connection) => c.sourceHandle === handle
          );
          
          if (connection) {
            nextNodeId = connection.targetNodeId;
          }
          
          await this.addExecutionTrace(session.id, {
            timestamp: new Date().toISOString(),
            nodeId: currentNode.id,
            nodeType: currentNode.type,
            action: 'condition_evaluated',
            details: { result, targetNode: nextNodeId }
          });
      }

      // Update Context if needed
      if (Object.keys(variableUpdate).length > 0) {
          const newContext = { ...session.context, ...variableUpdate };
          await supabase
              .from('contact_sessions')
              .update({ context: newContext })
              .eq('id', session.id);
              
          // Update contact attributes
          const { data: contact } = await supabase
              .from('contacts')
              .select('attributes')
              .eq('phone_number', session.phone_number)
              .single();
              
          if (contact) {
            const updatedAttributes = { ...contact.attributes, ...variableUpdate };
            await supabase
                .from('contacts')
                .update({ attributes: updatedAttributes })
                .eq('phone_number', session.phone_number);
          }
          
          // Refresh session with new context
          session.context = newContext;
      }

      if (nextNodeId) {
          await this.advanceToNode(session, nextNodeId, nodes);
      } else {
          console.log('[FlowEngine] No next node, ending session');
          await this.endSession(session.id);
      }
    } catch (error) {
      console.error('[FlowEngine] Error processing input:', error);
      await this.logError(session.phone_number, 'processCurrentNodeInput', error);
    }
  },

  async executeNode(session: any, nodeId: string, allNodes: any[]) {
    const node = allNodes.find(n => n.id === nodeId);
    if (!node) {
        console.error(`[FlowEngine] Node ${nodeId} not found`);
        await this.endSession(session.id, 'error');
        return;
    }

    console.log(`[FlowEngine] Executing node: ${node.id} (${node.type})`);

    try {
      // Update Session to Current Node
      await supabase
          .from('contact_sessions')
          .update({ 
            current_node_id: nodeId, 
            last_interaction_at: new Date().toISOString() 
          })
          .eq('id', session.id);

      // Add execution trace
      await this.addExecutionTrace(session.id, {
        timestamp: new Date().toISOString(),
        nodeId: node.id,
        nodeType: node.type,
        action: 'node_entered',
        details: { nodeName: node.name }
      });

      // EXECUTE ACTIONS based on Node Type
      switch (node.type) {
          case 'message':
          case 'button':
          case 'list':
              await this.sendMessage(session.phone_number, node.properties, node.id, node.connections, session.context);
              
              // If message has buttons/lists, STOP and wait for input
              const hasInteractive = (node.properties.buttons && node.properties.buttons.length > 0) ||
                                    (node.properties.listItems && node.properties.listItems.length > 0);
              
              if (!hasInteractive) {
                   // Auto-advance for plain messages
                   await this.advanceToDefaultNext(session, node, allNodes);
              } else {
                console.log('[FlowEngine] Waiting for user interaction (buttons/list)');
              }
              break;

          case 'input':
              // Send prompt message with variable interpolation
              const promptMessage = this.interpolateVariables(
                node.properties.label || node.properties.message || 'Please provide your input:',
                session.context
              );
              await this.sendMessage(session.phone_number, { 
                label: promptMessage
              }, node.id, node.connections, session.context);
              // STOP and wait for input
              console.log('[FlowEngine] Waiting for user input');
              break;

          case 'condition':
              // Evaluate condition immediately
              const result = await this.evaluateCondition(node, session.context);
              const handle = result ? 'true' : 'false';
              
              const connection = node.connections?.find(
                (c: Connection) => c.sourceHandle === handle
              );
              
              if (connection) {
                await this.advanceToNode(session, connection.targetNodeId, allNodes);
              } else {
                await this.advanceToDefaultNext(session, node, allNodes);
              }
              break;

          case 'delay':
              // For now, skip delays (would need job queue for production)
              console.log('[FlowEngine] Delay node - skipping for now');
              await this.advanceToDefaultNext(session, node, allNodes);
              break;
              
          case 'tag':
              const { action, tags } = node.properties;
              if (tags && tags.length > 0) {
                // Update contact tags
                const { data: contact } = await supabase
                  .from('contacts')
                  .select('tags')
                  .eq('phone_number', session.phone_number)
                  .single();
                  
                if (contact) {
                  let currentTags = contact.tags || [];
                  if (action === 'add') {
                    currentTags = [...new Set([...currentTags, ...tags])];
                  } else if (action === 'remove') {
                    currentTags = currentTags.filter((t: string) => !tags.includes(t));
                  }
                  
                  await supabase
                    .from('contacts')
                    .update({ tags: currentTags })
                    .eq('phone_number', session.phone_number);
                }
              }
              await this.advanceToDefaultNext(session, node, allNodes);
              break;
              
          case 'webhook':
              try {
                  const { url, method, headers } = node.properties;
                  if (url) {
                      const webhookData = {
                        phoneNumber: session.phone_number,
                        context: session.context,
                        flowId: session.flow_id,
                        sessionId: session.id
                      };
                      
                      await axios({
                        method: method || 'POST',
                        url,
                        data: webhookData,
                        headers: headers || {},
                        timeout: 10000
                      });
                      
                      console.log('[FlowEngine] ✓ Webhook fired successfully');
                  }
              } catch (e) {
                console.error('[FlowEngine] Webhook failed:', e);
              }
              await this.advanceToDefaultNext(session, node, allNodes);
              break;
              
          case 'handoff':
              const handoffMessage = this.interpolateVariables(
                node.properties.message || 'Transferring you to an agent...',
                session.context
              );
              await this.sendMessage(session.phone_number, {
                label: handoffMessage
              }, node.id, node.connections, session.context);
              await this.endSession(session.id, 'paused');
              // TODO: Notify agent system
              break;

          case 'note':
              // Internal only, skip
              await this.advanceToDefaultNext(session, node, allNodes);
              break;

          default:
              console.log(`[FlowEngine] Unknown node type: ${node.type}`);
              await this.advanceToDefaultNext(session, node, allNodes);
      }
    } catch (err) {
        console.error('[FlowEngine] Error executing node:', err);
        await this.logError(session.phone_number, 'executeNode', err);
        await this.endSession(session.id, 'error');
    }
  },

  async advanceToDefaultNext(session: any, currentNode: any, allNodes: any[]) {
      if (currentNode.connections && currentNode.connections.length > 0) {
          const nextId = currentNode.connections[0].targetNodeId;
          console.log(`[FlowEngine] Auto-advancing to: ${nextId}`);
          await this.executeNode(session, nextId, allNodes);
      } else {
          console.log('[FlowEngine] End of flow reached');
          await this.endSession(session.id);
      }
  },

  async advanceToNode(session: any, nextNodeId: string, allNodes: any[]) {
      await this.executeNode(session, nextNodeId, allNodes);
  },

  async endSession(sessionId: string, status = 'completed') {
      console.log(`[FlowEngine] Ending session ${sessionId} with status: ${status}`);
      await supabase
        .from('contact_sessions')
        .update({ 
          status,
          ended_at: new Date().toISOString()
        })
        .eq('id', sessionId);
      
      // Update contact last interaction time
      const { data: session } = await supabase
        .from('contact_sessions')
        .select('phone_number')
        .eq('id', sessionId)
        .single();
        
      if (session) {
        await supabase
          .from('contacts')
          .update({ 
            last_interaction_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('phone_number', session.phone_number);
      }
  },

  interpolateVariables(text: string, context: any): string {
    if (!text) return text;
    
    // Replace {{variableName}} with actual values from context
    return text.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
      const value = context[varName];
      return value !== undefined && value !== null ? String(value) : match;
    });
  },

  async sendMessage(to: string, content: any, nodeId?: string, connections?: Connection[], context?: any) {
    console.log(`[FlowEngine] Sending message to: ${to}`);

    try {
      // 1. Get Config
      const { data: config } = await supabase
        .from('api_config')
        .select('*')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      const hasConfig = config && config.api_key && config.business_number_id;
      
      if (!hasConfig) {
          console.log('[FlowEngine] No API Config - Test Mode (will log message only)');
      }

      const version = 'v17.0';
      const url = hasConfig ? `https://graph.facebook.com/${version}/${config.business_number_id}/messages` : '';
      
      // 2. Construct Payload
      let payload: any = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: to,
      };

      if (content.buttons && content.buttons.length > 0) {
          // Interactive Message (Buttons) - Map buttons to connections
          payload.type = 'interactive';
          
          const bodyText = this.interpolateVariables(
            content.label || content.message || 'Please select an option:', 
            context || {}
          );
          
          payload.interactive = {
              type: 'button',
              body: { text: bodyText },
              action: {
                  buttons: content.buttons.slice(0, 3).map((btn: any, idx: number) => ({
                      type: 'reply',
                      reply: {
                          // CRITICAL: Include nodeId in button ID for routing
                          id: `${nodeId}_btn_${idx}`,
                          title: this.interpolateVariables(btn.text, context || {}).substring(0, 20)
                      }
                  }))
              }
          };
          
          // Add header if exists
          if (content.header) {
            payload.interactive.header = { 
              type: 'text', 
              text: this.interpolateVariables(content.header, context || {})
            };
          }
          
          // Add footer if exists
          if (content.footer) {
            payload.interactive.footer = { 
              text: this.interpolateVariables(content.footer, context || {})
            };
          }

      } else if (content.listItems && content.listItems.length > 0) {
          // Interactive Message (List)
          payload.type = 'interactive';
          
          const bodyText = this.interpolateVariables(
            content.label || content.message || 'Please select an option:', 
            context || {}
          );
          
          payload.interactive = {
              type: 'list',
              body: { text: bodyText },
              action: {
                  button: this.interpolateVariables(content.buttonText || 'Select', context || {}),
                  sections: [{
                      title: this.interpolateVariables(content.sectionTitle || 'Options', context || {}),
                      rows: content.listItems.slice(0, 10).map((item: any, idx: number) => ({
                          id: `${nodeId}_list_${idx}`,
                          title: this.interpolateVariables(item.title, context || {}).substring(0, 24),
                          description: this.interpolateVariables(item.description || '', context || {}).substring(0, 72)
                      }))
                  }]
              }
          };
          
          if (content.header) {
            payload.interactive.header = { 
              type: 'text', 
              text: this.interpolateVariables(content.header, context || {})
            };
          }

      } else if (content.label || content.message) {
          // Simple Text
          payload.type = 'text';
          payload.text = { 
            body: this.interpolateVariables(content.label || content.message, context || {})
          };
      } else {
          console.error('[FlowEngine] Invalid message content:', JSON.stringify(content));
          return;
      }

      // 3. Send Request (only if config exists)
      let waMessageId = null;
      let status = 'sent';
      
      if (hasConfig) {
        try {
          const response = await axios.post(url, payload, {
              headers: {
                  'Authorization': `Bearer ${config.api_key}`,
                  'Content-Type': 'application/json'
              }
          });
          
          waMessageId = response.data.messages?.[0]?.id;
          console.log(`[FlowEngine] ✓ Message sent to WhatsApp, ID: ${waMessageId}`);
        } catch (error: any) {
          console.error('[FlowEngine] WhatsApp API Error:', error.response?.data || error.message);
          status = 'failed';
        }
      } else {
        console.log(`[FlowEngine] ✓ Test mode - message logged (not sent to WhatsApp)`);
      }
      
      // 4. Log message to database (always, even in test mode)
      await supabase.from('message_logs').insert({
          phone_number: to,
          message_type: payload.type,
          content: content,
          status: status,
          wati_message_id: waMessageId,
      });

    } catch (error: any) {
        console.error('[FlowEngine] Send Error:', error.response?.data || error.message);
        await supabase.from('message_logs').insert({
            phone_number: to,
            message_type: 'error',
            content: { error: error.message },
            status: 'failed',
        });
    }
  },
  
  async evaluateCondition(node: any, context: any): Promise<boolean> {
    // Simple condition evaluation
    const { variable, operator, value } = node.properties;
    
    if (!variable || !operator) return true; // Default to true if not configured
    
    const contextValue = context[variable];
    
    switch (operator) {
      case 'equals':
        return contextValue == value;
      case 'not_equals':
        return contextValue != value;
      case 'contains':
        return String(contextValue).includes(String(value));
      case 'greater_than':
        return Number(contextValue) > Number(value);
      case 'less_than':
        return Number(contextValue) < Number(value);
      case 'exists':
        return contextValue !== undefined && contextValue !== null;
      case 'not_exists':
        return contextValue === undefined || contextValue === null;
      default:
        return true;
    }
  },
  
  async addExecutionTrace(sessionId: string, trace: ExecutionTrace) {
    try {
      const { data: session } = await supabase
        .from('contact_sessions')
        .select('execution_trace')
        .eq('id', sessionId)
        .single();
        
      if (session) {
        const traces = session.execution_trace || [];
        traces.push(trace);
        
        await supabase
          .from('contact_sessions')
          .update({ execution_trace: traces })
          .eq('id', sessionId);
      }
    } catch (error) {
      console.error('[FlowEngine] Error adding execution trace:', error);
    }
  },
  
  async logError(phoneNumber: string, context: string, error: any) {
    try {
      await supabase.from('error_logs').insert({
        phone_number: phoneNumber,
        context: context,
        error_message: error.message || String(error),
        error_stack: error.stack,
        timestamp: new Date().toISOString()
      });
    } catch (e) {
      console.error('[FlowEngine] Failed to log error:', e);
    }
  }
};
