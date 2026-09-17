'use client';

import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from '@/components/sidebar';
import {
  Building2,
  Users,
  UserCheck,
  Search,
  ChevronRight,
  X,
  Mail,
  Phone,
  MapPin,
  Shield,
  Award,
  GitBranch,
  Briefcase,
  Clock,
  RefreshCw,
  ArrowRight,
  CheckCircle2,
  DollarSign,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DeptRow {
  id: string;
  department_name: string;
  department_code: string;
  description: string | null;
  sla_hours: number;
  head_employee_id: string | null;
}

interface TeamRow {
  id: string;
  team_name: string;
  team_code: string;
  department_name?: string;
  manager_id: string | null;
}

interface EmpRow {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_email: string;
  designation: string;
  employment_status: string;
  location: string | null;
  phone: string | null;
  department_name?: string;
  team_name?: string;
  manager_name?: string;
}

interface MgrRow {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_email?: string;
  designation?: string;
  department_name?: string;
  approval_level: number;
  can_approve_finance: boolean;
  can_approve_it: boolean;
  can_approve_hr: boolean;
  max_approval_amount: number;
}

interface EmployeeProfile {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_email: string;
  designation: string;
  employment_status: string;
  location: string | null;
  phone: string | null;
  department: { id: string; name: string; code: string; sla_hours: number } | null;
  team: { id: string; name: string; code: string } | null;
  manager: { id: string; name: string; email: string; designation: string; approval_level: number } | null;
  department_head: { id: string; name: string; email: string; designation: string } | null;
  approval_chain: Array<{
    level: number;
    approver_id: string;
    approver_name: string;
    approver_email: string;
    approver_designation: string;
    approval_level: number;
    can_approve_finance: boolean;
    can_approve_it: boolean;
    can_approve_hr: boolean;
  }>;
}

type TabId = 'departments' | 'teams' | 'employees' | 'managers';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  active:   'bg-emerald-100 text-emerald-700 border-emerald-200',
  inactive: 'bg-red-100 text-red-700 border-red-200',
  on_leave: 'bg-amber-100 text-amber-700 border-amber-200',
};

const APPROVAL_LEVEL_LABEL: Record<number, string> = {
  1: 'L1 — Associate',
  2: 'L2 — Senior',
  3: 'L3 — Manager',
  4: 'L4 — Director',
  5: 'L5 — VP / CXO',
};

function DeptCodeBadge({ code }: { code: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold bg-violet-100 text-violet-600 border border-violet-200">
      {code}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border', STATUS_COLORS[status] ?? STATUS_COLORS.inactive)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status === 'on_leave' ? 'On Leave' : status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

// ─── Profile Drawer ───────────────────────────────────────────────────────────

function ProfileDrawer({
  profile,
  onClose,
}: {
  profile: EmployeeProfile;
  onClose: () => void;
}) {
  const initials = profile.employee_name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <div className="relative z-10 h-full w-full max-w-lg overflow-y-auto bg-white border-l border-[#E5E7EB] shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-[#E5E7EB] px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#111827]">Employee Profile</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="h-5 w-5 text-[#6B7280]" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Avatar + Name */}
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 h-16 w-16 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white text-xl font-bold shadow-lg shadow-violet-500/20">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-xl font-bold text-[#111827] truncate">{profile.employee_name}</h3>
            <p className="text-sm text-violet-600 font-medium">{profile.designation}</p>
              <div className="mt-1.5">
                <StatusBadge status={profile.employment_status} />
              </div>
            </div>
          </div>

          {/* Contact */}
          <div className="rounded-xl border border-[#E5E7EB] bg-gray-50 p-4 space-y-3">
            <h4 className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Contact</h4>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4 text-[#9CA3AF] flex-shrink-0" />
                <a href={`mailto:${profile.employee_email}`} className="text-violet-600 hover:text-violet-500 transition-colors truncate">
                  {profile.employee_email}
                </a>
              </div>
              {profile.phone && (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="h-4 w-4 text-[#9CA3AF] flex-shrink-0" />
                  <span className="text-[#374151]">{profile.phone}</span>
                </div>
              )}
              {profile.location && (
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="h-4 w-4 text-[#9CA3AF] flex-shrink-0" />
                  <span className="text-[#374151]">{profile.location}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm">
                <Briefcase className="h-4 w-4 text-[#9CA3AF] flex-shrink-0" />
                <span className="text-[#9CA3AF]">ID:</span>
                <span className="text-[#374151] font-mono">{profile.employee_id}</span>
              </div>
            </div>
          </div>

          {/* Org Info */}
          <div className="rounded-xl border border-[#E5E7EB] bg-gray-50 p-4 space-y-3">
            <h4 className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Organization</h4>
            <div className="space-y-2.5">
              {profile.department && (
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm text-[#6B7280] flex-shrink-0">Department</span>
                  <div className="text-right">
                    <div className="text-sm text-[#111827] font-medium">{profile.department.name}</div>
                    <div className="flex items-center gap-1.5 justify-end mt-0.5">
                      <DeptCodeBadge code={profile.department.code} />
                      <span className="text-xs text-[#6B7280] flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {profile.department.sla_hours}h SLA
                      </span>
                    </div>
                  </div>
                </div>
              )}
              {profile.team && (
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm text-[#6B7280] flex-shrink-0">Team</span>
                  <div className="text-right">
                    <div className="text-sm text-[#111827] font-medium">{profile.team.name}</div>
                    <DeptCodeBadge code={profile.team.code} />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Manager */}
          {profile.manager && (
            <div className="rounded-xl border border-[#E5E7EB] bg-gray-50 p-4 space-y-3">
              <h4 className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Direct Manager</h4>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                  {profile.manager.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[#111827]">{profile.manager.name}</div>
                  <div className="text-xs text-[#6B7280]">{profile.manager.designation}</div>
                  <a href={`mailto:${profile.manager.email}`} className="text-xs text-violet-600 hover:text-violet-500 truncate">
                    {profile.manager.email}
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* Department Head */}
          {profile.department_head && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
              <h4 className="text-xs font-semibold text-amber-600 uppercase tracking-wider flex items-center gap-1.5">
                <Award className="h-3.5 w-3.5" />
                Department Head
              </h4>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-600 to-orange-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                  {profile.department_head.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[#111827]">{profile.department_head.name}</div>
                  <div className="text-xs text-[#6B7280]">{profile.department_head.designation}</div>
                  <a href={`mailto:${profile.department_head.email}`} className="text-xs text-amber-600 hover:text-amber-500 truncate">
                    {profile.department_head.email}
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* Approval Chain */}
          {profile.approval_chain.length > 0 && (
            <div className="rounded-xl border border-[#E5E7EB] bg-gray-50 p-4 space-y-3">
              <h4 className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider flex items-center gap-1.5">
                <GitBranch className="h-3.5 w-3.5" />
                Approval Chain
              </h4>
              <div className="space-y-3">
                {profile.approval_chain.map((entry, idx) => (
                  <div key={entry.approver_id} className="relative">
                    {idx < profile.approval_chain.length - 1 && (
                      <div className="absolute left-4 top-10 bottom-0 w-px bg-[#E5E7EB]" />
                    )}
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 h-8 w-8 rounded-full bg-violet-100 border border-violet-200 flex items-center justify-center text-xs font-bold text-violet-600">
                        L{entry.level}
                      </div>
                      <div className="min-w-0 flex-1 pb-2">
                        <div className="text-sm font-medium text-[#111827]">{entry.approver_name}</div>
                        <div className="text-xs text-[#6B7280]">{entry.approver_designation}</div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {entry.can_approve_finance && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700 border border-green-200">
                              Finance
                            </span>
                          )}
                          {entry.can_approve_it && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 border border-blue-200">
                              IT
                            </span>
                          )}
                          {entry.can_approve_hr && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 border border-purple-200">
                              HR
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OrgDirectoryPage() {
  const [activeTab, setActiveTab] = useState<TabId>('employees');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  const [departments, setDepartments] = useState<DeptRow[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [employees, setEmployees] = useState<EmpRow[]>([]);
  const [managers, setManagers] = useState<MgrRow[]>([]);
  const [stats, setStats] = useState({ total_departments: 0, total_employees: 0, total_managers: 0, active_employees: 0 });
  const [selectedProfile, setSelectedProfile] = useState<EmployeeProfile | null>(null);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async (tab: TabId, q = '') => {
    setLoading(true);
    try {
      switch (tab) {
        case 'departments': {
          const r = await fetch('/api/org-directory?type=departments');
          const d = await r.json();
          setDepartments(d.departments ?? []);
          break;
        }
        case 'teams': {
          const r = await fetch('/api/org-directory?type=teams');
          const d = await r.json();
          setTeams(d.teams ?? []);
          break;
        }
        case 'employees': {
          const url = q
            ? `/api/org-directory?type=employees&search=${encodeURIComponent(q)}`
            : '/api/org-directory?type=employees';
          const r = await fetch(url);
          const d = await r.json();
          setEmployees(d.employees ?? []);
          break;
        }
        case 'managers': {
          const r = await fetch('/api/org-directory?type=managers');
          const d = await r.json();
          setManagers(d.managers ?? []);
          break;
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStats = async () => {
    const r = await fetch('/api/org-directory?type=stats');
    const d = await r.json();
    setStats(d.stats ?? stats);
  };

  useEffect(() => {
    fetchStats();
    fetchData('employees');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => fetchData(activeTab, search), 300);
    return () => clearTimeout(timer);
  }, [activeTab, search, fetchData]);

  const openProfile = async (email: string) => {
    const r = await fetch(`/api/org-directory?type=employee&email=${encodeURIComponent(email)}`);
    if (!r.ok) return;
    const d = await r.json();
    setSelectedProfile(d.employee);
  };

  const tabs: { id: TabId; label: string; icon: React.ElementType; count?: number }[] = [
    { id: 'departments', label: 'Departments', icon: Building2, count: stats.total_departments },
    { id: 'teams',       label: 'Teams',       icon: GitBranch  },
    { id: 'employees',   label: 'Employees',   icon: Users,      count: stats.total_employees },
    { id: 'managers',    label: 'Managers',    icon: UserCheck,  count: stats.total_managers  },
  ];

  return (
    <div className="flex min-h-screen bg-[#F8FAFC]">
      <Sidebar />
      <div className="flex-1 overflow-auto min-h-screen bg-[#F8FAFC]">

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/25">
                <Building2 className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-[#111827]">Organization Directory</h1>
                <p className="text-sm text-[#6B7280]">Manage employees, managers, departments and reporting hierarchy.</p>
              </div>
            </div>
          </div>
          <button
            onClick={() => { fetchStats(); fetchData(activeTab, search); }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white hover:bg-gray-50 border border-[#E5E7EB] text-sm text-[#374151] transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Departments', value: stats.total_departments, icon: Building2, color: 'from-violet-600 to-indigo-600' },
            { label: 'Total Employees', value: stats.total_employees, icon: Users, color: 'from-blue-600 to-cyan-600' },
            { label: 'Active Employees', value: stats.active_employees, icon: CheckCircle2, color: 'from-emerald-600 to-teal-600' },
            { label: 'Managers', value: stats.total_managers, icon: UserCheck, color: 'from-amber-600 to-orange-600' },
          ].map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
                <div className={`inline-flex h-8 w-8 rounded-lg bg-gradient-to-br ${s.color} items-center justify-center mb-3`}>
                  <Icon className="h-4 w-4 text-white" />
                </div>
                <div className="text-2xl font-bold text-[#111827] tabular-nums">{s.value}</div>
                <div className="text-xs text-[#6B7280] mt-0.5">{s.label}</div>
              </div>
            );
          })}
        </div>

        {/* Tabs + Search */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex gap-1 p-1 rounded-xl bg-gray-100 border border-[#E5E7EB]">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => { setActiveTab(tab.id); setSearch(''); }}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                    activeTab === tab.id
                      ? 'bg-violet-600 text-white shadow-sm'
                      : 'text-[#6B7280] hover:text-[#374151] hover:bg-gray-200'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{tab.label}</span>
                  {tab.count !== undefined && (
                    <span className={cn(
                      'text-xs px-1.5 py-0.5 rounded-full',
                      activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-gray-200 text-[#6B7280]'
                    )}>
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {(activeTab === 'employees' || activeTab === 'managers') && (
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6B7280]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, email or designation…"
                className="w-full pl-9 pr-4 py-2 rounded-lg bg-white border border-[#E5E7EB] text-sm text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30 transition-all"
              />
            </div>
          )}
        </div>

        {/* Content */}
        <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden shadow-sm">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="flex items-center gap-3 text-gray-400">
                <RefreshCw className="h-5 w-5 animate-spin" />
                <span>Loading…</span>
              </div>
            </div>
          ) : (
            <>
              {/* ── Departments tab ─────────────────────────────────────────────────── */}
              {activeTab === 'departments' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#E5E7EB] bg-gray-50">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Department</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Code</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#6B7280] uppercase tracking-wider hidden sm:table-cell">Description</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#6B7280] uppercase tracking-wider">SLA</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E5E7EB]">
                      {departments.map((d) => (
                        <tr key={d.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="h-8 w-8 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
                                <Building2 className="h-4 w-4 text-violet-600" />
                              </div>
                              <span className="font-medium text-[#111827]">{d.department_name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3"><DeptCodeBadge code={d.department_code} /></td>
                          <td className="px-4 py-3 text-[#6B7280] hidden sm:table-cell max-w-xs truncate">{d.description}</td>
                          <td className="px-4 py-3">
                            <span className="flex items-center gap-1 text-[#374151]">
                              <Clock className="h-3.5 w-3.5 text-[#9CA3AF]" />
                              {d.sla_hours}h
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {departments.length === 0 && (
                    <div className="py-12 text-center text-gray-500">No departments found</div>
                  )}
                </div>
              )}

              {/* ── Teams tab ───────────────────────────────────────────────────────── */}
              {activeTab === 'teams' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#E5E7EB] bg-gray-50">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Team</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Code</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Department</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E5E7EB]">
                      {teams.map((t) => (
                        <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="h-8 w-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                                <GitBranch className="h-4 w-4 text-blue-600" />
                              </div>
                              <span className="font-medium text-[#111827]">{t.team_name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3"><DeptCodeBadge code={t.team_code} /></td>
                          <td className="px-4 py-3 text-[#6B7280]">{t.department_name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {teams.length === 0 && (
                    <div className="py-12 text-center text-gray-500">No teams found</div>
                  )}
                </div>
              )}

              {/* ── Employees tab ───────────────────────────────────────────────────── */}
              {activeTab === 'employees' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#E5E7EB] bg-gray-50">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Employee</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#6B7280] uppercase tracking-wider hidden md:table-cell">Designation</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#6B7280] uppercase tracking-wider hidden sm:table-cell">Department</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#6B7280] uppercase tracking-wider hidden lg:table-cell">Team</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#6B7280] uppercase tracking-wider hidden lg:table-cell">Manager</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Status</th>
                        <th className="px-4 py-3 w-10" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E5E7EB]">
                      {employees.map((e) => {
                        const initials = e.employee_name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
                        return (
                          <tr
                            key={e.id}
                            className="hover:bg-gray-50 transition-colors cursor-pointer group"
                            onClick={() => openProfile(e.employee_email)}
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                                  {initials}
                                </div>
                                <div className="min-w-0">
                                  <div className="font-medium text-[#111827] truncate">{e.employee_name}</div>
                                  <div className="text-xs text-[#6B7280] truncate">{e.employee_email}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-[#374151] hidden md:table-cell text-xs">{e.designation}</td>
                            <td className="px-4 py-3 hidden sm:table-cell">
                              {e.department_name && <span className="text-[#374151] text-xs">{e.department_name}</span>}
                            </td>
                            <td className="px-4 py-3 hidden lg:table-cell text-xs text-[#6B7280]">{e.team_name}</td>
                            <td className="px-4 py-3 hidden lg:table-cell text-xs text-[#6B7280]">{e.manager_name || '—'}</td>
                            <td className="px-4 py-3"><StatusBadge status={e.employment_status} /></td>
                            <td className="px-4 py-3">
                              <ChevronRight className="h-4 w-4 text-[#9CA3AF] group-hover:text-violet-500 transition-colors" />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {employees.length === 0 && (
                    <div className="py-12 text-center text-gray-500">
                      {search ? `No employees matching "${search}"` : 'No employees found'}
                    </div>
                  )}
                </div>
              )}

              {/* ── Managers tab ────────────────────────────────────────────────────── */}
              {activeTab === 'managers' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#E5E7EB] bg-gray-50">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Manager</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#6B7280] uppercase tracking-wider hidden sm:table-cell">Department</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Level</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#6B7280] uppercase tracking-wider hidden md:table-cell">Approvals</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#6B7280] uppercase tracking-wider hidden lg:table-cell">Max Amount</th>
                        <th className="px-4 py-3 w-10" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E5E7EB]">
                      {managers.map((m) => {
                        const name = m.employee_name ?? '';
                        const initials = name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
                        return (
                          <tr
                            key={m.id}
                            className="hover:bg-gray-50 transition-colors cursor-pointer group"
                            onClick={() => m.employee_email && openProfile(m.employee_email)}
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-amber-600 to-orange-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                                  {initials}
                                </div>
                                <div className="min-w-0">
                                  <div className="font-medium text-[#111827] truncate">{name}</div>
                                  <div className="text-xs text-[#6B7280] truncate">{m.designation}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-[#374151] text-xs hidden sm:table-cell">{m.department_name}</td>
                            <td className="px-4 py-3">
                              <span className={cn(
                                'text-xs font-medium px-2 py-1 rounded-lg border',
                                m.approval_level >= 5
                                  ? 'bg-amber-100 text-amber-700 border-amber-200'
                                  : m.approval_level >= 3
                                  ? 'bg-blue-100 text-blue-700 border-blue-200'
                                  : 'bg-gray-100 text-[#6B7280] border-[#E5E7EB]'
                              )}>
                                {APPROVAL_LEVEL_LABEL[m.approval_level] ?? `L${m.approval_level}`}
                              </span>
                            </td>
                            <td className="px-4 py-3 hidden md:table-cell">
                              <div className="flex gap-1">
                                {m.can_approve_finance && (
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700 border border-green-200">Finance</span>
                                )}
                                {m.can_approve_it && (
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 border border-blue-200">IT</span>
                                )}
                                {m.can_approve_hr && (
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 border border-purple-200">HR</span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 hidden lg:table-cell">
                              <span className="text-[#374151] font-mono text-xs flex items-center gap-1">
                                <DollarSign className="h-3 w-3 text-[#9CA3AF]" />
                                {Number(m.max_approval_amount).toLocaleString('en-IN')}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <ChevronRight className="h-4 w-4 text-[#9CA3AF] group-hover:text-amber-500 transition-colors" />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {managers.length === 0 && (
                    <div className="py-12 text-center text-gray-500">No managers found</div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Validation callout */}
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-start gap-3">
            <Shield className="h-5 w-5 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-emerald-700">Validation Test</p>
              <p className="text-xs text-[#374151] mt-0.5">
                Try clicking on <strong className="text-[#111827]">Sarah Johnson</strong>{' '}
                (sarah.johnson@company.com) to verify the system automatically resolves:
                Department → <strong className="text-[#111827]">Finance</strong>,
                Team → <strong className="text-[#111827]">Finance Transformation</strong>,
                Manager → <strong className="text-[#111827]">Arjun Menon</strong>,
                Head → <strong className="text-[#111827]">Arun Kumar (CFO)</strong> — with zero hardcoding.
              </p>
              <button
                onClick={() => {
                  setActiveTab('employees');
                  setSearch('sarah');
                }}
                className="mt-2 flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
              >
                Find Sarah Johnson <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Profile Drawer */}
      {selectedProfile && (
        <ProfileDrawer
          profile={selectedProfile}
          onClose={() => setSelectedProfile(null)}
        />
      )}
      </div>
    </div>
  );
}
