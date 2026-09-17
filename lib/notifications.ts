import { supabase } from './supabase';

export type NotificationType = 'new_email' | 'critical' | 'approval_required' | 'email_sent' | 'system';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  ticket_id: string | null;
  email_id: string | null;
  /** Direct link to a dept_work_items row — set on ESCALATE notifications */
  dept_work_item_id: string | null;
  read: boolean;
  created_at: string;
}

/**
 * Create a new notification record.
 */
export async function createNotification(params: {
  type: NotificationType;
  title: string;
  message: string;
  ticket_id?: string | null;
  email_id?: string | null;
  dept_work_item_id?: string | null;
}): Promise<void> {
  const { error } = await supabase.from('notifications').insert({
    type: params.type,
    title: params.title,
    message: params.message,
    ticket_id: params.ticket_id ?? null,
    email_id: params.email_id ?? null,
    dept_work_item_id: params.dept_work_item_id ?? null,
    read: false,
  });
  if (error) {
    console.error('[Notifications] insert error:', error.message);
  }
}

/**
 * Fetch all unread notifications, newest first.
 */
export async function fetchUnreadNotifications(): Promise<Notification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('read', false)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    console.error('[Notifications] fetch error:', error.message);
    return [];
  }
  return (data ?? []) as Notification[];
}

/**
 * Fetch all notifications (read + unread), newest first.
 */
export async function fetchAllNotifications(): Promise<Notification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    console.error('[Notifications] fetch error:', error.message);
    return [];
  }
  return (data ?? []) as Notification[];
}

/**
 * Mark a single notification as read.
 */
export async function markNotificationRead(id: string): Promise<void> {
  await supabase.from('notifications').update({ read: true }).eq('id', id);
}

/**
 * Mark ALL notifications as read.
 */
export async function markAllNotificationsRead(): Promise<void> {
  await supabase.from('notifications').update({ read: true }).eq('read', false);
}

/**
 * Count of unread notifications.
 */
export async function getUnreadCount(): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('read', false);
  if (error) return 0;
  return count ?? 0;
}
