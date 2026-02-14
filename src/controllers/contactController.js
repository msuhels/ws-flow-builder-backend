import supabase from '../config/supabase.js';

const mapContact = (contact) => ({
  _id: contact.id,
  id: contact.id,
  phoneNumber: contact.phone_number,
  name: contact.name,
  attributes: contact.attributes,
  tags: contact.tags,
  lastInteractionAt: contact.last_interaction_at,
  createdAt: contact.created_at,
  updatedAt: contact.updated_at,
});

/**
 * Get All Contacts
 */
export const getAllContacts = async (req, res) => {
  try {
    const { search, tag, limit = 50, offset = 0 } = req.query;
    
    let query = supabase
      .from('contacts')
      .select('*', { count: 'exact' })
      .order('last_interaction_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    
    // Search by phone number or name
    if (search) {
      query = query.or(`phone_number.ilike.%${search}%,name.ilike.%${search}%`);
    }
    
    // Filter by tag
    if (tag) {
      query = query.contains('tags', [tag]);
    }
    
    // Pagination
    query = query.range(Number(offset), Number(offset) + Number(limit) - 1);
    
    const { data, error, count } = await query;

    if (error) throw error;

    res.status(200).json({ 
      success: true, 
      data: data?.map(mapContact) || [],
      total: count || 0,
      limit: Number(limit),
      offset: Number(offset)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

/**
 * Get Contact by ID
 */
export const getContactById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: contact, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !contact) {
      res.status(404).json({ success: false, message: 'Contact not found' });
      return;
    }

    // Get sessions for this contact
    const { data: sessions } = await supabase
      .from('contact_sessions')
      .select('*')
      .eq('contact_id', id)
      .order('created_at', { ascending: false })
      .limit(10);

    // Get message logs
    const { data: messages } = await supabase
      .from('message_logs')
      .select('*')
      .eq('phone_number', contact.phone_number)
      .order('sent_at', { ascending: false })
      .limit(20);

    res.status(200).json({
      success: true,
      data: {
        ...mapContact(contact),
        sessions: sessions || [],
        recentMessages: messages || []
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

/**
 * Update Contact
 */
export const updateContact = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, attributes, tags } = req.body;

    const updates = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (attributes !== undefined) updates.attributes = attributes;
    if (tags !== undefined) updates.tags = tags;

    const { data, error } = await supabase
      .from('contacts')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.status(200).json({ success: true, data: mapContact(data) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

/**
 * Delete Contact
 */
export const deleteContact = async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.status(200).json({ success: true, message: 'Contact deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

/**
 * Get All Unique Tags
 */
export const getAllTags = async (req, res) => {
  try {
    const { data: contacts } = await supabase
      .from('contacts')
      .select('tags');

    const allTags = new Set();
    contacts?.forEach(contact => {
      contact.tags?.forEach((tag) => allTags.add(tag));
    });

    res.status(200).json({ 
      success: true, 
      data: Array.from(allTags).sort() 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};
