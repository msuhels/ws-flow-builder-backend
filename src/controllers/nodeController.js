import supabase from '../config/supabase.js';
import crypto from 'crypto';

// Helper mapping
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
  nodeId: node.node_id,
  previousNodeId: node.previous_node_id,
});

/**
 * Create Node (Single)
 */
export const createNode = async (req, res) => {
  try {
    const { flowId, type, name, position, properties, id, previous_node_id } = req.body;

    const { data, error } = await supabase
      .from('nodes')
      .insert({
        id: id || crypto.randomUUID(),
        flow_id: flowId,
        type,
        name,
        position,
        properties,
        previous_node_id: previous_node_id || null,
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ success: true, data: mapNode(data) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

/**
 * Update Node
 */
export const updateNode = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, position, properties, connections, previous_node_id } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (type !== undefined) updates.type = type;
    if (position !== undefined) updates.position = position;
    if (properties !== undefined) updates.properties = properties;
    if (connections !== undefined) updates.connections = connections;
    if (previous_node_id !== undefined) updates.previous_node_id = previous_node_id;

    const { data, error } = await supabase
      .from('nodes')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.status(200).json({ success: true, data: mapNode(data) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

/**
 * Delete Node
 */
export const deleteNode = async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('nodes')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.status(200).json({ success: true, message: 'Node removed' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

/**
 * Batch Update Nodes (Sync Flow)
 */
export const batchUpdateNodes = async (req, res) => {
  try {
    const { flowId, nodes } = req.body;

    console.log('[Nodes Batch] Request:', { flowId, nodeCount: nodes?.length });

    if (!flowId) {
      res.status(400).json({ success: false, message: 'Flow ID required' });
      return;
    }

    // 1. Delete existing nodes for this flow
    console.log('[Nodes Batch] Deleting existing nodes for flow:', flowId);
    const { error: deleteError } = await supabase
      .from('nodes')
      .delete()
      .eq('flow_id', flowId);

    if (deleteError) {
      console.error('[Nodes Batch] Delete error:', deleteError);
      throw deleteError;
    }

    if (!nodes || nodes.length === 0) {
      console.log('[Nodes Batch] No nodes to insert');
      res.status(200).json({ success: true, data: [] });
      return;
    }

    // 2. Prepare nodes for insertion (without previous_node_id first)
    const nodesToInsert = nodes.map((node) => ({
      id: node.id || crypto.randomUUID(),
      flow_id: flowId,
      type: node.type,
      name: node.name,
      position: node.position,
      properties: node.properties || {},
      connections: node.connections || [],
      previous_node_id: null,
    }));

    console.log('[Nodes Batch] Inserting nodes:', nodesToInsert.length);

    // 3. Insert new nodes (this generates node_id for each)
    const { data: insertedNodes, error: insertError } = await supabase
      .from('nodes')
      .insert(nodesToInsert)
      .select();

    if (insertError) {
      console.error('[Nodes Batch] Insert error:', insertError);
      throw insertError;
    }

    console.log('[Nodes Batch] Nodes inserted, now updating previous_node_id...');

    // 4. Create a map of id -> node_id for quick lookup
    const idToNodeIdMap = {};
    insertedNodes.forEach(node => {
      idToNodeIdMap[node.id] = node.node_id;
    });

    // 5. Update previous_node_id for each node
    const updatePromises = nodes.map(async (node) => {
      if (node.previous_node_id) {
        let actualPreviousNodeId = node.previous_node_id;
        
        // Check if previous_node_id is a button ID (UUID format but not in our node map)
        // If it's in our map, it's a node id that needs to be converted to node_id
        if (idToNodeIdMap[node.previous_node_id]) {
          actualPreviousNodeId = idToNodeIdMap[node.previous_node_id];
        }
        // Otherwise it's already a btn_id, keep it as is

        console.log(`[Nodes Batch] Updating node ${node.id}: previous_node_id = ${actualPreviousNodeId}`);

        const { error: updateError } = await supabase
          .from('nodes')
          .update({ previous_node_id: actualPreviousNodeId })
          .eq('id', node.id);

        if (updateError) {
          console.error('[Nodes Batch] Update error for node:', node.id, updateError);
        }
      }
    });

    await Promise.all(updatePromises);

    // 6. Fetch final updated nodes
    const { data: finalNodes, error: fetchError } = await supabase
      .from('nodes')
      .select()
      .eq('flow_id', flowId);

    if (fetchError) {
      console.error('[Nodes Batch] Fetch error:', fetchError);
      throw fetchError;
    }

    console.log('[Nodes Batch] Success! Final nodes:', finalNodes?.length);
    res.status(200).json({ success: true, data: finalNodes.map(mapNode) });
  } catch (error) {
    console.error('[Nodes Batch] Error:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};
