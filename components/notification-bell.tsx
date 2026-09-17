'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  fetchAllNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type Notification,
} from '@/lib/notifications';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Bell,
  BellRing,
  CheckCheck,
  Mail,
  AlertTriangle,
  ShieldCheck,
  Send,
  Info,
  X,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

const typeConfig: Record<
  Notification['type'],
  { icon: typeof Bell; color: string; bg: string }
> = {
  new_email: {
    icon: Mail,
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-950',
  },
  critical: {
    icon: AlertTriangle,
    color: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-50 dark:bg-red-950',
  },
  approval_required: {
    icon: ShieldCheck,
    color: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-50 dark:bg-amber-950',
  },
  email_sent: {
    icon: Send,
    color: 'text-green-600 dark:text-green-400',
    bg: 'bg-green-50 dark:bg-green-950',
  },
  system: {
    icon: Info,
    color: 'text-purple-600 dark:text-purple-400',
    bg: 'bg-purple-50 dark:bg-purple-950',
  },
};

// Unique suffix per component instance — prevents Supabase from returning
// an already-subscribed channel when StrictMode or hot-reload remounts.
let _channelSeq = 0;

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  // Position of the fixed panel
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 });
  const bellBtnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Stable channel name for this mount — never changes between renders
  const channelName = useRef(`notifications_realtime_${++_channelSeq}`);

  const unreadCount = notifications.filter((n) => !n.read).length;

  // Calculate panel position from bell button's screen rect
  const handleToggle = useCallback(() => {
    if (!open && bellBtnRef.current) {
      const rect = bellBtnRef.current.getBoundingClientRect();
      setPanelPos({
        top: rect.bottom + 8,
        left: rect.right + 8,
      });
    }
    setOpen((o) => !o);
  }, [open]);

  useEffect(() => {
    loadNotifications();

    // Remove any stale channel with this name before subscribing (safety net)
    const existingChannel = supabase.getChannels().find(
      (ch) => ch.topic === `realtime:${channelName.current}`
    );
    if (existingChannel) {
      supabase.removeChannel(existingChannel);
    }

    // Supabase Realtime subscription — listen for new notifications
    const channel = supabase
      .channel(channelName.current)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload) => {
          const newNotif = payload.new as Notification;
          setNotifications((prev) => [newNotif, ...prev]);
          // Flash the bell
          if (typeof window !== 'undefined') {
            const bellEl = document.getElementById('notification-bell-btn');
            if (bellEl) {
              bellEl.classList.add('animate-bounce');
              setTimeout(() => bellEl.classList.remove('animate-bounce'), 1000);
            }
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications' },
        (payload) => {
          const updated = payload.new as Notification;
          setNotifications((prev) =>
            prev.map((n) => (n.id === updated.id ? updated : n))
          );
        }
      )
      .subscribe();

    // Close on outside click (covers both bell button and fixed panel)
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        panelRef.current && !panelRef.current.contains(target) &&
        bellBtnRef.current && !bellBtnRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener('mousedown', handleClick);
    };
  }, []);

  async function loadNotifications() {
    setLoading(true);
    const data = await fetchAllNotifications();
    setNotifications(data);
    setLoading(false);
  }

  async function handleMarkRead(id: string) {
    await markNotificationRead(id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  }

  async function handleMarkAllRead() {
    await markAllNotificationsRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        ref={bellBtnRef}
        id="notification-bell-btn"
        onClick={handleToggle}
        className={cn(
          'relative h-9 w-9 rounded-lg flex items-center justify-center transition-colors',
          'hover:bg-muted text-muted-foreground hover:text-foreground',
          open && 'bg-muted text-foreground'
        )}
        aria-label={`Notifications ${unreadCount > 0 ? `(${unreadCount} unread)` : ''}`}
      >
        {unreadCount > 0 ? (
          <BellRing className="h-5 w-5" />
        ) : (
          <Bell className="h-5 w-5" />
        )}
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 min-w-[1rem] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-0.5 tabular-nums">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel — fixed to viewport so it escapes sidebar clipping */}
      {open && (
        <div
          ref={panelRef}
          style={{ top: panelPos.top, left: panelPos.left }}
          className="fixed z-[9999] w-80 md:w-96 rounded-xl border bg-card shadow-2xl animate-in fade-in slide-in-from-top-2 duration-200"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div className="flex items-center gap-2">
              <BellRing className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">Notifications</span>
              {unreadCount > 0 && (
                <Badge variant="secondary" className="text-xs h-5 px-1.5">
                  {unreadCount} new
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs gap-1 text-muted-foreground"
                  onClick={handleMarkAllRead}
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Mark all read
                </Button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* List */}
          <ScrollArea className="max-h-[420px]">
            {loading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Loading...
              </div>
            ) : notifications.length === 0 ? (
              <div className="py-10 text-center">
                <Bell className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No notifications yet</p>
              </div>
            ) : (
              <div>
                {notifications.map((notif, idx) => {
                  const cfg = typeConfig[notif.type] ?? typeConfig.system;
                  const Icon = cfg.icon;
                  return (
                    <div key={notif.id}>
                  <button
                        className={cn(
                          'w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-muted/50 transition-colors',
                          !notif.read && 'bg-muted/30',
                          notif.dept_work_item_id && 'border-l-2 border-red-400 dark:border-red-600'
                        )}
                        onClick={async () => {
                          await handleMarkRead(notif.id);
                          setOpen(false);
                          // Navigate to dept work item if present
                          if (notif.dept_work_item_id) {
                            router.push(`/department/${notif.dept_work_item_id}`);
                          }
                        }}
                      >
                        <div
                          className={cn(
                            'h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5',
                            cfg.bg
                          )}
                        >
                          <Icon className={cn('h-4 w-4', cfg.color)} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={cn('text-sm font-medium truncate', !notif.read && 'text-foreground')}>
                              {notif.title}
                            </p>
                            {!notif.read && (
                              <span className="h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                            {notif.message}
                          </p>
                          <p className="text-[10px] text-muted-foreground/60 mt-1" suppressHydrationWarning>
                            {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true })}
                          </p>
                        </div>
                      </button>
                      {idx < notifications.length - 1 && <Separator />}
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
