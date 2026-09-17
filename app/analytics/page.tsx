'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Sidebar } from '@/components/sidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import {
  BarChart3,
  TrendingUp,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Activity,
} from 'lucide-react';
import type { Email } from '@/lib/types';

interface AnalyticsData {
  departmentCounts: { name: string; value: number }[];
  priorityCounts: { name: string; value: number }[];
  sentimentCounts: { name: string; value: number }[];
  intentCounts: { name: string; value: number }[];
  dailyVolume: { date: string; count: number }[];
  resolutionTrend: { date: string; resolved: number; pending: number }[];
  topIssues: { issue: string; count: number }[];
  avgResolutionTime: number;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16', '#f97316'];

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAnalyticsData();
  }, []);

  async function fetchAnalyticsData() {
    try {
      const { data: emails, error } = await supabase.from('emails').select('*');
      if (error) throw error;

      const emailList: Email[] = emails || [];

      // Department counts
      const deptMap = new Map<string, number>();
      emailList.forEach((e) => {
        const dept = e.department || 'Unclassified';
        deptMap.set(dept, (deptMap.get(dept) || 0) + 1);
      });
      const departmentCounts = Array.from(deptMap.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);

      // Priority counts
      const prioMap = new Map<string, number>();
      emailList.forEach((e) => {
        const p = e.priority || 'medium';
        prioMap.set(p, (prioMap.get(p) || 0) + 1);
      });
      const priorityCounts = Array.from(prioMap.entries()).map(([name, value]) => ({ name, value }));

      // Sentiment counts
      const sentMap = new Map<string, number>();
      emailList.forEach((e) => {
        const s = e.sentiment || 'neutral';
        sentMap.set(s, (sentMap.get(s) || 0) + 1);
      });
      const sentimentCounts = Array.from(sentMap.entries()).map(([name, value]) => ({ name, value }));

      // Intent counts
      const intentMap = new Map<string, number>();
      emailList.forEach((e) => {
        const intent = e.intent || 'Unclassified';
        intentMap.set(intent, (intentMap.get(intent) || 0) + 1);
      });
      const intentCounts = Array.from(intentMap.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10);

      // Daily volume (last 14 days)
      const dailyMap = new Map<string, number>();
      const now = new Date();
      for (let i = 13; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        dailyMap.set(d.toISOString().split('T')[0], 0);
      }
      emailList.forEach((e) => {
        const date = e.received_at.split('T')[0];
        if (dailyMap.has(date)) {
          dailyMap.set(date, (dailyMap.get(date) || 0) + 1);
        }
      });
      const dailyVolume = Array.from(dailyMap.entries()).map(([date, count]) => ({
        date: date.slice(5),
        count,
      }));

      // Resolution trend
      const resolvedMap = new Map<string, number>();
      const pendingMap = new Map<string, number>();
      for (let i = 13; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().split('T')[0];
        resolvedMap.set(key, 0);
        pendingMap.set(key, 0);
      }
      emailList.forEach((e) => {
        const date = e.received_at.split('T')[0];
        if (e.status === 'resolved') {
          resolvedMap.set(date, (resolvedMap.get(date) || 0) + 1);
        } else {
          pendingMap.set(date, (pendingMap.get(date) || 0) + 1);
        }
      });
      const resolutionTrend = Array.from(resolvedMap.entries()).map(([date, resolved]) => ({
        date: date.slice(5),
        resolved,
        pending: pendingMap.get(date) || 0,
      }));

      // Top issues
      const topIssues = intentCounts.map((item) => ({
        issue: item.name,
        count: item.value,
      }));

      // Avg resolution time (mock calculation)
      const avgResolutionTime = emailList.length > 0 ? Math.floor(Math.random() * 24 + 4) : 0;

      setData({
        departmentCounts,
        priorityCounts,
        sentimentCounts,
        intentCounts,
        dailyVolume,
        resolutionTrend,
        topIssues,
        avgResolutionTime,
      });
    } catch (err) {
      console.error('Analytics error:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-pulse text-muted-foreground">Loading analytics...</div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          No analytics data available
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-7xl mx-auto space-y-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <BarChart3 className="h-7 w-7" />
              Analytics
            </h1>
            <p className="text-muted-foreground mt-1">Insights and trends from your helpdesk data</p>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <SummaryCard
              icon={<Activity className="h-5 w-5" />}
              label="Total Emails"
              value={data.dailyVolume.reduce((a, b) => a + b.count, 0)}
              color="blue"
            />
            <SummaryCard
              icon={<CheckCircle2 className="h-5 w-5" />}
              label="Resolved"
              value={data.resolutionTrend.reduce((a, b) => a + b.resolved, 0)}
              color="green"
            />
            <SummaryCard
              icon={<Clock className="h-5 w-5" />}
              label="Avg Resolution"
              value={`${data.avgResolutionTime}h`}
              color="amber"
            />
            <SummaryCard
              icon={<AlertTriangle className="h-5 w-5" />}
              label="Critical Issues"
              value={data.priorityCounts.find((p) => p.name === 'critical')?.value || 0}
              color="red"
            />
          </div>

          {/* Charts Row 1 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Daily Volume (Last 14 Days)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={data.dailyVolume}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        fontSize: '13px',
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="count"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  Resolution Trend
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={data.resolutionTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        fontSize: '13px',
                      }}
                    />
                    <Legend fontSize={12} />
                    <Bar dataKey="resolved" fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="pending" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Charts Row 2 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Department Workload</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={data.departmentCounts}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {data.departmentCounts.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        fontSize: '13px',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Sentiment Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={data.sentimentCounts}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {data.sentimentCounts.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={
                            entry.name === 'positive'
                              ? '#10b981'
                              : entry.name === 'negative'
                              ? '#ef4444'
                              : '#6b7280'
                          }
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        fontSize: '13px',
                      }}
                    />
                    <Legend fontSize={11} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Priority Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {data.priorityCounts.map((p) => (
                    <div key={p.name} className="flex items-center gap-3">
                      <Badge
                        variant="secondary"
                        className={`w-16 justify-center text-xs ${
                          p.name === 'critical'
                            ? 'bg-red-100 text-red-700'
                            : p.name === 'high'
                            ? 'bg-amber-100 text-amber-700'
                            : p.name === 'medium'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-green-100 text-green-700'
                        }`}
                      >
                        {p.name}
                      </Badge>
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${
                              (p.value / Math.max(...data.priorityCounts.map((x) => x.value))) * 100
                            }%`,
                            backgroundColor:
                              p.name === 'critical'
                                ? '#ef4444'
                                : p.name === 'high'
                                ? '#f59e0b'
                                : p.name === 'medium'
                                ? '#3b82f6'
                                : '#10b981',
                          }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground w-6">{p.value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Top Issues */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top Issues</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {data.topIssues.map((issue) => (
                  <div
                    key={issue.issue}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/30 transition-colors"
                  >
                    <span className="text-sm font-medium">{issue.issue}</span>
                    <Badge variant="secondary">{issue.count}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400',
    green: 'bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400',
    red: 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400',
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
          </div>
          <div className={`p-2.5 rounded-lg ${colorMap[color]}`}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}
