'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Inbox, BookOpen, BarChart3, Settings, Laptop2,
  ChevronLeft, ChevronRight, Menu, X, ShieldCheck, Building2,
  ClipboardCheck, Briefcase, LogOut, User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { NotificationBell } from '@/components/notification-bell';
import { supabase } from '@/lib/supabase';

const navItems = [
  { href: '/dashboard',  label: 'Dashboard',    icon: LayoutDashboard, showBadge: false, badgeKey: '' },
  { href: '/inbox',      label: 'Inbox',         icon: Inbox,           showBadge: false, badgeKey: '' },
  { href: '/org',        label: 'Organization',  icon: Building2,       showBadge: false, badgeKey: '' },
  { href: '/approvals',  label: 'Approvals',     icon: ClipboardCheck,  showBadge: true,  badgeKey: 'approvals' },
  { href: '/department', label: 'Department',    icon: Briefcase,       showBadge: true,  badgeKey: 'dept' },
  { href: '/knowledge',  label: 'Knowledge',     icon: BookOpen,        showBadge: false, badgeKey: '' },
  { href: '/analytics',  label: 'Analytics',     icon: BarChart3,       showBadge: false, badgeKey: '' },
  { href: '/settings',   label: 'Settings',      icon: Settings,        showBadge: false, badgeKey: '' },
  { href: '/validation', label: 'Validation',    icon: ShieldCheck,     showBadge: false, badgeKey: '' },
];

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  admin:            { label: 'Admin',    color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' },
  department_staff: { label: 'Engineer', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  manager:          { label: 'Manager',  color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  employee:         { label: 'Employee', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
};

export function Sidebar() {
  const pathname = usePathname();
  const router   = useRouter();
  const [collapsed,    setCollapsed]    = useState(false);
  const [mobileOpen,   setMobileOpen]   = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [deptCount,    setDeptCount]    = useState(0);
  const [userDisplay,  setUserDisplay]  = useState<{ name: string; email: string; role: string } | null>(null);

  // Fetch current user profile
  useEffect(() => {
    async function fetchUser() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user?.email) return;
        const { data: roleRow } = await supabase
          .from('user_roles')
          .select('role, display_name')
          .eq('email', user.email)
          .maybeSingle();
        setUserDisplay({
          name:  roleRow?.display_name || user.email.split('@')[0],
          email: user.email,
          role:  roleRow?.role || 'department_staff',
        });
      } catch { /* non-fatal */ }
    }
    fetchUser();
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/auth/login');
  }

  useEffect(() => {
    let mounted = true;
    async function fetchPending() {
      try {
        const res = await fetch('/api/approvals?type=stats');
        if (!res.ok) return;
        const data = await res.json();
        if (mounted) setPendingCount(data.stats?.pending ?? 0);
      } catch { /* non-fatal */ }
    }
    fetchPending();
    const id = setInterval(fetchPending, 60_000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    let mounted = true;
    async function fetchDept() {
      try {
        const res = await fetch('/api/dept/stats');
        if (!res.ok) return;
        const data = await res.json();
        if (mounted) setDeptCount((data.stats?.open ?? 0) + (data.stats?.inProgress ?? 0));
      } catch { /* non-fatal */ }
    }
    fetchDept();
    const id = setInterval(fetchDept, 60_000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  function NavLink({ item, showLabel, onClick }: { item: typeof navItems[0]; showLabel: boolean; onClick?: () => void }) {
    const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
    const Icon = item.icon;
    const count = item.showBadge ? (item.badgeKey === 'dept' ? deptCount : pendingCount) : 0;
    return (
      <Link href={item.href} onClick={onClick}
        className={cn('flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
          isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
        <span className="relative shrink-0">
          <Icon className="h-5 w-5 flex-shrink-0" />
          {!showLabel && count > 0 && (
            <span className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-amber-500 text-[9px] font-bold text-white flex items-center justify-center leading-none shadow animate-pulse">
              {count > 9 ? '9+' : count}
            </span>
          )}
        </span>
        {showLabel && (
          <>
            <span className="flex-1">{item.label}</span>
            {count > 0 && (
              <span className="h-5 min-w-[20px] px-1 rounded-full bg-amber-500 text-[10px] font-bold text-white flex items-center justify-center leading-none shadow animate-pulse">
                {count > 99 ? '99+' : count}
              </span>
            )}
          </>
        )}
      </Link>
    );
  }

  function UserFooter({ showLabel }: { showLabel: boolean }) {
    const roleInfo = userDisplay ? (ROLE_LABELS[userDisplay.role] || ROLE_LABELS.employee) : null;
    return (
      <div className={cn('border-t p-3', showLabel ? 'space-y-2' : 'flex flex-col items-center gap-2')}>
        {showLabel && userDisplay && (
          <div className="flex items-center gap-2.5 px-1 py-1">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <User className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-foreground truncate">{userDisplay.name}</p>
              {roleInfo && (
                <span className={cn('text-[10px] font-medium rounded px-1.5 py-0.5', roleInfo.color)}>
                  {roleInfo.label}
                </span>
              )}
            </div>
          </div>
        )}
        {!showLabel && userDisplay && (
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center" title={userDisplay.name}>
            <User className="h-4 w-4 text-primary" />
          </div>
        )}
        <button onClick={handleSignOut}
          className={cn('flex items-center gap-2 text-xs text-muted-foreground hover:text-destructive rounded-lg px-2 py-1.5 hover:bg-muted transition-all w-full', !showLabel && 'justify-center')}
          title="Sign out">
          <LogOut className="h-3.5 w-3.5 shrink-0" />
          {showLabel && <span>Sign Out</span>}
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="md:hidden fixed top-3 left-3 z-50">
        <Button size="sm" variant="outline" className="h-9 w-9 p-0" onClick={() => setMobileOpen(true)}>
          <Menu className="h-4 w-4" />
        </Button>
      </div>

      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setMobileOpen(false)} />
      )}

      <div className={cn('md:hidden fixed inset-y-0 left-0 z-50 bg-card border-r transition-transform duration-300 flex flex-col',
        mobileOpen ? 'translate-x-0' : '-translate-x-full', 'w-64')}>
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <Laptop2 className="h-6 w-6 text-primary" />
            <span className="font-bold text-lg">IntelliDesk</span>
          </div>
          <div className="flex items-center gap-1">
            <NotificationBell />
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setMobileOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map(item => <NavLink key={item.href} item={item} showLabel={true} onClick={() => setMobileOpen(false)} />)}
        </nav>
        <UserFooter showLabel={true} />
      </div>

      <div className={cn('hidden md:flex flex-col border-r bg-card transition-all duration-300 ease-in-out',
        collapsed ? 'w-16' : 'w-64')}>
        <div className="flex items-center justify-between p-4 border-b">
          {!collapsed && (
            <div className="flex items-center gap-2">
              <Laptop2 className="h-6 w-6 text-primary" />
              <span className="font-bold text-lg">IntelliDesk</span>
            </div>
          )}
          {collapsed && <Laptop2 className="h-6 w-6 text-primary mx-auto" />}
          <div className="flex items-center gap-1">
            {!collapsed && <NotificationBell />}
            <button onClick={() => setCollapsed(!collapsed)} className="p-1 rounded-md hover:bg-muted transition-colors">
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map(item => <NavLink key={item.href} item={item} showLabel={!collapsed} />)}
        </nav>

        {!collapsed && (
          <div className="p-4 border-b">
            <div className="rounded-lg bg-muted p-3">
              <p className="text-xs font-medium text-muted-foreground">AI Status</p>
              <div className="flex items-center gap-2 mt-1.5">
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-xs text-foreground">All agents active</span>
              </div>
            </div>
          </div>
        )}

        <UserFooter showLabel={!collapsed} />
      </div>
    </>
  );
}
