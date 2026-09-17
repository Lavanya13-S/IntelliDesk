'use client';

import { useState, useEffect, use } from 'react';
import { CheckCircle2, XCircle, Clock, AlertTriangle, Zap, Building2, User } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ApprovalRow {
  id: string;
  employee_name: string | null;
  employee_email: string | null;
  manager_name: string | null;
  department: string | null;
  team_name: string | null;
  intent: string | null;
  priority: string | null;
  risk_level: string | null;
  ai_reason: string | null;
  ai_confidence: number | null;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  token_expires_at: string;
  created_at: string;
}

type Stage = 'loading' | 'ready' | 'confirming-approve' | 'rejecting' | 'submitting' | 'success' | 'error';

const riskColors: Record<string, string> = {
  Critical: '#ef4444', High: '#f97316', Medium: '#eab308', Low: '#22c55e',
};

export default function TokenApprovalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [approval, setApproval] = useState<ApprovalRow | null>(null);
  const [stage, setStage] = useState<Stage>('loading');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [comment, setComment] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [resultMsg, setResultMsg] = useState('');
  const [action, setAction] = useState<'approved' | 'rejected' | null>(null);

  useEffect(() => {
    // Check URL ?action= param from email links
    const urlAction = new URLSearchParams(window.location.search).get('action');
    if (urlAction === 'approve') setAction('approved');
    if (urlAction === 'reject')  setStage('rejecting');
  }, []);

  useEffect(() => {
    const loadApproval = async () => {
      try {
        const res = await fetch(`/api/approval/${token}`);
        if (!res.ok) throw new Error('Invalid or expired link');
        const data = await res.json();
        setApproval(data.approval);
        setStage(prev => prev === 'loading' ? 'ready' : prev);
      } catch (err: any) {
        setErrorMsg(err.message || 'This approval link is invalid or has expired.');
        setStage('error');
      }
    };
    loadApproval();
  }, [token]);

  const handleAction = async (selectedAction: 'approved' | 'rejected') => {
    if (approval?.status !== 'pending') return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/approval/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: selectedAction, comments: comment }),
      });
      const data = await res.json();
      if (data.success) {
        setResultMsg(
          selectedAction === 'approved'
            ? 'Request approved successfully. The employee and assigned department will be notified.'
            : 'Request rejected. The employee will receive a notification with your comments.'
        );
        setAction(selectedAction);
        setStage('success');
      } else {
        setErrorMsg(data.error || 'Action failed.');
        setStage('error');
      }
    } catch {
      setErrorMsg('Network error. Please try again.');
      setStage('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Already resolved ────────────────────────────────────────────────────────
  if (approval && approval.status !== 'pending' && stage !== 'success') {
    const statusLabel = approval.status.charAt(0).toUpperCase() + approval.status.slice(1);
    return (
      <Page>
        <Card>
          <div className="text-center">
            <div className="h-16 w-16 rounded-full bg-gray-500/10 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="h-8 w-8 text-gray-400" />
            </div>
            <h1 className="text-xl font-bold text-white mb-2">Already {statusLabel}</h1>
            <p className="text-gray-400 text-sm">This request was already {statusLabel.toLowerCase()}.</p>
          </div>
        </Card>
      </Page>
    );
  }

  // ── Error ───────────────────────────────────────────────────────────────────
  if (stage === 'error') {
    return (
      <Page>
        <Card>
          <div className="text-center">
            <div className="h-16 w-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
              <XCircle className="h-8 w-8 text-red-400" />
            </div>
            <h1 className="text-xl font-bold text-white mb-2">Invalid Link</h1>
            <p className="text-gray-400 text-sm">{errorMsg}</p>
          </div>
        </Card>
      </Page>
    );
  }

  // ── Success ─────────────────────────────────────────────────────────────────
  if (stage === 'success') {
    const isApproved = action === 'approved';
    return (
      <Page>
        <Card>
          <div className="text-center">
            <div className={cn(
              'h-20 w-20 rounded-full flex items-center justify-center mx-auto mb-6',
              isApproved ? 'bg-emerald-500/10' : 'bg-red-500/10'
            )}>
              {isApproved
                ? <CheckCircle2 className="h-10 w-10 text-emerald-400" />
                : <XCircle className="h-10 w-10 text-red-400" />}
            </div>
            <h1 className="text-2xl font-bold text-white mb-3">
              {isApproved ? 'Request Approved' : 'Request Rejected'}
            </h1>
            <p className="text-gray-400 text-sm leading-relaxed max-w-sm mx-auto">{resultMsg}</p>
            <div className="mt-6 p-4 rounded-xl bg-white/[0.03] border border-white/[0.08] text-left">
              <p className="text-xs text-gray-500 mb-1">Employee</p>
              <p className="text-sm text-white font-medium">{approval?.employee_name}</p>
              <p className="text-xs text-gray-500 mt-2 mb-1">Request</p>
              <p className="text-sm text-gray-300">{approval?.intent}</p>
            </div>
          </div>
        </Card>
      </Page>
    );
  }

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (stage === 'loading' || !approval) {
    return (
      <Page>
        <Card>
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
            <p className="text-gray-400 text-sm">Loading approval details...</p>
          </div>
        </Card>
      </Page>
    );
  }

  const riskColor = riskColors[approval.risk_level ?? ''] ?? '#94a3b8';

  // ── Reject flow ─────────────────────────────────────────────────────────────
  if (stage === 'rejecting' || (stage === 'ready' && action === null)) {
    return (
      <Page>
        <div className="w-full max-w-xl space-y-4">
          {/* Header */}
          <div className="text-center mb-2">
            <div className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-full px-4 py-2 mb-4">
              <Clock className="h-4 w-4 text-amber-400" />
              <span className="text-amber-400 text-sm font-medium">Action Required</span>
            </div>
            <h1 className="text-2xl font-bold text-white">Approval Request</h1>
            <p className="text-gray-400 text-sm mt-1">Review the request below and make your decision</p>
          </div>

          {/* Details card */}
          <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-6 space-y-4">
            <Row icon={User} label="Employee" value={`${approval.employee_name ?? '—'} · ${approval.employee_email ?? ''}`} />
            <Row icon={Building2} label="Department" value={`${approval.department ?? '—'} / ${approval.team_name ?? '—'}`} />
            <Row icon={Zap} label="Classification" value={approval.intent ?? '—'} />
            <div className="flex items-start gap-3">
              <div className="h-6 w-6 rounded-md bg-white/5 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-xs" style={{ color: riskColor }}>⚠</span>
              </div>
              <div>
                <p className="text-xs text-gray-500">Risk Level</p>
                <p className="text-sm font-semibold mt-0.5" style={{ color: riskColor }}>{approval.risk_level ?? '—'}</p>
              </div>
            </div>
            {approval.ai_reason && (
              <div className="bg-white/[0.03] rounded-xl p-4 border border-white/5">
                <p className="text-xs text-gray-500 mb-1">AI Reason for Approval Required</p>
                <p className="text-sm text-gray-300">{approval.ai_reason}</p>
              </div>
            )}
          </div>

          {/* Comment box */}
          <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-6">
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Comments <span className="text-gray-600 font-normal">(optional)</span>
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add comments for the employee..."
              rows={3}
              className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500/50 resize-none"
            />
          </div>

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              onClick={() => handleAction('approved')}
              disabled={isSubmitting}
              className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-semibold text-sm transition-colors disabled:opacity-50"
            >
              <CheckCircle2 className="h-5 w-5" />
              {isSubmitting ? 'Processing...' : 'Approve Request'}
            </button>
            <button
              onClick={() => handleAction('rejected')}
              disabled={isSubmitting}
              className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 font-semibold text-sm transition-colors disabled:opacity-50"
            >
              <XCircle className="h-5 w-5" />
              {isSubmitting ? 'Processing...' : 'Reject Request'}
            </button>
          </div>

          <p className="text-center text-xs text-gray-600">
            Link expires: {new Date(approval.token_expires_at).toLocaleString()}
          </p>
        </div>
      </Page>
    );
  }

  return null;
}

// ─── Layout helpers ────────────────────────────────────────────────────────────

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12" style={{ background: '#080b10' }}>
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 right-0 w-[400px] h-[300px] bg-violet-600/10 blur-[100px] rounded-full" />
        <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-indigo-600/8 blur-[80px] rounded-full" />
      </div>
      <div className="relative z-10 w-full max-w-xl">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <span className="text-white font-bold text-lg">IntelliDesk</span>
        </div>
        {children}
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-8">
      {children}
    </div>
  );
}

function Row({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="h-6 w-6 rounded-md bg-white/5 flex items-center justify-center shrink-0 mt-0.5">
        <Icon className="h-3.5 w-3.5 text-gray-400" />
      </div>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-sm text-gray-200 mt-0.5">{value}</p>
      </div>
    </div>
  );
}
