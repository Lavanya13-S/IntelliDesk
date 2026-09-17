'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { invalidateGeminiKeyCache } from '@/lib/agents';
import { Sidebar } from '@/components/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  Settings, Key, Mail, Bell, BrainCircuit, Save,
  CheckCircle2, Loader2, AlertTriangle,
  Mic, LogIn, LogOut, RefreshCw, XCircle,
} from 'lucide-react';
import type { AiSettings } from '@/lib/types';

interface ExtendedSettings extends AiSettings {
  notify_new_email: boolean;
  notify_critical: boolean;
  notify_approval: boolean;
  notify_sent: boolean;
}

const DEFAULT_SETTINGS: Partial<ExtendedSettings> = {
  notify_new_email: true,
  notify_critical: true,
  notify_approval: true,
  notify_sent: true,
};

export default function SettingsPage() {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [settingsId, setSettingsId] = useState<string | null>(null);

  // AI Settings
  const [geminiKey, setGeminiKey] = useState('');
  const [autoGenerate, setAutoGenerate] = useState(false);
  const [autoApprove, setAutoApprove] = useState(false);

  // Notifications
  const [notifyNewEmail, setNotifyNewEmail] = useState(true);
  const [notifyCritical, setNotifyCritical] = useState(true);
  const [notifyApproval, setNotifyApproval] = useState(true);
  const [notifySent, setNotifySent] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const { data, error } = await supabase
        .from('ai_settings')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setSettingsId(data.id);
        setGeminiKey(data.gemini_api_key || '');
        setAutoGenerate(data.auto_generate ?? false);
        setAutoApprove(data.auto_approve ?? false);
        setNotifyNewEmail(data.notify_new_email ?? DEFAULT_SETTINGS.notify_new_email!);
        setNotifyCritical(data.notify_critical ?? DEFAULT_SETTINGS.notify_critical!);
        setNotifyApproval(data.notify_approval ?? DEFAULT_SETTINGS.notify_approval!);
        setNotifySent(data.notify_sent ?? DEFAULT_SETTINGS.notify_sent!);
      }
    } catch (err) {
      console.error('Error loading settings:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);

    try {
      const payload = {
        gemini_api_key: geminiKey,
        auto_generate: autoGenerate,
        auto_approve: autoApprove,
        notify_new_email: notifyNewEmail,
        notify_critical: notifyCritical,
        notify_approval: notifyApproval,
        notify_sent: notifySent,
        updated_at: new Date().toISOString(),
      };

      if (settingsId) {
        const { error } = await supabase.from('ai_settings').update(payload).eq('id', settingsId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('ai_settings').insert(payload).select().single();
        if (error) throw error;
        if (data) setSettingsId(data.id);
      }

      setSaved(true);
      invalidateGeminiKeyCache();
      toast({ title: 'Settings saved', description: 'All configuration has been persisted.' });
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-4xl mx-auto space-y-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <Settings className="h-7 w-7" />
              Settings
            </h1>
            <p className="text-muted-foreground mt-1">Configure your IntelliDesk AI enterprise instance</p>
          </div>

          <Tabs defaultValue="ai" className="space-y-6">
            <TabsList className="grid w-full grid-cols-3 lg:w-fit gap-0.5">
              <TabsTrigger value="ai" className="gap-1.5">
                <BrainCircuit className="h-4 w-4" /><span className="hidden sm:inline">AI</span>
              </TabsTrigger>
              <TabsTrigger value="email" className="gap-1.5">
                <Mail className="h-4 w-4" /><span className="hidden sm:inline">Email</span>
              </TabsTrigger>
              <TabsTrigger value="notifications" className="gap-1.5">
                <Bell className="h-4 w-4" /><span className="hidden sm:inline">Alerts</span>
              </TabsTrigger>
            </TabsList>

            {/* ── AI Settings ────────────────────────────────────────────────── */}
            <TabsContent value="ai" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Key className="h-5 w-5 text-primary" />
                    Gemini AI Configuration
                  </CardTitle>
                  <CardDescription>Configure Gemini API key and agent automation</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="gemini-key">Gemini API Key</Label>
                    <Input
                      id="gemini-key"
                      type="password"
                      value={geminiKey}
                      onChange={(e) => setGeminiKey(e.target.value)}
                      placeholder="AIzaSy..."
                    />
                    <p className="text-xs text-muted-foreground">
                      Used by all AI agents (classification, response generation, embeddings). Stored in database.
                    </p>
                  </div>
                  <Separator />
                  <div className="space-y-4">
                    <h3 className="text-sm font-medium">Automation</h3>
                    <SettingToggle
                      label="Auto-generate responses"
                      description="Automatically generate AI responses when emails arrive"
                      checked={autoGenerate}
                      onChange={setAutoGenerate}
                    />
                    <Separator />
                    <SettingToggle
                      label="Auto-approve low-risk responses"
                      description="Skip manual approval for low-priority, routine requests"
                      checked={autoApprove}
                      onChange={setAutoApprove}
                    />
                  </div>
                  <Separator />
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium">Active Agents</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {[
                        'Email Agent', 'Intent Agent', 'Priority Agent', 'Sentiment Agent',
                        'Department Agent', 'Subteam Agent', 'Knowledge Agent (RAG)',
                        'Similar Case Agent', 'Action Agent', 'Response Generator',
                        'Approval Node', 'Email Node', 'Learning Node',
                      ].map((name) => (
                        <AgentBadge key={name} name={name} status="active" />
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Email Integration ───────────────────────────────────────────── */}
            <TabsContent value="email" className="space-y-6">
              <GmailOAuthCard />
              <GmailSyncCard />
            </TabsContent>

            {/* ── Notifications ───────────────────────────────────────────────── */}
            <TabsContent value="notifications" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Bell className="h-5 w-5 text-primary" />
                    Real-Time Notification Preferences
                  </CardTitle>
                  <CardDescription>Control which events trigger notifications in the bell and toasts</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <SettingToggle
                    label="New email notifications"
                    description="Notify when a new employee email arrives and is classified"
                    checked={notifyNewEmail}
                    onChange={setNotifyNewEmail}
                  />
                  <Separator />
                  <SettingToggle
                    label="Critical priority alerts"
                    description="Immediate alert for critical/urgent tickets requiring attention"
                    checked={notifyCritical}
                    onChange={setNotifyCritical}
                  />
                  <Separator />
                  <SettingToggle
                    label="Approval required notifications"
                    description="Notify when an AI response is pending manager approval"
                    checked={notifyApproval}
                    onChange={setNotifyApproval}
                  />
                  <Separator />
                  <SettingToggle
                    label="Email sent confirmation"
                    description="Notify when a response has been sent and ticket resolved"
                    checked={notifySent}
                    onChange={setNotifySent}
                  />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* Save button */}
          <div className="flex items-center justify-end gap-3 pb-6">
            {saved && (
              <div className="flex items-center gap-1 text-green-600 text-sm">
                <CheckCircle2 className="h-4 w-4" />
                Saved successfully
              </div>
            )}
            <Button onClick={handleSave} disabled={saving || loading} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? 'Saving...' : 'Save All Settings'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingToggle({
  label, description, checked, onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-0.5">
        <Label className="text-sm">{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function AgentBadge({ name, status }: { name: string; status: string }) {
  return (
    <div className="flex items-center justify-between p-2.5 rounded-lg border">
      <div className="flex items-center gap-2">
        <BrainCircuit className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-medium">{name}</span>
      </div>
      <Badge
        variant="secondary"
        className={
          status === 'active'
            ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 text-xs h-5'
            : 'bg-gray-100 text-gray-700 text-xs h-5'
        }
      >
        {status}
      </Badge>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Gmail OAuth Card
// ─────────────────────────────────────────────────────────────────────────────

interface OAuthStatus {
  connected: boolean;
  email?: string;
  scopes?: string[];
  connectedAt?: string;
  tokenExpiry?: string;
  tokenStatus?: string;   // 'active' | 'expired' — returned by /api/auth/google/status
  error?: string;
  missingVars?: string[];
  details?: string;
}

function GmailOAuthCard() {
  const { toast } = useToast();
  const searchParams = useSearchParams();

  const [status, setStatus] = useState<OAuthStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const res = await fetch('/api/auth/google/status');
      const data: OAuthStatus = await res.json();
      setStatus(data);
    } catch {
      setStatus({ connected: false });
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  // Listen for cross-card 'gmail-auth-expired' event dispatched by GmailSyncCard
  // when the sync route returns auth_error (invalid_grant). Re-fetch immediately
  // so the expired banner appears without requiring a full page reload.
  useEffect(() => {
    function onAuthExpired() {
      fetchStatus();
    }
    window.addEventListener('gmail-auth-expired', onAuthExpired);
    return () => window.removeEventListener('gmail-auth-expired', onAuthExpired);
  }, [fetchStatus]);

  // On mount: check for OAuth callback query params, then fetch status
  useEffect(() => {
    const connected = searchParams.get('connected');
    const oauthError = searchParams.get('oauth_error');

    if (connected === 'true') {
      toast({
        title: '✓ Gmail Connected',
        description: 'Google account successfully authorized and verified.',
      });
      // Clean up URL without re-rendering
      window.history.replaceState({}, '', '/settings?tab=email');
    }

    if (oauthError) {
      const errorMessages: Record<string, string> = {
        state_mismatch: 'Security check failed. Please try connecting again.',
        no_refresh_token: 'Google did not return a refresh token. Please revoke app access in your Google account and try again.',
        db_error: 'Failed to save credentials. Check your Supabase setup.',
        invalid_callback: 'Invalid OAuth callback parameters.',
        access_denied: 'Authorization was denied by the user.',
        invalid_grant: 'The authorization has expired. Please reconnect your Gmail account.',
      };
      toast({
        title: 'OAuth Error',
        description: errorMessages[oauthError] || decodeURIComponent(oauthError),
        variant: 'destructive',
      });
      window.history.replaceState({}, '', '/settings?tab=email');
    }

    fetchStatus();
  }, [fetchStatus, searchParams, toast]);

  async function handleConnect() {
    setConnecting(true);
    // Navigate to the connect route — it will redirect to Google
    window.location.href = '/api/auth/google/connect';
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch('/api/auth/google/disconnect', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        toast({ title: 'Gmail Disconnected', description: 'Google account has been unlinked.' });
        await fetchStatus();
      } else {
        toast({
          title: 'Disconnect failed',
          description: data.error || 'Unknown error',
          variant: 'destructive',
        });
      }
    } catch (err: any) {
      toast({ title: 'Disconnect failed', description: err.message, variant: 'destructive' });
    } finally {
      setDisconnecting(false);
    }
  }

  const REQUESTED_SCOPES = [
    'gmail.readonly',
    'gmail.send',
    'gmail.modify',
  ];

  return (
    <Card id="gmail-oauth-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-primary" />
          Gmail Integration
        </CardTitle>
        <CardDescription>
          Authorize IntelliDesk to read, send, and manage Gmail via OAuth 2.0
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* ── Loading ──────────────────────────────────────────────── */}
        {loadingStatus && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking connection status…
          </div>
        )}

        {/* ── Missing env vars ─────────────────────────────────────── */}
        {!loadingStatus && status?.error === 'configuration_error' && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <XCircle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
              <div className="space-y-1">
                <h4 className="text-sm font-semibold text-destructive">Missing Environment Variables</h4>
                <p className="text-xs text-muted-foreground">
                  Add the following variables to your <code className="font-mono bg-muted px-1 rounded text-xs">.env</code> file to enable Google OAuth:
                </p>
              </div>
            </div>
            <div className="rounded-md bg-muted font-mono text-xs p-3 space-y-1.5">
              {status.missingVars?.map((v) => (
                <div key={v} className="flex items-center gap-2">
                  <span className="text-destructive font-bold">✗</span>
                  <span className="font-semibold">{v}</span>
                  <span className="text-muted-foreground">=your_value_here</span>
                </div>
              ))}
              {/* Always show SUPABASE_SERVICE_ROLE_KEY hint */}
              {!status.missingVars?.includes('SUPABASE_SERVICE_ROLE_KEY') && (
                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border">
                  <span className="text-amber-500 font-bold">!</span>
                  <span className="text-muted-foreground text-xs">
                    Also ensure <span className="font-semibold text-foreground">SUPABASE_SERVICE_ROLE_KEY</span> is set (server-side only — do NOT prefix with NEXT_PUBLIC_)
                  </span>
                </div>
              )}
            </div>
            <div className="rounded-md bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-900 p-3 text-xs space-y-1">
              <p className="font-medium text-blue-800 dark:text-blue-200">How to get credentials:</p>
              <ol className="list-decimal list-inside space-y-0.5 text-blue-700 dark:text-blue-300">
                <li>Go to <span className="font-mono">console.cloud.google.com</span> → APIs &amp; Services → Credentials</li>
                <li>Create an OAuth 2.0 Client ID (Web Application)</li>
                <li>Add redirect URI: <span className="font-mono">http://localhost:3000/api/auth/google/callback</span></li>
                <li>Enable Gmail API in your project</li>
              </ol>
            </div>
          </div>
        )}

        {/* ── Connected ────────────────────────────────────────────── */}
        {!loadingStatus && status?.connected && (
          <div className="space-y-4">

            {/* ── EXPIRED TOKEN BANNER — shown instead of normal connected UI ── */}
            {status.tokenStatus === 'expired' && (
              <div className="rounded-lg border border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/40 p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                      Gmail Authorization Expired
                    </h4>
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Gmail authorization has expired. Please reconnect your Gmail account to continue syncing emails.
                    </p>
                    {status.email && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 font-mono">
                        Account: {status.email}
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  className="gap-2 w-full sm:w-auto bg-amber-600 hover:bg-amber-700 text-white"
                  onClick={handleConnect}
                  disabled={connecting}
                >
                  {connecting
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <LogIn className="h-4 w-4" />}
                  {connecting ? 'Redirecting to Google…' : 'Reconnect Gmail'}
                </Button>
              </div>
            )}

            {/* ── NORMAL CONNECTED STATE — only shown when token is active ── */}
            {status.tokenStatus !== 'expired' && (
              <>
                <div className="flex items-start gap-4 p-4 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-900">
                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-sm font-semibold text-green-800 dark:text-green-200">✓ Gmail Connected</p>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-green-700 dark:text-green-300">Connected Account:</span>
                      <span className="text-xs font-mono font-medium text-green-800 dark:text-green-200 truncate">
                        {status.email}
                      </span>
                    </div>
                    {status.connectedAt && (
                      <p className="text-xs text-green-600 dark:text-green-400">
                        Last authorized: {new Date(status.connectedAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <h4 className="text-sm font-medium">Authorized Scopes</h4>
                  <div className="flex flex-wrap gap-2">
                    {REQUESTED_SCOPES.map((scope) => (
                      <Badge key={scope} variant="secondary" className="gap-1 text-xs">
                        <CheckCircle2 className="h-3 w-3 text-green-500" />
                        {scope}
                      </Badge>
                    ))}
                  </div>
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">Disconnect Gmail</p>
                    <p className="text-xs text-muted-foreground">
                      Revokes OAuth access and removes stored credentials
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-2 shrink-0"
                    onClick={handleDisconnect}
                    disabled={disconnecting}
                  >
                    {disconnecting
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <LogOut className="h-4 w-4" />}
                    {disconnecting ? 'Disconnecting…' : 'Disconnect Gmail'}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Not connected ────────────────────────────────────────── */}
        {!loadingStatus && !status?.connected && status?.error !== 'configuration_error' && (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-muted/50 space-y-3">
              <p className="text-sm text-muted-foreground">
                Connect your Google account to allow IntelliDesk to read and send emails via Gmail.
              </p>
              <div className="space-y-1.5">
                <p className="text-xs font-medium">Permissions that will be requested:</p>
                <div className="flex flex-wrap gap-1.5">
                  {REQUESTED_SCOPES.map((scope) => (
                    <Badge key={scope} variant="outline" className="text-xs">
                      {scope}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                className="gap-2"
                onClick={handleConnect}
                disabled={connecting}
              >
                {connecting
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <LogIn className="h-4 w-4" />}
                {connecting ? 'Redirecting to Google…' : 'Connect Gmail'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-muted-foreground"
                onClick={fetchStatus}
                disabled={loadingStatus}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Gmail Sync Card — Auto Sync toggle + sync status
// ─────────────────────────────────────────────────────────────────────────────

interface SyncStatus {
  ready: boolean;
  lastSync: string | null;
  totalImported: number;
  lastError: string | null;
  autoSync: boolean;
  markRead: boolean;
}

function GmailSyncCard() {
  const { toast } = useToast();
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [loadingSyncStatus, setLoadingSyncStatus] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [autoSync, setAutoSync] = useState(false);
  const [markRead, setMarkRead] = useState(true);
  const [savingSync, setSavingSync] = useState(false);

  const fetchSyncStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/gmail/sync');
      if (res.ok) {
        const data: SyncStatus = await res.json();
        setSyncStatus(data);
        setAutoSync(data.autoSync || false);
        setMarkRead(data.markRead ?? true);
      }
    } catch {
      // non-fatal
    } finally {
      setLoadingSyncStatus(false);
    }
  }, []);

  useEffect(() => {
    fetchSyncStatus();
  }, [fetchSyncStatus]);

  // Auto-sync polling every 30 seconds when enabled
  useEffect(() => {
    if (!autoSync) return;
    const interval = setInterval(async () => {
      try {
        await fetch('/api/gmail/sync', { method: 'POST' });
        await fetchSyncStatus();
      } catch { /* non-fatal */ }
    }, 30_000);
    return () => clearInterval(interval);
  }, [autoSync, fetchSyncStatus]);

  async function handleManualSync() {
    setSyncing(true);
    try {
      const res = await fetch('/api/gmail/sync', { method: 'POST' });
      const report = await res.json();

      // ── Detect expired/revoked token (invalid_grant / auth_error) ────────
      // The sync route returns { error: 'auth_error' } with HTTP 401 when
      // GmailTokenExpiredError is thrown (invalid_grant from Google).
      // 1. Notify GmailOAuthCard to re-fetch its status so the expired banner
      //    appears immediately — no page reload required.
      // 2. Scroll the OAuth card into view for a direct reconnect path.
      // 3. Show a persistent, clear message — do NOT retry.
      if (report.error === 'auth_error' || res.status === 401) {
        console.error(
          '[Gmail Sync UI] Auth error detected — dispatching gmail-auth-expired event.',
          { httpStatus: res.status, message: report.message }
        );

        // Signal GmailOAuthCard to refresh its status display
        window.dispatchEvent(new CustomEvent('gmail-auth-expired'));

        // Scroll the OAuth card into view after a short delay (allow re-render)
        setTimeout(() => {
          const oauthCard = document.getElementById('gmail-oauth-card');
          if (oauthCard) {
            oauthCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 300);

        toast({
          title: 'Gmail Authorization Expired',
          description:
            'Gmail authorization has expired. Please reconnect your Gmail account ' +
            'using the "Reconnect Gmail" button above.',
          variant: 'destructive',
        });
        return;
      }

      if (report.error) {
        toast({ title: 'Sync Failed', description: report.message || report.error, variant: 'destructive' });
      } else if (report.unreadFound === 0) {
        toast({ title: '✓ Synced', description: 'No new unread emails.' });
      } else {
        toast({
          title: `✓ Imported ${report.imported} email${report.imported !== 1 ? 's' : ''}`,
          description:
            `Unread: ${report.unreadFound} • Imported: ${report.imported} • ` +
            `Skipped: ${report.duplicatesSkipped} • Tickets: ${report.ticketsCreated} • AI: ${report.aiProcessed}`,
        });
      }
      await fetchSyncStatus();
    } catch (err: any) {
      toast({ title: 'Sync Error', description: err.message, variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  }

  async function saveAutoSyncSettings(newAutoSync: boolean, newMarkRead: boolean) {
    setSavingSync(true);
    try {
      const { supabase: sb } = await import('@/lib/supabase');
      const { data: existing } = await sb
        .from('ai_settings')
        .select('id')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing?.id) {
        await sb
          .from('ai_settings')
          .update({
            gmail_auto_sync: newAutoSync,
            gmail_mark_read: newMarkRead,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
      }
      await fetchSyncStatus();
      toast({ title: 'Sync settings saved' });
    } catch (err: any) {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' });
    } finally {
      setSavingSync(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5 text-primary" />
          Gmail Sync Service
        </CardTitle>
        <CardDescription>
          Module 1 — Real-time ingestion from Gmail inbox into IntelliDesk AI
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Sync Status Panel */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border bg-muted/30 p-3 space-y-0.5">
            <p className="text-xs text-muted-foreground">Last Sync</p>
            <p className="text-sm font-medium">
              {loadingSyncStatus ? '...' : syncStatus?.lastSync
                ? new Date(syncStatus.lastSync).toLocaleString()
                : 'Never'}
            </p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 space-y-0.5">
            <p className="text-xs text-muted-foreground">Emails Imported</p>
            <p className="text-sm font-medium">
              {loadingSyncStatus ? '...' : (syncStatus?.totalImported ?? 0).toLocaleString()}
            </p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 space-y-0.5">
            <p className="text-xs text-muted-foreground">Status</p>
            <p className="text-sm font-medium">
              {loadingSyncStatus
                ? '...'
                : syncStatus?.lastError
                  ? <span className="text-destructive truncate block">Error</span>
                  : <span className="text-green-600 dark:text-green-400">OK</span>}
            </p>
          </div>
        </div>

        <Separator />

        {/* Toggles */}
        <div className="space-y-4">
          <SettingToggle
            label="Auto Sync"
            description="Automatically poll Gmail for new unread emails every 30 seconds"
            checked={autoSync}
            onChange={(val) => { setAutoSync(val); saveAutoSyncSettings(val, markRead); }}
          />
          <Separator />
          <SettingToggle
            label="Mark as Read after Import"
            description="Remove the UNREAD label from Gmail after importing. Disable to leave emails unread in Gmail."
            checked={markRead}
            onChange={(val) => { setMarkRead(val); saveAutoSyncSettings(autoSync, val); }}
          />
        </div>

        <Separator />

        {/* Manual Sync */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Manual Sync</p>
            <p className="text-xs text-muted-foreground">
              Immediately fetch all unread emails from Gmail inbox
            </p>
          </div>
          <Button
            className="gap-2 shrink-0"
            onClick={handleManualSync}
            disabled={syncing || loadingSyncStatus}
          >
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {syncing ? 'Syncing...' : 'Sync Now'}
          </Button>
        </div>

        {syncStatus?.lastError && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-xs font-medium text-destructive mb-1">Last Sync Error</p>
            <p className="text-xs text-muted-foreground font-mono break-all">{syncStatus.lastError}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
