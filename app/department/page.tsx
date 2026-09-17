'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

import { Sidebar } from '@/components/sidebar';
import { supabase } from '@/lib/supabase';
import {
  Briefcase, Clock, CheckCircle2, AlertTriangle, Loader2,
  Search, Filter, RefreshCw, ChevronRight, TrendingUp,
  Users, Activity, Timer, ShieldAlert, Zap, ArrowUpRight, Trash2, X,
  LayoutGrid, List,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { DeptWorkItem, DeptStats } from '@/lib/types';

// ── SLA Countdown ─────────────────────────────────────────────────────────────

function SlaCountdown({ deadline, breached, status }: {
  deadline: string | null;
  breached: boolean;
  status: string;
}) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!deadline || status === 'completed') return;
    const tick = () => setRemaining(new Date(deadline).getTime() - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline, status]);

  if (status === 'completed') {
    return <span className="text-xs text-emerald-600 font-medium">Completed</span>;
  }
  if (!deadline) return <span className="text-xs text-muted-foreground">—</span>;

  const isBreached = breached || (remaining !== null && remaining <= 0);

  if (isBreached) {
    // Show how many hours overdue
    const overdueMs = deadline ? Date.now() - new Date(deadline).getTime() : 0;
    const overdueH  = Math.floor(overdueMs / 3_600_000);
    const overdueM  = Math.floor((overdueMs % 3_600_000) / 60_000);
    const label     = overdueH > 0 ? `${overdueH}h ${overdueM}m overdue` : `${overdueM}m overdue`;
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-red-600 dark:text-red-400">
        <ShieldAlert className="h-3 w-3" />
        <span className="animate-pulse">SLA BREACHED</span>
        <span className="font-normal text-red-400 dark:text-red-500 ml-0.5">({label})</span>
      </span>
    );
  }
  if (remaining === null) return <span className="text-xs text-muted-foreground">…</span>;

  const totalMs  = new Date(deadline).getTime() - Date.now() + remaining;
  const pct      = Math.max(0, remaining / (totalMs || 1));
  const hours    = Math.floor(remaining / 3_600_000);
  const minutes  = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds  = Math.floor((remaining % 60_000) / 1_000);
  const label    = `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
  const color    = pct > 0.5 ? 'text-emerald-600 dark:text-emerald-400'
                 : pct > 0.1 ? 'text-amber-600 dark:text-amber-400'
                 :              'text-red-600 dark:text-red-400';

  return <span className={cn('text-xs font-mono font-bold tabular-nums', color)}>{label}</span>;
}

// ── Priority Badge ────────────────────────────────────────────────────────────

const PRIORITY_STYLES: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  high:     'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  medium:   'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  low:      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
};

const STATUS_STYLES: Record<string, string> = {
  escalated:     'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  assigned:      'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  accepted:      'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300',
  in_progress:   'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300',
  waiting:       'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  quality_check: 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300',
  completed:     'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
};

const STATUS_LABELS: Record<string, string> = {
  escalated:     '🚨 Escalated',
  assigned:      '● Waiting Assignment',
  accepted:      '◆ Assigned',
  in_progress:   '▶ In Investigation',
  waiting:       '⏸ Waiting Employee',
  quality_check: '🔍 Waiting Approval',
  completed:     '✓ Resolved',
};

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({ label, value, icon: Icon, color, sub }: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-start gap-3 shadow-sm hover:shadow-md transition-shadow">
      <div className={cn('rounded-lg p-2 shrink-0', color)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground font-medium truncate">{label}</p>
        <p className="text-2xl font-bold text-foreground tabular-nums leading-tight">{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DepartmentQueuePage() {
  const [items, setItems]       = useState<DeptWorkItem[]>([]);
  const [stats, setStats]       = useState<DeptStats | null>(null);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing]   = useState(false);   // backfill indicator
  const [syncMsg, setSyncMsg]   = useState('');       // e.g. "3 tickets synced"
  const [backfillDone, setBackfillDone] = useState(false);

  // Delete state
  const [deletingId,    setDeletingId]    = useState<string | null>(null);
  const [confirmId,     setConfirmId]     = useState<string | null>(null);

  // View mode: 'table' | 'sections'
  const [viewMode, setViewMode] = useState<'table' | 'sections'>('table');

  // Filters
  const [search,     setSearch]     = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');

  // Read ?tab=completed from URL on first mount (used by Module 4 navigation)
  const searchParams = useSearchParams();
  useEffect(() => {
    const tab = searchParams?.get('tab');
    if (tab === 'completed') setFilterStatus('completed');
  }, [searchParams]);

  const searchRef = useRef<ReturnType<typeof setTimeout>>();

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search)         params.set('search',     search);
      if (filterDept)     params.set('department', filterDept);
      if (filterStatus)   params.set('status',     filterStatus);
      if (filterPriority) params.set('priority',   filterPriority);

      const [qRes, sRes] = await Promise.all([
        fetch(`/api/dept/queue?${params}`),
        fetch('/api/dept/stats'),
      ]);
      if (qRes.ok) { const d = await qRes.json(); setItems(d.items ?? []); }
      if (sRes.ok) { const d = await sRes.json(); setStats(d.stats); }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [search, filterDept, filterStatus, filterPriority]);

  // ── Delete work item ───────────────────────────────────────────────────────
  async function deleteItem(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/dept/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setItems(prev => prev.filter(i => i.id !== id));
        setConfirmId(null);
        // Refresh stats
        const sRes = await fetch('/api/dept/stats');
        if (sRes.ok) { const d = await sRes.json(); setStats(d.stats); }
      }
    } catch (e) { console.error(e); }
    finally { setDeletingId(null); }
  }

  // ── Backfill on first mount — creates work items for any approved approvals
  // that don't already have a dept_work_items row. This makes the page
  // self-healing: any approval done before the migration or via email-link
  // will automatically appear in the queue.
  //
  // GATE: only fires the HTTP call once per browser session (sessionStorage flag).
  // If the flag is already set, skip straight to fetchData() — no network hit.
  useEffect(() => {
    let mounted = true;
    async function backfill() {
      setSyncing(true);
      try {
        // Skip backfill API if already ran this session
        const alreadyRan = typeof window !== 'undefined' &&
          sessionStorage.getItem('dept_backfill_done') === '1';

        if (!alreadyRan) {
          const res = await fetch('/api/dept/backfill', { method: 'POST' });
          if (res.ok) {
            // Mark done for this browser session
            try { sessionStorage.setItem('dept_backfill_done', '1'); } catch { /* ignore */ }
            const d = await res.json();
            if (mounted && d.created > 0) {
              setSyncMsg(`${d.created} approved ticket${d.created !== 1 ? 's' : ''} synced to queue`);
              setTimeout(() => { if (mounted) setSyncMsg(''); }, 5000);
            }
          }
        }
      } catch { /* non-fatal */ }
      finally {
        if (mounted) {
          setSyncing(false);
          setBackfillDone(true);
        }
      }
    }
    backfill();
    return () => { mounted = false; };
  }, []);

  // Re-fetch when filters change (skip initial load — handled by backfill effect)
  useEffect(() => { if (backfillDone) fetchData(); }, [fetchData, backfillDone]);

  // Debounce search
  useEffect(() => {
    clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => fetchData(), 400);
    return () => clearTimeout(searchRef.current);
  }, [search]);

  // ── Realtime ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('dept_queue_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dept_work_items' }, () => {
        fetchData(true);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchData]);

  const avgHours = stats?.avgResolutionHours
    ? stats.avgResolutionHours < 1
      ? `${Math.round(stats.avgResolutionHours * 60)}m`
      : `${stats.avgResolutionHours.toFixed(1)}h`
    : '—';

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="border-b border-border bg-card px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-violet-100 dark:bg-violet-900/40">
              <Briefcase className="h-5 w-5 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Department Queue</h1>
              <p className="text-xs text-muted-foreground">Enterprise processing workspace</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Sync indicator */}
            {syncing && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Syncing approved tickets…
              </span>
            )}
            {syncMsg && (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-2.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-800">
                <CheckCircle2 className="h-3 w-3" /> {syncMsg}
              </span>
            )}
            <button
              onClick={() => fetchData(true)}
              disabled={refreshing || syncing}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
              Refresh
            </button>
            {/* View mode toggle */}
            <div className="flex border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode('table')}
                className={cn(
                  'flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-colors',
                  viewMode === 'table'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                <List className="h-3.5 w-3.5" /> Table
              </button>
              <button
                onClick={() => setViewMode('sections')}
                className={cn(
                  'flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-colors border-l border-border',
                  viewMode === 'sections'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                <LayoutGrid className="h-3.5 w-3.5" /> Sections
              </button>
            </div>
          </div>
        </div>


        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* KPI Row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard label="Assigned Today"     value={stats?.assignedToday ?? '—'} icon={Zap}           color="bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400" />
            <KpiCard label="Open"               value={stats?.open ?? '—'}          icon={Briefcase}     color="bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400" />
            <KpiCard label="In Progress"        value={stats?.inProgress ?? '—'}    icon={Activity}      color="bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400" />
            <KpiCard label="Completed Today"    value={stats?.completedToday ?? '—'} icon={CheckCircle2} color="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400" />
            <KpiCard label="SLA Breached"       value={stats?.slaBreached ?? '—'}   icon={ShieldAlert}   color="bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400" />
            <KpiCard label="Avg Resolution"     value={avgHours}                    icon={Timer}         color="bg-sky-100 dark:bg-sky-900/40 text-sky-600 dark:text-sky-400" sub="hours" />
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search employee, department, intent…"
                className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              className="text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-2 focus:ring-primary/30">
              <option value="">All Statuses</option>
              <option value="assigned">Assigned</option>
              <option value="accepted">Accepted</option>
              <option value="in_progress">In Progress</option>
              <option value="waiting">Waiting for Employee</option>
              <option value="quality_check">Quality Verification</option>
              <option value="completed">Completed</option>
            </select>
            <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)}
              className="text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-2 focus:ring-primary/30">
              <option value="">All Priorities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <input
              value={filterDept}
              onChange={e => setFilterDept(e.target.value)}
              placeholder="Department…"
              className="text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 w-36"
            />
            {(filterStatus || filterPriority || filterDept || search) && (
              <button
                onClick={() => { setSearch(''); setFilterStatus(''); setFilterPriority(''); setFilterDept(''); }}
                className="text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-2 hover:bg-muted transition-colors"
              >
                Clear
              </button>
            )}
          </div>

          {/* Queue Table or Sections View */}
          {viewMode === 'sections' ? (
            <SectionsView items={items} loading={loading} />
          ) : loading ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading queue…
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground space-y-2">
              <Briefcase className="h-10 w-10 opacity-30" />
              <p className="font-medium">No work items found</p>
              <p className="text-xs">Items appear here once an approval is processed.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden bg-card shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      {['Ticket', 'Employee', 'Department / Team', 'Priority', 'Assigned To', 'Created', 'Status', 'SLA Remaining', ''].map(h => (
                        <th key={h} className="text-left text-xs font-semibold text-muted-foreground px-4 py-3 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => (
                      <tr
                        key={item.id}
                        className={cn(
                          'border-b border-border/60 hover:bg-muted/30 transition-colors cursor-pointer group',
                          item.sla_breached && item.status !== 'completed' && 'bg-red-50/30 dark:bg-red-950/10',
                          idx === items.length - 1 && 'border-b-0'
                        )}
                        onClick={() => window.location.href = `/department/${item.id}`}
                      >
                        <td className="px-4 py-3">
                          <span className="font-mono text-[11px] text-muted-foreground">
                            #{item.id.slice(0, 8).toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground truncate max-w-[160px]">
                            {item.employee_name ?? '—'}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate max-w-[160px]">
                            {item.employee_email}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">{item.department ?? '—'}</div>
                          {item.team_name && (
                            <div className="text-[11px] text-muted-foreground">{item.team_name}</div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full capitalize', PRIORITY_STYLES[item.priority])}>
                            {item.priority}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">
                          {item.assigned_to ?? <span className="text-muted-foreground italic text-xs">Unassigned</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(item.created_at).toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', STATUS_STYLES[item.status])}>
                            {STATUS_LABELS[item.status] ?? item.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <SlaCountdown deadline={item.sla_deadline} breached={item.sla_breached} status={item.status} />
                        </td>
                        <td className="px-4 py-3">
                          {/* Delete button — stops row click propagation */}
                          {confirmId === item.id ? (
                            <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                              <button
                                onClick={() => deleteItem(item.id)}
                                disabled={deletingId === item.id}
                                className="text-[10px] font-bold text-white bg-red-500 hover:bg-red-600 rounded px-2 py-0.5 transition-colors disabled:opacity-60"
                              >
                                {deletingId === item.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Delete'}
                              </button>
                              <button
                                onClick={() => setConfirmId(null)}
                                className="text-[10px] text-muted-foreground hover:text-foreground border border-border rounded px-1.5 py-0.5"
                              >Cancel</button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                              <button
                                onClick={() => setConfirmId(item.id)}
                                title="Remove this work item"
                                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-500 p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                              <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2.5 border-t border-border bg-muted/20 text-xs text-muted-foreground">
                {items.length} work item{items.length !== 1 ? 's' : ''}
                {(filterStatus || filterPriority || filterDept || search) ? ' (filtered)' : ''}
                {' '}· Live via Supabase Realtime
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── SectionsView ──────────────────────────────────────────────────────────────
// Kanban-style section grouping for the department queue.

interface SectionDef {
  key: string;
  label: string;
  color: string;
  headerBg: string;
  dot: string;
  filter: (item: DeptWorkItem) => boolean;
}

const SECTIONS: SectionDef[] = [
  {
    key:      'new',
    label:    'New',
    color:    'border-blue-300 dark:border-blue-700',
    headerBg: 'bg-blue-50 dark:bg-blue-950/30',
    dot:      'bg-blue-500',
    // 'assigned' = came from approval workflow and not yet claimed
    filter:   item => item.status === 'assigned',
  },
  {
    key:      'escalated',
    label:    'Escalated',
    color:    'border-red-300 dark:border-red-700',
    headerBg: 'bg-red-50 dark:bg-red-950/30',
    dot:      'bg-red-500',
    // 'escalated' = dedicated status set by the escalate route
    filter:   item => item.status === 'escalated',
  },
  {
    key:      'assigned_officer',
    label:    'Assigned',
    color:    'border-indigo-300 dark:border-indigo-700',
    headerBg: 'bg-indigo-50 dark:bg-indigo-950/30',
    dot:      'bg-indigo-500',
    filter:   item => item.status === 'accepted',
  },
  {
    key:      'in_progress',
    label:    'In Progress',
    color:    'border-violet-300 dark:border-violet-700',
    headerBg: 'bg-violet-50 dark:bg-violet-950/30',
    dot:      'bg-violet-500',
    filter:   item => item.status === 'in_progress' || item.status === 'quality_check',
  },
  {
    key:      'waiting',
    label:    'Waiting Customer',
    color:    'border-amber-300 dark:border-amber-700',
    headerBg: 'bg-amber-50 dark:bg-amber-950/30',
    dot:      'bg-amber-500',
    filter:   item => item.status === 'waiting' || item.status === 'customer_resolution',
  },
  {
    key:      'resolved',
    label:    'Resolved',
    color:    'border-emerald-300 dark:border-emerald-700',
    headerBg: 'bg-emerald-50 dark:bg-emerald-950/30',
    dot:      'bg-emerald-500',
    filter:   item => item.status === 'completed',
  },
];

const PRIORITY_DOT: Record<string, string> = {
  critical: 'bg-red-500',
  high:     'bg-orange-400',
  medium:   'bg-amber-400',
  low:      'bg-emerald-400',
};

function SectionsView({ items, loading }: { items: DeptWorkItem[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading queue…
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 pb-6">
      {SECTIONS.map(section => {
        const sectionItems = items.filter(section.filter);
        return (
          <div
            key={section.key}
            className={cn('rounded-xl border-2 overflow-hidden flex flex-col', section.color)}
          >
            {/* Section header */}
            <div className={cn('flex items-center justify-between px-3 py-2.5', section.headerBg)}>
              <div className="flex items-center gap-2">
                <div className={cn('w-2.5 h-2.5 rounded-full shrink-0', section.dot)} />
                <p className="text-xs font-bold text-foreground">{section.label}</p>
              </div>
              <span className="text-xs font-bold bg-background/70 text-foreground px-1.5 py-0.5 rounded-full">
                {sectionItems.length}
              </span>
            </div>

            {/* Cards */}
            <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-96">
              {sectionItems.length === 0 ? (
                <div className="flex items-center justify-center py-6">
                  <p className="text-[10px] text-muted-foreground italic">Empty</p>
                </div>
              ) : (
                sectionItems.map(item => (
                  <Link
                    key={item.id}
                    href={`/department/${item.id}`}
                    className="block rounded-lg border border-border bg-card hover:bg-muted/30 transition-colors p-2.5 space-y-1.5"
                  >
                    {/* Priority + dept */}
                    <div className="flex items-center gap-1.5">
                      <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', PRIORITY_DOT[item.priority] ?? 'bg-muted')} />
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide truncate">
                        {item.department ?? 'Unknown'}
                      </p>
                      {(item as any).escalated_from_ticket_id && (
                        <ShieldAlert className="h-3 w-3 text-red-500 ml-auto shrink-0" />
                      )}
                    </div>
                    {/* Employee */}
                    <p className="text-xs font-semibold text-foreground truncate">
                      {item.employee_name ?? 'Unknown employee'}
                    </p>
                    {/* Team */}
                    {item.team_name && (
                      <p className="text-[10px] text-muted-foreground truncate">{item.team_name}</p>
                    )}
                    {/* Intent */}
                    {item.intent && (
                      <p className="text-[10px] text-muted-foreground/70 italic truncate">{item.intent}</p>
                    )}
                    {/* SLA */}
                    {item.sla_deadline && item.status !== 'completed' && (
                      <SlaCountdown deadline={item.sla_deadline} breached={item.sla_breached} status={item.status} />
                    )}
                  </Link>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
