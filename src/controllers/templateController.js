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

    const templates = data || [];

    // Auto-sync pending templates
    const whatsapp_access_token = process.env.WHATSAPP_TOKEN;
    
    if (whatsapp_access_token) {
      const pendingTemplates = templates.filter(t => t.status === 'PENDING' && t.meta_template_id);
      
      // Sync each pending template in background (don't wait)
      pendingTemplates.forEach(async (template) => {
        try {
          const metaResponse = await axios.get(
            `https://graph.facebook.com/v19.0/${template.meta_template_id}`,
            {
              headers: {
                Authorization: `Bearer ${whatsapp_access_token}`,
              },
            }
          );

          const metaStatus = metaResponse.data.status;
          
          // Only update if status changed
          if (metaStatus && metaStatus !== 'PENDING') {
            await supabase
              .from('templates')
              .update({
                status: metaStatus,
                updated_at: new Date().toISOString(),
              })
              .eq('id', template.id);
            
            console.log(`Auto-synced template ${template.id}: ${template.status} -> ${metaStatus}`);
          }
        } catch (error) {
          // Silently fail - don't block the main response
          console.error(`Failed to auto-sync template ${template.id}:`, error.message);
        }
      });
    }

    return sendSuccess(res, templates, 'Templates fetched successfully');
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
    const { name, language, category, headerType, headerText, headerMediaUrl, bodyText, footerText, buttons } = req.body;

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

    // Handle header based on type
    if (headerType && (headerText || headerMediaUrl)) {
      if (headerType === 'TEXT' && headerText) {
        components.push({
          type: 'HEADER',
          format: 'TEXT',
          text: headerText,
        });
      } else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType) && headerMediaUrl) {
        components.push({
          type: 'HEADER',
          format: headerType,
          example: {
            header_handle: [headerMediaUrl],
          },
        });
      }
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
    const { name, language, category, headerType, headerText, headerMediaUrl, bodyText, footerText, buttons } = req.body;

    // Build components array for WhatsApp template
    const components = [];

    // Handle header based on type
    if (headerType && (headerText || headerMediaUrl)) {
      if (headerType === 'TEXT' && headerText) {
        components.push({
          type: 'HEADER',
          format: 'TEXT',
          text: headerText,
        });
      } else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType) && headerMediaUrl) {
        components.push({
          type: 'HEADER',
          format: headerType,
          example: {
            header_handle: [headerMediaUrl],
          },
        });
      }
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

    // Get WhatsApp credentials from environment variables
    const whatsapp_access_token = process.env.WHATSAPP_TOKEN;
    const whatsapp_business_account_id = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;

    if (!whatsapp_access_token) {
      return sendError(res, 'WhatsApp Access Token not configured in environment variables', 400);
    }

    if (!whatsapp_business_account_id) {
      return sendError(res, 'WhatsApp Business Account ID not configured in environment variables', 400);
    }

    // Submit to Meta WhatsApp Business API (using v19.0 for latest API)
    const metaResponse = await axios.post(
      `https://graph.facebook.com/v19.0/${whatsapp_business_account_id}/message_templates`,
      {
        name: template.name,
        language: template.language,
        category: template.category,
        components: template.components,
      },
      {
        headers: {
          Authorization: `Bearer ${whatsapp_access_token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    // Meta returns the status immediately in the response
    const metaStatus = metaResponse.data.status || 'PENDING';
    
    // Update template with status from Meta
    const { data: updatedTemplate, error: updateError } = await supabase
      .from('templates')
      .update({
        status: metaStatus,
        meta_template_id: metaResponse.data.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;

    // Return appropriate message based on status
    let message = 'Template submitted to Meta successfully';
    if (metaStatus === 'APPROVED') {
      message = 'Template submitted and approved by Meta';
    } else if (metaStatus === 'REJECTED') {
      message = 'Template submitted but rejected by Meta';
    } else if (metaStatus === 'PENDING') {
      message = 'Template submitted and pending Meta approval';
    }

    return sendSuccess(res, updatedTemplate, message);
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

    // Get WhatsApp credentials from environment variables
    const whatsapp_access_token = process.env.WHATSAPP_TOKEN;

    if (!whatsapp_access_token) {
      return sendError(res, 'WhatsApp Access Token not configured in environment variables', 400);
    }

    // Get template status from Meta (using v19.0 for latest API)
    const metaResponse = await axios.get(
      `https://graph.facebook.com/v19.0/${template.meta_template_id}`,
      {
        headers: {
          Authorization: `Bearer ${whatsapp_access_token}`,
        },
      }
    );

    // Extract status from Meta response
    const metaStatus = metaResponse.data.status;
    
    if (!metaStatus) {
      return sendError(res, 'Could not retrieve status from Meta', 500);
    }

    // Update template status
    const { data: updatedTemplate, error: updateError } = await supabase
      .from('templates')
      .update({
        status: metaStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;

    // Return appropriate message based on status
    let message = 'Template status synced successfully';
    if (metaStatus === 'APPROVED') {
      message = 'Template is approved and ready to use';
    } else if (metaStatus === 'REJECTED') {
      message = 'Template was rejected by Meta';
    } else if (metaStatus === 'PENDING') {
      message = 'Template is still pending approval';
    }

    return sendSuccess(res, updatedTemplate, message);
  } catch (error) {
    console.error('Sync template error:', error);
    if (error.response) {
      return sendError(
        res,
        error.response.data.error?.message || 'Failed to sync template status from Meta',
        error.response.status
      );
    }
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
