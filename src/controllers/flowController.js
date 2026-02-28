import supabase from '../config/supabase.js';

// Helper to convert snake_case to camelCase for Flow
const mapFlow = (flow) => ({
  _id: flow.id,
  id: flow.id,
  name: flow.name,
  description: flow.description,
  triggerType: flow.trigger_type,
  triggerValue: flow.trigger_value,
  isActive: flow.is_active,
  firstNodeId: flow.first_node_id,
  createdAt: flow.created_at,
  updatedAt: flow.updated_at,
});

// Helper for Node mapping
const mapNode = (node) => ({
  _id: node.id,
  id: node.id,
  flowId: node.flow_id,
  type: node.type,
  name: node.name,
  properties: node.properties,
  connections: node.connections,
  position: node.position,
  createdAt: node.created_at,
});

/**
 * Get All Flows
 */
export const getAllFlows = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('flows')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const flows = data.map(mapFlow);
    res.status(200).json({ success: true, data: flows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

/**
 * Create New Flow
 */
export const createFlow = async (req, res) => {
  try {
    const { name, description, triggerType, triggerValue } = req.body;

    const { data, error } = await supabase
      .from('flows')
      .insert({
        name,
        description,
        trigger_type: triggerType,
        trigger_value: triggerValue,
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ success: true, data: mapFlow(data) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

/**
 * Get Flow by ID
 */
export const getFlowById = async (req, res) => {
  try {
    const { id } = req.params;

    // Get Flow
    const { data: flow, error: flowError } = await supabase
      .from('flows')
      .select('*')
      .eq('id', id)
      .single();

    if (flowError || !flow) {
      res.status(404).json({ success: false, message: 'Flow not found' });
      return;
    }

    // Get Nodes
    const { data: nodes, error: nodesError } = await supabase
      .from('nodes')
      .select('*')
      .eq('flow_id', id);

    if (nodesError) throw nodesError;

    // Add virtual start node with connections to first real node
    const allNodes = nodes ? [...nodes] : [];
    
    // Create start node with connection to first node if exists
    const startNodeConnections = flow.first_node_id 
      ? [{ targetNodeId: flow.first_node_id }]
      : [];
    
    const startNode = {
      id: 'start-node',
      flow_id: id,
      type: 'start',
      name: 'Start',
      properties: {
        triggerType: flow.trigger_type,
        triggerValue: flow.trigger_value,
        webhookUrl: `${process.env.API_URL || 'http://localhost:3001'}/api/webhooks/trigger/${id}`
      },
      connections: startNodeConnections,
      position: { x: 100, y: 100 },
      created_at: flow.created_at
    };

    res.status(200).json({
      success: true,
      data: {
        ...mapFlow(flow),
        webhookUrl: `${process.env.API_URL || 'http://localhost:3001'}/api/webhooks/trigger/${id}`,
        nodes: [startNode, ...allNodes.map(mapNode)],
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

/**
 * Update Flow
 */
export const updateFlow = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, triggerType, triggerValue, isActive, firstNodeId } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (triggerType !== undefined) updates.trigger_type = triggerType;
    if (triggerValue !== undefined) updates.trigger_value = triggerValue;
    if (isActive !== undefined) updates.is_active = isActive;
    if (firstNodeId !== undefined) updates.first_node_id = firstNodeId;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('flows')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.status(200).json({ success: true, data: mapFlow(data) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

/**
 * Delete Flow
 */
export const deleteFlow = async (req, res) => {
  try {
    const { id } = req.params;

    // Nodes are set to CASCADE delete in SQL, so deleting flow is enough
    const { error } = await supabase
      .from('flows')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.status(200).json({ success: true, message: 'Flow removed' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

/**
 * Get Available Variables for a Flow
 * Scans all nodes in the flow to find variables that can be used
 */
export const getFlowVariables = async (req, res) => {
  try {
    const { id } = req.params;

    // Get all nodes in the flow
    const { data: nodes, error } = await supabase
      .from('nodes')
      .select('*')
      .eq('flow_id', id);

    if (error) throw error;

    const variables = [];

    // Scan nodes for variables
    if (nodes) {
      nodes.forEach(node => {
        const properties = node.properties || {};

        // Input nodes create variables
        if (node.type === 'input' && properties.variableName) {
          variables.push({
            name: properties.variableName,
            type: properties.inputType || 'text',
            description: `User input from: ${node.name || 'Input node'}`,
            source: 'input',
            nodeId: node.id
          });
        }

        // HTTP nodes create variables
        if (node.type === 'http' && properties.responseVariable) {
          variables.push({
            name: properties.responseVariable,
            type: 'object',
            description: `API response data from: ${properties.label || properties.url || 'HTTP request'}`,
            source: 'http',
            nodeId: node.id
          });
        }
      });
    }

    // Add default system variables
    const systemVariables = [
      { name: 'phone_number', type: 'string', description: 'User phone number', source: 'system' },
      { name: 'customer_name', type: 'string', description: 'Customer name', source: 'system' },
      { name: 'email', type: 'string', description: 'Email address', source: 'system' }
    ];

    res.status(200).json({
      success: true,
      data: {
        flowId: id,
        variables: [...systemVariables, ...variables]
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};
