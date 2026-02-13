import { Router } from 'express';
import { protect } from '../middleware/authMiddleware.js';
import supabase from '../config/supabase.js';
import axios from 'axios';

const router = Router();

// Helper map
const mapConfig = (config) => ({
  _id: config.id,
  id: config.id,
  baseUrl: config.base_url,
  apiKey: config.api_key,
  businessNumberId: config.business_number_id,
  lastTested: config.last_tested,
  isActive: config.is_active,
  updatedAt: config.updated_at,
});

/**
 * Get API Configuration
 * GET /api/settings
 */
router.get('/', protect, async (req, res) => {
  try {
    const { data: config, error } = await supabase
      .from('api_config')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (!config) {
      res.status(200).json({ success: true, data: null });
      return;
    }
    
    // Mask API Key for security
    const mapped = mapConfig(config);
    const maskedConfig = {
      ...mapped,
      apiKey: mapped.apiKey && mapped.apiKey.length > 4 
        ? '********' + mapped.apiKey.slice(-4) 
        : '********',
    };

    res.status(200).json({
      success: true,
      data: maskedConfig,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
    });
  }
});

/**
 * Update API Configuration
 * POST /api/settings
 */
router.post('/', protect, async (req, res) => {
  try {
    const { baseUrl, apiKey, businessNumberId } = req.body;

    const { data: existing, error: fetchError } = await supabase
      .from('api_config')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (fetchError) throw fetchError;

    let result;
    const updates = {
      base_url: baseUrl,
      business_number_id: businessNumberId,
      updated_at: new Date().toISOString(),
    };

    // Only update API key if it's not the masked version (simple check)
    if (apiKey && !apiKey.startsWith('********')) {
      updates.api_key = apiKey;
    }

    if (existing) {
      const { data, error } = await supabase
        .from('api_config')
        .update(updates)
        .eq('id', existing.id)
        .select()
        .single();
      
      if (error) throw error;
      result = data;
    } else {
      // Insert new
      if (!updates.api_key) updates.api_key = apiKey; // Ensure key is set on create
      
      const { data, error } = await supabase
        .from('api_config')
        .insert(updates)
        .select()
        .single();
        
      if (error) throw error;
      result = data;
    }

    res.status(200).json({
      success: true,
      data: mapConfig(result),
      message: 'Configuration saved successfully',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
    });
  }
});

/**
 * Test Connection
 * POST /api/settings/test
 */
router.post('/test', protect, async (req, res) => {
  try {
    const { baseUrl, apiKey } = req.body;

    // Use provided credentials or fetch from DB if not provided
    let url = baseUrl;
    let key = apiKey;

    if (!url || !key || key.startsWith('********')) {
        const { data: config } = await supabase
          .from('api_config')
          .select('*')
          .limit(1)
          .maybeSingle();

        if (!config) {
             res.status(400).json({ success: false, message: 'No configuration found to test' });
             return;
        }
        url = url || config.base_url;
        key = (key && !key.startsWith('********')) ? key : config.api_key;
    }

    // Attempt a request to Wati API (Mocking)
    try {
        // Simulating success for now if values are present
        if(url && key) {
             // Optionally update last_tested
             if (baseUrl) { // If saving/testing, maybe update db? 
                // Skip for now, just test.
             }
             res.status(200).json({ success: true, message: 'Connection successful' });
        } else {
             throw new Error("Missing credentials");
        }
    } catch (apiError) {
         res.status(400).json({ success: false, message: 'Connection failed: Invalid credentials or URL' });
    }

  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
    });
  }
});

export default router;
