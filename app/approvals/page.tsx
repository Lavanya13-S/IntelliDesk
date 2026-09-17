'use client';

import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from '@/components/sidebar';
import { supabase } from '@/lib/supabase';
import {
  ClipboardCheck, Clock, CheckCircle2, XCircle, TrendingUp,
  Search, RefreshCw, ChevronRight, AlertTriangle,
  Building2, Calendar, Shield, Users, ChevronDown,
  Filter, AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApprovalRow {
  id: string;
  ticket_id: string;
  approval_type: 'manager_approval' | 'acceptance';
  employee_name: string | null;
  employee_email: string | null;
  manager_name: string | null;
  manager_email: string | null;
  department: string | null;
  team_name: string | null;
  intent: string | null;
  priority: string | null;
  risk_level: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  created_at: string;
  approved_at: string | null;
  token_expires_at: string;
}

interface Stats {
  pending: number;
  approvedToday: number;
  rejectedToday: number;
  avgApprovalHours: number;
}

type DateRange = 'all' | 'today' | 'week' | 'month';
type UserView = 'admin' | 'manager';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const priorityConfig: Record<string, { label: string; color: string; bg: string }> = {
  critical: { label: 'Critical', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  high:     { label: 'High',     color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
  medium:   { label: 'Medium',   color: '#eab308', bg: 'rgba(234,179,8,0.12)' },
  low:      { label: 'Low',      color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
};

const statusConfig: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  pending:  { label: 'Pending',  color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  icon: Clock },
  approved: { label: 'Approved', color: '#10b981', bg: 'rgba(16,185,129,0.12)', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  icon: XCircle },
  expired:  { label: 'Expired',  color: '#6b7280', bg: 'rgba(107,114,128,0.12)', icon: AlertTriangle },
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor(diff / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return 'just now';
}

function isOverdue(row: ApprovalRow): boolean {
  if (row.status !== 'pending') return false;
  const hoursElapsed = (Date.now() - new Date(row.created_at).getTime()) / 3600000;
  return hoursElapsed > 24; // SLA: 24 hours
}

function Avatar({ name }: { name: string | null }) {
  const initials = (name ?? '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const colors = ['#4f46e5', '#7c3aed', '#0ea5e9', '#059669', '#dc2626', '#ea580c'];
  const idx = (name?.charCodeAt(0) ?? 0) % colors.length;
  return (
    <div
      className="h-9 w-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
      style={{ background: colors[idx] }}
    >
      {initials}
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, icon: Icon, color, pulse,
}: {
  label: string; value: number | string; sub?: string;
  icon: React.ElementType; color: string; pulse?: boolean;
}) {
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5 hover:bg-gray-50 transition-colors shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider">{label}</span>
        <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ background: `${color}22` }}>
          <Icon className={cn('h-4 w-4', pulse && 'animate-pulse')} style={{ color }} />
        </div>
      </div>
      <p className="text-3xl font-bold text-[#111827]">{value}</p>
      {sub && <p className="text-xs text-[#6B7280] mt-1">{sub}</p>}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [stats, setStats] = useState<Stats>({ pending: 0, approvedToday: 0, rejectedToday: 0, avgApprovalHours: 0 });
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterDepartment, setFilterDepartment] = useState<string>('');
  const [filterDate, setFilterDate] = useState<DateRange>('all');
  const [search, setSearch] = useState('');

  // RBAC view — persisted in localStorage so navigation doesn't reset it
  const [viewMode, setViewMode] = useState<UserView>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('approvals_view_mode') as UserView) || 'admin';
    }
    return 'admin';
  });
  const [managerEmail, setManagerEmail] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('approvals_manager_email') || '';
    }
    return '';
  });
  const [managerEmailInput, setManagerEmailInput] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('approvals_manager_email') || '';
    }
    return '';
  });
  const [showRolePanel, setShowRolePanel] = useState(false);

  // Persist view mode changes
  const applyViewMode = (mode: UserView, email?: string) => {
    setViewMode(mode);
    localStorage.setItem('approvals_view_mode', mode);
    if (mode === 'admin') {
      setManagerEmail('');
      localStorage.setItem('approvals_manager_email', '');
    } else if (email !== undefined) {
      setManagerEmail(email);
      localStorage.setItem('approvals_manager_email', email);
    }
    setShowRolePanel(false);
  };

  // ── Quick-action in-flight tracking ───────────────────────────────────────
  // Tracks which approval IDs currently have an action in-flight.
  // This prevents double-clicking and gives instant visual feedback.
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());

  // ── Fetch data ───────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus !== 'all') params.set('status', filterStatus);
      if (filterPriority !== 'all') params.set('priority', filterPriority);
      if (filterDepartment) params.set('department', filterDepartment);
      if (search) params.set('search', search);
      if (filterDate !== 'all') params.set('dateRange', filterDate);
      if (viewMode === 'manager' && managerEmail) params.set('managerEmail', managerEmail);

      const statsParams = new URLSearchParams({ type: 'stats' });
      if (viewMode === 'manager' && managerEmail) statsParams.set('managerEmail', managerEmail);

      const [qRes, sRes] = await Promise.all([
        fetch(`/api/approvals?${params}`),
        fetch(`/api/approvals?${statsParams}`),
      ]);
      const qData = await qRes.json();
      const sData = await sRes.json();
      setApprovals(qData.approvals ?? []);
      setStats(sData.stats ?? { pending: 0, approvedToday: 0, rejectedToday: 0, avgApprovalHours: 0 });
    } catch (err) {
      console.error('Approvals fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterPriority, filterDepartment, search, filterDate, viewMode, managerEmail]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Realtime subscription ────────────────────────────────────────────────────

  useEffect(() => {
    const channel = supabase
      .channel('approval_requests_live_v2')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'approval_requests',
      }, () => { fetchData(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchData]);

  // ── Quick action ──────────────────────────────────────────────────────────────

  const handleQuickAction = async (
    id: string,
    action: 'approved' | 'rejected',
    e: React.MouseEvent
  ) => {
    e.preventDefault();
    e.stopPropagation();

    // Guard: don't act if already processing this row
    if (processingIds.has(id)) return;

    // ── Optimistic lock: mark as processing + optimistically update status ──
    setProcessingIds((prev) => new Set(prev).add(id));
    setApprovals((prev) =>
      prev.map((ar) =>
        ar.id === id ? { ...ar, status: action } : ar
      )
    );

    try {
      const res = await fetch(`/api/approvals/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      const data = await res.json();

      if (res.status === 409 || data.code === 'APPROVAL_ALREADY_PROCESSED') {
        // Another session already processed this — refresh to get true state
        if (data.approval) {
          setApprovals((prev) =>
            prev.map((ar) => (ar.id === id ? { ...ar, ...data.approval } : ar))
          );
        } else {
          fetchData();
        }
        return;
      }

      if (!res.ok || !data.success) {
        // Real error — rollback optimistic update
        console.error('Quick action error:', data.error);
        fetchData();
        return;
      }

      // Success — update with confirmed server state
      if (data.approval) {
        setApprovals((prev) =>
          prev.map((ar) => (ar.id === id ? { ...ar, ...data.approval } : ar))
        );
      }
    } catch (err) {
      console.error('Quick action network error:', err);
      // Rollback on network error
      fetchData();
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };


  // ── Derived data ──────────────────────────────────────────────────────────────
  const overdueCount = approvals.filter(isOverdue).length;
  const slaCompliance = approvals.length > 0
    ? Math.round(((approvals.length - overdueCount) / approvals.length) * 100)
    : 100;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen bg-[#F8FAFC]">
      <Sidebar />
      <div className="flex-1 min-h-screen overflow-auto bg-[#F8FAFC]">

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">

          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/25">
                <ClipboardCheck className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-[#111827]">Approvals Portal</h1>
                <p className="text-sm text-[#6B7280]">Enterprise manager approval queue — data-driven routing</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* RBAC Role Switcher */}
              <div className="relative">
                <button
                  onClick={() => setShowRolePanel(!showRolePanel)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white hover:bg-gray-50 border border-[#E5E7EB] text-sm text-[#374151] transition-colors"
                >
                  <Shield className="h-3.5 w-3.5" />
                  <span>{viewMode === 'admin' ? 'Admin View' : `Manager: ${managerEmail || 'set email'}`}</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>

                {showRolePanel && (
                  <div className="absolute right-0 top-full mt-1 w-80 bg-white border border-[#E5E7EB] rounded-xl p-4 shadow-xl z-50 space-y-3">
                    <p className="text-xs font-bold text-[#6B7280] uppercase tracking-wider">View Mode</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => applyViewMode('admin')}
                        className={cn(
                          'flex-1 py-2 rounded-lg text-xs font-semibold transition-colors',
                          viewMode === 'admin'
                            ? 'bg-violet-600 text-white'
                            : 'bg-gray-100 text-[#6B7280] hover:bg-gray-200'
                        )}
                      >
                        Admin (All)
                      </button>
                      <button
                        onClick={() => setViewMode('manager')}
                        className={cn(
                          'flex-1 py-2 rounded-lg text-xs font-semibold transition-colors',
                          viewMode === 'manager'
                            ? 'bg-amber-600 text-white'
                            : 'bg-gray-100 text-[#6B7280] hover:bg-gray-200'
                        )}
                      >
                        Manager View
                      </button>
                    </div>

                    {/* Manager email input — always visible for easy switching */}
                    <div className="space-y-2">
                      <p className="text-xs text-[#6B7280]">
                        {viewMode === 'manager'
                          ? 'Manager email (scopes queue to this manager):'
                          : 'Enter manager email to switch to Manager View:'}
                      </p>
                      <input
                        type="email"
                        placeholder="manager@company.com"
                        value={managerEmailInput}
                        onChange={(e) => setManagerEmailInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && managerEmailInput.trim()) {
                            applyViewMode('manager', managerEmailInput.trim());
                          }
                        }}
                        className="w-full px-3 py-2 rounded-lg bg-white border border-[#E5E7EB] text-sm text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:border-amber-500/50"
                        autoFocus
                      />
                      <button
                        onClick={() => {
                          if (managerEmailInput.trim()) {
                            applyViewMode('manager', managerEmailInput.trim());
                          }
                        }}
                        disabled={!managerEmailInput.trim()}
                        className="w-full py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors"
                      >
                        Apply Manager View
                      </button>
                      {viewMode === 'manager' && managerEmail && (
                        <button
                          onClick={() => applyViewMode('admin')}
                          className="w-full py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-[#6B7280] text-xs transition-colors"
                        >
                          Clear — Switch to Admin View
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={fetchData}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white hover:bg-gray-50 border border-[#E5E7EB] text-sm text-[#374151] transition-colors"
              >
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                Refresh
              </button>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Pending"
              value={stats.pending}
              icon={Clock}
              color="#f59e0b"
              sub="Awaiting decision"
              pulse={stats.pending > 0}
            />
            <StatCard label="Approved Today" value={stats.approvedToday} icon={CheckCircle2} color="#10b981" />
            <StatCard label="Rejected Today" value={stats.rejectedToday} icon={XCircle} color="#ef4444" />
            <StatCard
              label="SLA Compliance"
              value={`${slaCompliance}%`}
              icon={TrendingUp}
              color={slaCompliance >= 90 ? '#10b981' : slaCompliance >= 70 ? '#f59e0b' : '#ef4444'}
              sub={overdueCount > 0 ? `${overdueCount} overdue >24h` : 'All within SLA'}
            />
          </div>

          {/* Avg Time sub-row */}
          <div className="flex items-center gap-3 px-1">
            <span className="text-xs text-[#6B7280]">Avg Approval Time:</span>
            <span className="text-xs font-semibold text-[#374151]">
              {stats.avgApprovalHours > 0 ? `${stats.avgApprovalHours}h` : '—'}
            </span>
            {viewMode === 'manager' && managerEmail && (
              <>
                <span className="text-xs text-gray-600">|</span>
                <span className="text-xs text-amber-400 flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  Manager view: {managerEmail}
                </span>
              </>
            )}
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6B7280]" />
              <input
                type="text"
                placeholder="Search by employee, intent, email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-white border border-[#E5E7EB] text-sm text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:border-violet-500/50"
              />
            </div>
            <div className="flex gap-2 flex-wrap items-center">
              <Filter className="h-4 w-4 text-[#6B7280] shrink-0" />

              {/* Status */}
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-3 py-2.5 rounded-lg bg-white border border-[#E5E7EB] text-sm text-[#374151] focus:outline-none focus:border-violet-500/50"
              >
                <option value="all">All Status</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="expired">Expired</option>
              </select>

              {/* Priority */}
              <select
                value={filterPriority}
                onChange={(e) => setFilterPriority(e.target.value)}
                className="px-3 py-2.5 rounded-lg bg-white border border-[#E5E7EB] text-sm text-[#374151] focus:outline-none focus:border-violet-500/50"
              >
                <option value="all">All Priority</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>

              {/* Department */}
              <select
                value={filterDepartment}
                onChange={(e) => setFilterDepartment(e.target.value)}
                className="px-3 py-2.5 rounded-lg bg-white border border-[#E5E7EB] text-sm text-[#374151] focus:outline-none focus:border-violet-500/50"
              >
                <option value="">All Departments</option>
                <option value="HR">HR</option>
                <option value="IT">IT</option>
                <option value="Finance">Finance</option>
                <option value="Operations">Operations</option>
                <option value="Engineering">Engineering</option>
                <option value="Sales">Sales</option>
                <option value="Marketing">Marketing</option>
                <option value="Legal">Legal</option>
                <option value="SAP Basis">SAP Basis</option>
                <option value="Network Team">Network Team</option>
              </select>

              {/* Date Range */}
              <select
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value as DateRange)}
                className="px-3 py-2.5 rounded-lg bg-white border border-[#E5E7EB] text-sm text-[#374151] focus:outline-none focus:border-violet-500/50"
              >
                <option value="all">All Time</option>
                <option value="today">Today</option>
                <option value="week">This Week</option>
                <option value="month">This Month</option>
              </select>
            </div>
          </div>

          {/* Overdue alert banner */}
          {overdueCount > 0 && filterStatus !== 'approved' && filterStatus !== 'rejected' && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0 animate-pulse" />
              <span className="text-sm">
                <strong>{overdueCount}</strong> pending request{overdueCount !== 1 ? 's' : ''} exceeded 24-hour SLA
              </span>
            </div>
          )}

          {/* Table */}
          <div className="bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden shadow-sm">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] gap-4 px-5 py-3 border-b border-[#E5E7EB] text-xs font-semibold text-[#6B7280] uppercase tracking-wider">
              <span>Employee</span>
              <span className="hidden md:block">Department</span>
              <span className="hidden lg:block">Intent</span>
              <span>Priority</span>
              <span>SLA</span>
              <span>Status</span>
              <span>Actions</span>
            </div>

            {/* Rows */}
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="flex gap-2 items-center text-gray-500">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Loading approvals...</span>
                </div>
              </div>
            ) : approvals.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <ClipboardCheck className="h-12 w-12 text-gray-700" />
                <p className="text-gray-500 text-sm">No approvals found</p>
                <p className="text-gray-600 text-xs">Try adjusting your filters</p>
              </div>
            ) : (
              approvals.map((ar) => {
                const pc = priorityConfig[ar.priority?.toLowerCase() ?? 'medium'] ?? priorityConfig.medium;
                const sc = statusConfig[ar.status] ?? statusConfig.pending;
                const StatusIcon = sc.icon;
                const overdue = isOverdue(ar);

                return (
                  <Link
                    key={ar.id}
                    href={`/approvals/${ar.id}`}
                    className={cn(
                      'grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] gap-4 px-5 py-4 border-b border-[#E5E7EB] hover:bg-gray-50 transition-colors items-center cursor-pointer',
                      overdue && 'bg-red-50'
                    )}
                  >
                    {/* Employee */}
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar name={ar.employee_name} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#111827] truncate">{ar.employee_name ?? '—'}</p>
                        <p className="text-xs text-[#6B7280] truncate">{ar.employee_email ?? '—'}</p>
                        <p className="text-xs text-[#9CA3AF] mt-0.5 flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {timeAgo(ar.created_at)}
                        </p>
                      </div>
                    </div>

                    {/* Department */}
                    <div className="hidden md:flex items-center gap-1.5 text-sm text-[#6B7280]">
                      <Building2 className="h-3.5 w-3.5 text-[#9CA3AF]" />
                      <span className="truncate max-w-[120px]">{ar.department ?? '—'}</span>
                    </div>

                    {/* Intent + type badge */}
                    <div className="hidden lg:block max-w-[180px]">
                      <p className="text-xs text-[#6B7280] truncate">{ar.intent ?? '—'}</p>
                      {ar.approval_type === 'acceptance' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 mt-0.5">
                          <Users className="h-2.5 w-2.5" />
                          Acceptance
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 mt-0.5">
                          <Shield className="h-2.5 w-2.5" />
                          Mgr Approval
                        </span>
                      )}
                      {ar.approval_type === 'acceptance' && ar.manager_name && (
                        <p className="text-[10px] text-[#9CA3AF] mt-0.5 truncate">Officer: {ar.manager_name}</p>
                      )}
                    </div>

                    {/* Priority */}
                    <span
                      className="text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap"
                      style={{ color: pc.color, background: pc.bg }}
                    >
                      {pc.label}
                    </span>

                    {/* SLA */}
                    <div>
                      {ar.status === 'pending' ? (
                        overdue ? (
                          <span className="text-xs font-semibold text-red-400 flex items-center gap-1 whitespace-nowrap">
                            <AlertCircle className="h-3 w-3 animate-pulse" />
                            Overdue
                          </span>
                        ) : (
                          <span className="text-xs text-emerald-400 font-medium">Within SLA</span>
                        )
                      ) : (
                        <span className="text-xs text-gray-600">—</span>
                      )}
                    </div>

                    {/* Status */}
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: sc.bg }}>
                      <StatusIcon className="h-3.5 w-3.5" style={{ color: sc.color }} />
                      <span className="text-xs font-semibold" style={{ color: sc.color }}>{sc.label}</span>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      {/* Show action buttons ONLY if status is pending */}
                      {ar.status === 'pending' ? (
                        <>
                          <button
                            onClick={(e) => handleQuickAction(ar.id, 'approved', e)}
                            disabled={processingIds.has(ar.id)}
                            className="h-8 w-8 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 flex items-center justify-center text-emerald-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Quick Approve"
                          >
                            {processingIds.has(ar.id)
                              ? <RefreshCw className="h-4 w-4 animate-spin" />
                              : <CheckCircle2 className="h-4 w-4" />
                            }
                          </button>
                          <button
                            onClick={(e) => handleQuickAction(ar.id, 'rejected', e)}
                            disabled={processingIds.has(ar.id)}
                            className="h-8 w-8 rounded-lg bg-red-500/10 hover:bg-red-500/20 flex items-center justify-center text-red-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Quick Reject"
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                        </>
                      ) : (
                        /* Terminal state — no action buttons, just navigate */
                        <Link href={`/approvals/${ar.id}`}>
                          <ChevronRight className="h-4 w-4 text-gray-600" />
                        </Link>
                      )}
                    </div>
                  </Link>
                );
              })
            )}
          </div>

          {/* Footer summary */}
          {approvals.length > 0 && (
            <p className="text-xs text-[#9CA3AF] text-center">
              Showing {approvals.length} approval{approvals.length !== 1 ? 's' : ''}
              {viewMode === 'manager' && managerEmail ? ` · Scoped to ${managerEmail}` : ' · All managers'}
            </p>
          )}

        </div>
      </div>
    </div>
  );
}
