import supabase from '../config/supabase.js';
import { sendSuccess, sendError } from '../utils/response.js';
import axios from 'axios';

// Get all templates
export const getTemplates = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('templates')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase error:', error);
      if (error.message && error.message.includes('relation "templates" does not exist')) {
        return sendError(res, 'Templates table not found. Please run the database migration first.', 500);
      }
      throw error;
    }

    return sendSuccess(res, data || [], 'Templates fetched successfully');
  } catch (error) {
    console.error('Get templates error:', error);
    return sendError(res, error.message || 'Failed to fetch templates', 500);
  }
};

// Get single template by ID
export const getTemplateById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('templates')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return sendError(res, 'Template not found', 404);
    }

    return sendSuccess(res, data, 'Template fetched successfully');
  } catch (error) {
    console.error('Get template error:', error);
    return sendError(res, error.message || 'Failed to fetch template', 500);
  }
};

// Update template (only if status is DRAFT)
export const updateTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, language, category, headerText, bodyText, footerText, buttons } = req.body;

    // Get existing template
    const { data: existingTemplate, error: fetchError } = await supabase
      .from('templates')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existingTemplate) {
      return sendError(res, 'Template not found', 404);
    }

    // Check if template is in DRAFT status
    if (existingTemplate.status !== 'DRAFT') {
      return sendError(res, 'Only DRAFT templates can be edited', 400);
    }

    // Build components array
    const components = [];

    if (headerText) {
      components.push({
        type: 'HEADER',
        format: 'TEXT',
        text: headerText,
      });
    }

    components.push({
      type: 'BODY',
      text: bodyText,
    });

    if (footerText) {
      components.push({
        type: 'FOOTER',
        text: footerText,
      });
    }

    if (buttons && buttons.length > 0) {
      components.push({
        type: 'BUTTONS',
        buttons: buttons,
      });
    }

    // Update template
    const { data, error } = await supabase
      .from('templates')
      .update({
        name,
        language,
        category,
        components,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return sendSuccess(res, data, 'Template updated successfully');
  } catch (error) {
    console.error('Update template error:', error);
    return sendError(res, error.message || 'Failed to update template', 500);
  }
};

// Create a new template
export const createTemplate = async (req, res) => {
  try {
    const { name, language, category, headerText, bodyText, footerText, buttons } = req.body;

    // Build components array for WhatsApp template
    const components = [];

    if (headerText) {
      components.push({
        type: 'HEADER',
        format: 'TEXT',
        text: headerText,
      });
    }

    components.push({
      type: 'BODY',
      text: bodyText,
    });

    if (footerText) {
      components.push({
        type: 'FOOTER',
        text: footerText,
      });
    }

    if (buttons && buttons.length > 0) {
      components.push({
        type: 'BUTTONS',
        buttons: buttons,
      });
    }

    const { data, error } = await supabase
      .from('templates')
      .insert([
        {
          name,
          language,
          category,
          status: 'DRAFT',
          components,
        },
      ])
      .select()
      .single();

    if (error) throw error;

    return sendSuccess(res, data, 'Template created successfully', 201);
  } catch (error) {
    console.error('Create template error:', error);
    return sendError(res, error.message || 'Failed to create template', 500);
  }
};

// Submit template to Meta for approval
export const submitTemplateToMeta = async (req, res) => {
  try {
    const { id } = req.params;

    // Get template
    const { data: template, error: fetchError } = await supabase
      .from('templates')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !template) {
      return sendError(res, 'Template not found', 404);
    }

    // Get WhatsApp settings from api_config
    const { data: config, error: configError } = await supabase
      .from('api_config')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (configError || !config) {
      return sendError(res, 'WhatsApp API configuration not found. Please configure in Settings first.', 400);
    }

    const { api_key, whatsapp_business_account_id } = config;

    if (!api_key) {
      return sendError(res, 'WhatsApp Access Token not configured. Please add it in Settings.', 400);
    }

    if (!whatsapp_business_account_id) {
      return sendError(res, 'WhatsApp Business Account ID not configured. Please add it in Settings.', 400);
    }

    // Submit to Meta WhatsApp Business API
    const metaResponse = await axios.post(
      `https://graph.facebook.com/v18.0/${whatsapp_business_account_id}/message_templates`,
      {
        name: template.name,
        language: template.language,
        category: template.category,
        components: template.components,
      },
      {
        headers: {
          Authorization: `Bearer ${api_key}`,
          'Content-Type': 'application/json',
        },
      }
    );

    // Update template status
    const { data: updatedTemplate, error: updateError } = await supabase
      .from('templates')
      .update({
        status: 'PENDING',
        meta_template_id: metaResponse.data.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;

    return sendSuccess(res, updatedTemplate, 'Template submitted to Meta successfully');
  } catch (error) {
    console.error('Submit template error:', error);
    if (error.response) {
      return sendError(
        res,
        error.response.data.error?.message || 'Failed to submit template to Meta',
        error.response.status
      );
    }
    return sendError(res, error.message || 'Failed to submit template', 500);
  }
};

// Sync template status from Meta
export const syncTemplateStatus = async (req, res) => {
  try {
    const { id } = req.params;

    // Get template
    const { data: template, error: fetchError } = await supabase
      .from('templates')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !template) {
      return sendError(res, 'Template not found', 404);
    }

    if (!template.meta_template_id) {
      return sendError(res, 'Template not submitted to Meta yet', 400);
    }

    // Get WhatsApp settings from api_config
    const { data: config } = await supabase
      .from('api_config')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (!config) {
      return sendError(res, 'WhatsApp API configuration not found', 400);
    }

    const { api_key } = config;

    // Get template status from Meta
    const metaResponse = await axios.get(
      `https://graph.facebook.com/v18.0/${template.meta_template_id}`,
      {
        headers: {
          Authorization: `Bearer ${api_key}`,
        },
      }
    );

    // Update template status
    const { data: updatedTemplate, error: updateError } = await supabase
      .from('templates')
      .update({
        status: metaResponse.data.status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;

    return sendSuccess(res, updatedTemplate, 'Template status synced successfully');
  } catch (error) {
    console.error('Sync template error:', error);
    return sendError(res, error.message || 'Failed to sync template status', 500);
  }
};

// Delete template
export const deleteTemplate = async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('templates')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return sendSuccess(res, null, 'Template deleted successfully');
  } catch (error) {
    console.error('Delete template error:', error);
    return sendError(res, error.message || 'Failed to delete template', 500);
  }
};
