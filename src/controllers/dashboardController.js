import supabase from '../config/supabase.js';

/**
 * Get Dashboard Stats
 */
export const getDashboardStats = async (req, res) => {
  try {
    // Parallel requests for performance
    const totalFlowsPromise = supabase
      .from('flows')
      .select('*', { count: 'exact', head: true });

    const activeFlowsPromise = supabase
      .from('flows')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const messagesSentTodayPromise = supabase
      .from('message_logs')
      .select('*', { count: 'exact', head: true })
      .gte('sent_at', startOfDay.toISOString());
    
    const totalContactsPromise = supabase
      .from('contacts')
      .select('*', { count: 'exact', head: true });
    
    // For delivery status, we fetch status column of all logs (or maybe limit to recent ones if too many)
    const deliveryStatusPromise = supabase
      .from('message_logs')
      .select('status');

    const [
      { count: totalFlows },
      { count: activeFlows },
      { count: messagesSentToday },
      { count: totalContacts },
      { data: statusLogs }
    ] = await Promise.all([
      totalFlowsPromise,
      activeFlowsPromise,
      messagesSentTodayPromise,
      totalContactsPromise,
      deliveryStatusPromise
    ]);

    // Aggregate delivery status
    const deliveryStatusMap = {};
    if (statusLogs) {
      statusLogs.forEach((log) => {
        const status = log.status || 'unknown';
        deliveryStatusMap[status] = (deliveryStatusMap[status] || 0) + 1;
      });
    }

    res.status(200).json({
      success: true,
      data: {
        totalFlows: totalFlows || 0,
        activeFlows: activeFlows || 0,
        messagesSentToday: messagesSentToday || 0,
        totalContacts: totalContacts || 0,
        deliveryStatus: deliveryStatusMap,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
    });
  }
};
