'use client';

import { useEffect, useState } from 'react';
import { Sidebar } from '@/components/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  CheckCircle2, XCircle, AlertTriangle, RefreshCw, Loader2,
  ShieldCheck, Database, Bell, Mail, FileUp, Search,
  GitBranch,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warning';
  detail: string;
  fix?: string;
}

interface SystemCheckResponse {
  summary: { total: number; passed: number; warned: number; failed: number };
  overall: 'pass' | 'fail' | 'warning';
  checks: CheckResult[];
  generated_at: string;
}

const moduleIcons: Record<string, typeof CheckCircle2> = {
  'Supabase Connection': Database,
  'Gemini API Key': ShieldCheck,
  'Notifications Table': Bell,
  'RAG / Semantic Search': Search,
  'Similar Case Agent': Search,
  'LangGraph Pipeline': GitBranch,
  'Smart Attachments': FileUp,
  'Gmail Integration': Mail,
  'Response Generator': ShieldCheck,
};

export default function ValidationPage() {
  const [data, setData] = useState<SystemCheckResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRun, setLastRun] = useState<Date | null>(null);

  useEffect(() => {
    runCheck();
  }, []);

  async function runCheck() {
    setLoading(true);
    try {
      const res = await fetch('/api/system-check');
      const json = await res.json();
      setData(json);
      setLastRun(new Date());
    } catch (err) {
      console.error('System check failed:', err);
    } finally {
      setLoading(false);
    }
  }

  const overallColor = {
    pass: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-950 dark:text-green-300',
    warning: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
    fail: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-300',
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                <ShieldCheck className="h-7 w-7" />
                System Validation
              </h1>
              <p className="text-muted-foreground mt-1">
                System health check for core IntelliDesk services and integrations
              </p>
            </div>
            <Button onClick={runCheck} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {loading ? 'Running...' : 'Run Check'}
            </Button>
          </div>

          {/* Summary banner */}
          {data && (
            <div className={cn('p-4 rounded-xl border', overallColor[data.overall])}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {data.overall === 'pass' ? (
                    <CheckCircle2 className="h-6 w-6 text-green-600" />
                  ) : data.overall === 'warning' ? (
                    <AlertTriangle className="h-6 w-6 text-amber-600" />
                  ) : (
                    <XCircle className="h-6 w-6 text-red-600" />
                  )}
                  <div>
                    <p className="font-semibold text-sm">
                      {data.overall === 'pass' ? 'All systems operational' :
                       data.overall === 'warning' ? 'System operational with warnings' :
                       'System check failed — action required'}
                    </p>
                    <p className="text-xs mt-0.5">
                      {data.summary.passed} passed · {data.summary.warned} warnings · {data.summary.failed} failed
                    </p>
                  </div>
                </div>
                <div className="text-right text-xs opacity-70">
                  {lastRun && `Last checked: ${format(lastRun, 'HH:mm:ss')}`}
                </div>
              </div>
            </div>
          )}

          {/* Module scores */}
          {data && (
            <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
              {[
                { label: 'Total', value: data.summary.total, color: 'text-foreground' },
                { label: 'Passed', value: data.summary.passed, color: 'text-green-600' },
                { label: 'Warnings', value: data.summary.warned, color: 'text-amber-600' },
                { label: 'Failed', value: data.summary.failed, color: 'text-red-600' },
                { label: 'Score', value: `${Math.round((data.summary.passed / data.summary.total) * 100)}%`, color: 'text-primary' },
              ].map((stat) => (
                <div key={stat.label} className="p-3 rounded-lg border bg-card text-center">
                  <p className={cn('text-2xl font-bold', stat.color)}>{stat.value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Checks table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Check Results</CardTitle>
              <CardDescription>Detailed status for each module and dependency</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {loading && !data && (
                <div className="py-12 text-center">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary mb-3" />
                  <p className="text-sm text-muted-foreground">Running system checks...</p>
                </div>
              )}
              {data?.checks.map((check, idx) => {
                const Icon = moduleIcons[check.name] ?? ShieldCheck;
                return (
                  <div key={check.name}>
                    <div className="flex items-start gap-3 py-2">
                      <div className="flex-shrink-0 mt-0.5">
                        {check.status === 'pass' ? (
                          <CheckCircle2 className="h-5 w-5 text-green-500" />
                        ) : check.status === 'warning' ? (
                          <AlertTriangle className="h-5 w-5 text-amber-500" />
                        ) : (
                          <XCircle className="h-5 w-5 text-red-500" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-sm font-medium">{check.name}</span>
                          <Badge
                            variant="secondary"
                            className={cn(
                              'text-xs h-5',
                              check.status === 'pass' && 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
                              check.status === 'warning' && 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
                              check.status === 'fail' && 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
                            )}
                          >
                            {check.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{check.detail}</p>
                        {check.fix && (
                          <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                            💡 Fix: {check.fix}
                          </p>
                        )}
                      </div>
                    </div>
                    {idx < data.checks.length - 1 && <Separator />}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
