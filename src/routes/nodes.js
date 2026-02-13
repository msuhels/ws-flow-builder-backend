import { Router } from 'express';
import { protect } from '../middleware/authMiddleware.js';
import supabase from '../config/supabase.js';
import crypto from 'crypto';

const router = Router();

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
});

/**
 * Create Node (Single)
 * POST /api/nodes
 */
router.post('/', protect, async (req, res) => {
  try {
    const { flowId, type, name, position, properties, id } = req.body;

    const { data, error } = await supabase
      .from('nodes')
      .insert({
        id: id || crypto.randomUUID(), // Use provided ID or generate one
        flow_id: flowId,
        type,
        name,
        position,
        properties,
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ success: true, data: mapNode(data) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

/**
 * Update Node
 * PUT /api/nodes/:id
 */
router.put('/:id', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, position, properties, connections } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (type !== undefined) updates.type = type;
    if (position !== undefined) updates.position = position;
    if (properties !== undefined) updates.properties = properties;
    if (connections !== undefined) updates.connections = connections;

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
});

/**
 * Delete Node
 * DELETE /api/nodes/:id
 */
router.delete('/:id', protect, async (req, res) => {
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
});

/**
 * Batch Update Nodes (Sync Flow)
 * POST /api/nodes/batch
 */
router.post('/batch', protect, async (req, res) => {
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

    // 2. Prepare nodes for insertion
    const nodesToInsert = nodes.map((node) => ({
      id: node.id || crypto.randomUUID(), // Ensure we have an ID
      flow_id: flowId,
      type: node.type,
      name: node.name,
      position: node.position,
      properties: node.properties || {},
      connections: node.connections || [],
    }));

    console.log('[Nodes Batch] Inserting nodes:', nodesToInsert.length);

    // 3. Insert new nodes
    const { data, error: insertError } = await supabase
      .from('nodes')
      .insert(nodesToInsert)
      .select();

    if (insertError) {
      console.error('[Nodes Batch] Insert error:', insertError);
      throw insertError;
    }

    console.log('[Nodes Batch] Success! Inserted:', data?.length);
    res.status(200).json({ success: true, data: data.map(mapNode) });
  } catch (error) {
    console.error('[Nodes Batch] Error:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

export default router;
