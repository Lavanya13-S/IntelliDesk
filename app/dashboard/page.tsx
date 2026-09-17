'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { DashboardStats, DepartmentCount, PriorityCount, DecisionStats } from '@/lib/types';
import { Sidebar } from '@/components/sidebar';
import { StatCard } from '@/components/stat-card';
import { DepartmentChart } from '@/components/department-chart';
import { PriorityChart } from '@/components/priority-chart';
import { RecentEmails } from '@/components/recent-emails';
import {
  Mail, Clock, CheckCircle, AlertTriangle, BrainCircuit, Activity,
  Zap, PhoneForwarded, ShieldAlert, UserCheck, ClipboardCheck,
  CheckCircle2, XCircle, Timer, Briefcase, ShieldCheck,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    totalEmails: 0, pending: 0, resolved: 0, critical: 0,
  });
  const [departments, setDepartments] = useState<DepartmentCount[]>([]);
  const [priorities, setPriorities] = useState<PriorityCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [agentStats, setAgentStats] = useState({ active: 11, processed: 0, accuracy: 0 });
  const [decisionStats, setDecisionStats] = useState<DecisionStats>({
    autoResolved: 0, approvalRequired: 0, escalated: 0, criticalIncidents: 0,
  });
  const [approvalStats, setApprovalStats] = useState({
    pending: 0, approvedToday: 0, rejectedToday: 0, avgApprovalHours: 0,
  });
  const [deptStats, setDeptStats] = useState({
    open: 0, inProgress: 0, qualityCheck: 0, completedToday: 0, slaBreached: 0,
  });

  useEffect(() => { fetchDashboardData(); }, []);

  // Supabase Realtime — dept_work_items auto-refresh
  useEffect(() => {
    const channel = supabase
      .channel('dashboard_dept_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dept_work_items' }, () => {
        fetchDeptStats();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  async function fetchDeptStats() {
    try {
      const res = await fetch('/api/dept/stats');
      if (res.ok) {
        const d = await res.json();
        const s = d.stats;
        if (s) {
          setDeptStats({
            open:           s.open           ?? 0,
            inProgress:     s.inProgress      ?? 0,
            qualityCheck:   s.qualityCheck    ?? 0,
            completedToday: s.completedToday  ?? 0,
            slaBreached:    s.slaBreached     ?? 0,
          });
        }
      }
    } catch { /* non-fatal */ }
  }

  async function fetchDashboardData() {
    try {
      const { data: emails, error: emailError } = await supabase
        .from('emails')
        .select('*');

      if (emailError) throw emailError;

      const totalEmails = emails?.length || 0;
      const pending = emails?.filter((e) => e.status === 'pending').length || 0;
      const resolved = emails?.filter((e) => e.status === 'resolved').length || 0;
      const critical = emails?.filter((e) => e.priority === 'critical').length || 0;

      setStats({ totalEmails, pending, resolved, critical });

      const deptMap = new Map<string, number>();
      emails?.forEach((e) => {
        const dept = e.department || 'Unclassified';
        deptMap.set(dept, (deptMap.get(dept) || 0) + 1);
      });
      setDepartments(Array.from(deptMap.entries()).map(([department, count]) => ({ department, count })));

      const prioMap = new Map<string, number>();
      emails?.forEach((e) => {
        const p = e.priority || 'medium';
        prioMap.set(p, (prioMap.get(p) || 0) + 1);
      });
      setPriorities(Array.from(prioMap.entries()).map(([priority, count]) => ({ priority, count })));

      const processed = emails?.filter((e) => e.status !== 'pending').length || 0;
      setAgentStats({
        active: 11,
        processed,
        accuracy: totalEmails > 0 ? Math.round((processed / totalEmails) * 100) : 0,
      });

      // Fetch decision stats from decision_logs
      const { data: decisionData } = await supabase
        .from('decision_logs')
        .select('decision, risk_level');

      if (decisionData) {
        setDecisionStats({
          autoResolved:      decisionData.filter((d: any) => d.decision === 'AUTO_RESPONSE').length,
          approvalRequired:  decisionData.filter((d: any) => d.decision === 'HUMAN_APPROVAL_REQUIRED').length,
          escalated:         decisionData.filter((d: any) => d.decision === 'ESCALATE').length,
          criticalIncidents: decisionData.filter((d: any) => d.risk_level === 'Critical').length,
        });
      }

      // Fetch live approval workflow stats
      try {
        const approvalRes = await fetch('/api/approvals?type=stats');
        if (approvalRes.ok) {
          const approvalData = await approvalRes.json();
          if (approvalData.stats) setApprovalStats(approvalData.stats);
        }
      } catch { /* non-fatal */ }

      // Fetch dept queue stats
      await fetchDeptStats();
    } catch (err) {
      console.error('Dashboard data error:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-pulse text-muted-foreground">Loading dashboard...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
              <p className="text-muted-foreground mt-1">Overview of your helpdesk performance</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-sm text-muted-foreground">AI Agents Active</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard title="Total Emails"  value={stats.totalEmails} icon={<Mail className="h-5 w-5" />}          color="blue"  />
            <StatCard title="Pending"       value={stats.pending}     icon={<Clock className="h-5 w-5" />}         color="amber" />
            <StatCard title="Resolved"      value={stats.resolved}    icon={<CheckCircle className="h-5 w-5" />}   color="green" />
            <StatCard title="Critical"      value={stats.critical}    icon={<AlertTriangle className="h-5 w-5" />} color="red"   />
          </div>

          {/* AI Agent Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
              <CardContent className="p-5">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-blue-500/10 rounded-lg">
                    <BrainCircuit className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Active Agents</p>
                    <p className="text-2xl font-bold">{agentStats.active}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
              <CardContent className="p-5">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-green-500/10 rounded-lg">
                    <Activity className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Processed</p>
                    <p className="text-2xl font-bold">{agentStats.processed}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-violet-50 to-violet-100 border-violet-200">
              <CardContent className="p-5">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-violet-500/10 rounded-lg">
                    <Zap className="h-5 w-5 text-violet-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Accuracy</p>
                    <p className="text-2xl font-bold">{agentStats.accuracy}%</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <DepartmentChart data={departments} />
            <PriorityChart data={priorities} />
          </div>

          {/* Decision Intelligence Row */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <ShieldAlert className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Decision Intelligence</h2>
              <span className="text-xs text-muted-foreground ml-1">— powered by Decision & Escalation Agent</span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard title="Auto Resolved"      value={decisionStats.autoResolved}     icon={<Zap className="h-5 w-5" />}            color="green" />
              <StatCard title="Approval Required"  value={decisionStats.approvalRequired} icon={<UserCheck className="h-5 w-5" />}      color="amber" />
              <StatCard title="Escalated"          value={decisionStats.escalated}        icon={<PhoneForwarded className="h-5 w-5" />} color="amber" />
              <StatCard title="Critical Incidents" value={decisionStats.criticalIncidents} icon={<ShieldAlert className="h-5 w-5" />}   color="red"   />
            </div>
          </div>

          {/* Approval Workflow KPIs */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <ClipboardCheck className="h-5 w-5 text-amber-500" />
              <h2 className="text-lg font-semibold">Approval Workflow</h2>
              <a href="/approvals" className="text-xs text-muted-foreground ml-1 hover:text-amber-500 transition-colors">→ View portal</a>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard title="Pending Approvals" value={approvalStats.pending}          icon={<Clock className="h-5 w-5" />}          color="amber" />
              <StatCard title="Approved Today"    value={approvalStats.approvedToday}    icon={<CheckCircle className="h-5 w-5" />}    color="green" />
              <StatCard title="Rejected Today"    value={approvalStats.rejectedToday}    icon={<AlertTriangle className="h-5 w-5" />}  color="red"   />
              <StatCard title="Avg Approval Time" value={approvalStats.avgApprovalHours > 0 ? `${approvalStats.avgApprovalHours}h` : '—'} icon={<Zap className="h-5 w-5" />} color="blue" />
            </div>
          </div>

          <RecentEmails />

          {/* Department Processing KPIs */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Briefcase className="h-5 w-5 text-violet-500" />
              <h2 className="text-lg font-semibold">Department Processing</h2>
              <a href="/department" className="text-xs text-muted-foreground ml-1 hover:text-violet-500 transition-colors">→ View queue</a>
              <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
                Live
              </span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <StatCard title="Open"            value={deptStats.open}           icon={<Briefcase className="h-5 w-5" />}   color="blue"  />
              <StatCard title="In Progress"     value={deptStats.inProgress}     icon={<Activity className="h-5 w-5" />}    color="amber" />
              <StatCard title="Quality Check"   value={deptStats.qualityCheck}   icon={<ShieldCheck className="h-5 w-5" />} color="blue"  />
              <StatCard title="Completed Today" value={deptStats.completedToday} icon={<CheckCircle className="h-5 w-5" />} color="green" />
              <StatCard title="SLA Breached"    value={deptStats.slaBreached}    icon={<ShieldAlert className="h-5 w-5" />} color="red"   />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
