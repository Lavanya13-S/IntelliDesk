'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { runAllAgents } from '@/lib/agents';
import { Sidebar } from '@/components/sidebar';
import { EmailList } from '@/components/email-list';
import { EmailDetail } from '@/components/email-detail';
import type { Email } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Plus, Loader2, Sparkles, Inbox, CheckCircle2, Menu, X, Zap, RefreshCw, Mail } from 'lucide-react';

type InboxTab = 'active' | 'resolved';

export default function InboxPage() {
  const { toast } = useToast();
  const [emails, setEmails] = useState<Email[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterDepartment, setFilterDepartment] = useState<string>('all');
  const [composeOpen, setComposeOpen] = useState(false);
  const [processingEmail, setProcessingEmail] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState({ sender: '', subject: '', body: '' });
  const [activeTab, setActiveTab] = useState<InboxTab>('active');
  const [showMobileList, setShowMobileList] = useState(true);
  const [autoGenerate, setAutoGenerate] = useState(false);
  const [autoApprove, setAutoApprove] = useState(false);
  const [gmailSyncing, setGmailSyncing] = useState(false);

  useEffect(() => {
    fetchEmails();
    loadAiSettings();
  }, []);

  async function loadAiSettings() {
    try {
      const { data } = await supabase
        .from('ai_settings')
        .select('auto_generate, auto_approve')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        setAutoGenerate(data.auto_generate ?? false);
        setAutoApprove(data.auto_approve ?? false);
      }
    } catch (err) {
      console.error('Error loading AI settings:', err);
    }
  }

  async function fetchEmails() {
    try {
      const { data, error } = await supabase
        .from('emails')
        .select('*')
        .order('received_at', { ascending: false });

      if (error) throw error;
      setEmails(data || []);
    } catch (err) {
      console.error('Error fetching emails:', err);
    } finally {
      setLoading(false);
    }
  }

  async function sendNewEmail() {
    if (!newEmail.sender || !newEmail.subject || !newEmail.body) return;

    try {
      const { data: inserted, error } = await supabase
        .from('emails')
        .insert({
          sender: newEmail.sender,
          subject: newEmail.subject,
          body: newEmail.body,
          status: 'pending',
          priority: 'medium',
          sentiment: 'neutral',
        })
        .select()
        .single();

      if (error) throw error;

      setComposeOpen(false);
      setNewEmail({ sender: '', subject: '', body: '' });

      if (inserted) {
        await runAIClassification(inserted);
      }
    } catch (err) {
      console.error('Error sending email:', err);
    }
  }

  async function handleGmailSync() {
    setGmailSyncing(true);
    try {
      const res = await fetch('/api/gmail/sync', { method: 'POST' });
      const report = await res.json();

      if (!res.ok || report.error === 'auth_error') {
        toast({
          title: 'Gmail Sync Failed',
          description: report.message || 'Could not connect to Gmail. Check OAuth in Settings → Email.',
          variant: 'destructive',
        });
        return;
      }

      if (report.error === 'configuration_error') {
        toast({
          title: 'Configuration Error',
          description: `Missing env vars: ${report.missingEnv?.join(', ')}`,
          variant: 'destructive',
        });
        return;
      }

      // Success
      await fetchEmails();

      if (report.unreadFound === 0) {
        toast({ title: '\u2713 Gmail Synced', description: 'No unread emails found in inbox.' });
      } else {
        toast({
          title: `\u2713 Synced ${report.imported} email${report.imported !== 1 ? 's' : ''}`,
          description:
            `Unread: ${report.unreadFound} • Imported: ${report.imported} • ` +
            `Skipped: ${report.duplicatesSkipped} • Tickets: ${report.ticketsCreated} • ` +
            `AI: ${report.aiProcessed}${report.errors.length > 0 ? ` • Errors: ${report.errors.length}` : ''}`,
        });
      }

      if (report.errors?.length > 0) {
        console.warn('[Gmail Sync] Errors during sync:', report.errors);
      }
    } catch (err: any) {
      toast({
        title: 'Gmail Sync Error',
        description: err.message || 'Unexpected error during sync.',
        variant: 'destructive',
      });
    } finally {
      setGmailSyncing(false);
    }
  }

  async function runAIClassification(email: Email) {
    setProcessingEmail(email.id);
    try {
      const result = await runAllAgents(email.id, email.subject, email.body);
      if (result) {
        console.log('AI classification result:', result);
      }

      // Reload AI settings (may have changed since page load)
      const { data: settingsData } = await supabase
        .from('ai_settings')
        .select('auto_generate, auto_approve, gemini_api_key')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const shouldAutoGenerate = settingsData?.auto_generate ?? autoGenerate;
      const shouldAutoApprove = settingsData?.auto_approve ?? autoApprove;
      const geminiKey = settingsData?.gemini_api_key || null;

      // Auto-generate response if enabled
      if (shouldAutoGenerate && result && geminiKey) {
        try {
          const { generateAIResponse } = await import('@/lib/agents');
          const { supabase: sb } = await import('@/lib/supabase');

          // Wait for ticket to be created, then find it
          await new Promise(resolve => setTimeout(resolve, 800));
          const { data: ticketRows } = await sb
            .from('tickets')
            .select('*')
            .eq('email_id', email.id)
            .order('created_at', { ascending: false })
            .limit(1);
          const ticket = ticketRows?.[0];

          if (ticket) {
            const aiResult = await generateAIResponse(
              ticket.intent || 'General Inquiry',
              ticket.department || 'IT',
              ticket.subteam || 'General',
              email.subject,
              email.body,
              'professional',
              ticket.priority || 'medium',
              ticket.sentiment || 'neutral'
            );

            if (aiResult) {
              // Upsert the response
              const { data: existingResp } = await sb
                .from('responses')
                .select('id')
                .eq('ticket_id', ticket.id)
                .limit(1);

              let respId: string | null = null;

              if (existingResp?.[0]?.id) {
                await sb
                  .from('responses')
                  .update({ response: aiResult.response, approved: false, generated_by: 'ai', tone: 'professional' })
                  .eq('id', existingResp[0].id);
                respId = existingResp[0].id;
              } else {
                const { data: newResp } = await sb
                  .from('responses')
                  .insert({ ticket_id: ticket.id, response: aiResult.response, approved: false, generated_by: 'ai', tone: 'professional' })
                  .select('id')
                  .single();
                respId = newResp?.id || null;
              }

              // Auto-approve if enabled
              if (shouldAutoApprove && respId) {
                await sb
                  .from('responses')
                  .update({ approved: true })
                  .eq('id', respId);

                // Upsert approval record
                await sb.from('approvals').insert({
                  response_id: respId,
                  status: 'approved',
                  requested_by: 'ai_system',
                  approved_by: 'auto_approve',
                  notes: 'Automatically approved by IntelliDesk',
                  resolved_at: new Date().toISOString(),
                });

                // Auto-send
                await fetch('/api/send-email', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    ticket_id: ticket.id,
                    response_text: aiResult.response,
                    to_email: email.sender,
                    subject: `Re: ${email.subject}`,
                  }),
                });

                // Store in resolved knowledge base
                const { storeResolvedCase } = await import('@/lib/agents');
                await storeResolvedCase(
                  ticket.id,
                  email.subject,
                  email.body,
                  aiResult.response,
                  ticket.intent || '',
                  ticket.department || '',
                  ticket.subteam || '',
                  'Auto-generated and auto-approved by IntelliDesk'
                );

                console.log('✅ Auto-generated, auto-approved, and sent for:', email.id);
              } else if (respId) {
                // Add pending approval record
                await sb.from('approvals').insert({
                  response_id: respId,
                  status: 'pending',
                  requested_by: 'ai_system',
                  notes: 'Auto-generated — awaiting human approval',
                });
                console.log('✅ Auto-generated (pending approval) for:', email.id);
              }
            }
          }
        } catch (autoGenErr) {
          console.error('Auto-generate failed (non-fatal):', autoGenErr);
        }
      }
    } catch (err) {
      console.error('AI classification error:', err);
    } finally {
      setProcessingEmail(null);
      await fetchEmails();
      const { data } = await supabase.from('emails').select('*').eq('id', email.id).single();
      if (data) {
        setSelectedEmail(data as Email);
        setShowMobileList(false);
      }
    }
  }

  async function reclassifyEmail(email: Email) {
    await runAIClassification(email);
  }

  const activeEmails = emails.filter((e) => e.status !== 'resolved');
  const resolvedEmails = emails.filter((e) => e.status === 'resolved');
  const currentEmails = activeTab === 'active' ? activeEmails : resolvedEmails;

  const filteredEmails = currentEmails.filter((email) => {
    const matchesSearch =
      searchQuery === '' ||
      email.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      email.sender.toLowerCase().includes(searchQuery.toLowerCase()) ||
      email.body.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesPriority = filterPriority === 'all' || email.priority === filterPriority;
    const matchesDepartment = filterDepartment === 'all' || email.department === filterDepartment;
    return matchesSearch && matchesPriority && matchesDepartment;
  });

  const departments = Array.from(new Set(currentEmails.map((e) => e.department).filter(Boolean)));

  const handleSelectEmail = (email: Email) => {
    setSelectedEmail(email);
    setShowMobileList(false);
  };

  const handleBackToList = () => {
    setShowMobileList(true);
    setSelectedEmail(null);
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Email List - hidden on mobile when detail is shown */}
        <div className={`
          w-full md:w-80 lg:w-96 border-r flex flex-col bg-card
          ${showMobileList ? 'flex' : 'hidden md:flex'}
        `}>
          <div className="p-3 md:p-4 border-b">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base md:text-lg font-semibold flex items-center gap-2">
                <Inbox className="h-4 w-4 md:h-5 md:w-5" />
                Inbox
              </h2>
              <div className="flex items-center gap-1.5">
                {(autoGenerate || autoApprove) && (
                  <Badge
                    variant="outline"
                    className="h-6 text-[10px] gap-1 border-emerald-500 text-emerald-600 dark:text-emerald-400 px-1.5"
                  >
                    <Zap className="h-2.5 w-2.5" />
                    {autoApprove ? 'Full Auto' : 'Auto-Gen'}
                  </Badge>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 h-8 text-xs border-blue-300 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950"
                  onClick={handleGmailSync}
                  disabled={gmailSyncing}
                  title="Sync unread Gmail emails into IntelliDesk"
                >
                  {gmailSyncing
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <Mail className="h-3 w-3" />}
                  {gmailSyncing ? 'Syncing...' : 'Sync Gmail'}
                </Button>
                <Button size="sm" variant="outline" className="gap-1 h-8 text-xs" onClick={() => setComposeOpen(true)}>
                  <Plus className="h-3 w-3" />
                  New
                </Button>
              </div>
            </div>
            <div className="flex gap-1 mb-2">
              <Button
                size="sm"
                variant={activeTab === 'active' ? 'default' : 'ghost'}
                className="flex-1 gap-1 h-7 text-xs"
                onClick={() => { setActiveTab('active'); setSelectedEmail(null); setShowMobileList(true); }}
              >
                <Inbox className="h-3 w-3" />
                Active
                <Badge variant="secondary" className="ml-1 h-4 text-[10px] px-1">{activeEmails.length}</Badge>
              </Button>
              <Button
                size="sm"
                variant={activeTab === 'resolved' ? 'default' : 'ghost'}
                className="flex-1 gap-1 h-7 text-xs"
                onClick={() => { setActiveTab('resolved'); setSelectedEmail(null); setShowMobileList(true); }}
              >
                <CheckCircle2 className="h-3 w-3" />
                Resolved
                <Badge variant="secondary" className="ml-1 h-4 text-[10px] px-1">{resolvedEmails.length}</Badge>
              </Button>
            </div>
          </div>

          <EmailList
            emails={filteredEmails}
            selectedEmail={selectedEmail}
            onSelect={handleSelectEmail}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            filterPriority={filterPriority}
            onFilterPriorityChange={setFilterPriority}
            filterDepartment={filterDepartment}
            onFilterDepartmentChange={setFilterDepartment}
            departments={departments}
            loading={loading}
            onCompose={() => setComposeOpen(true)}
            processingEmail={processingEmail}
          />
        </div>

        {/* Email Detail */}
        <div className={`
          flex-1 overflow-hidden
          ${!showMobileList ? 'flex' : 'hidden md:flex'}
        `}>
          {/* Mobile back button */}
          <div className="md:hidden flex items-center p-2 border-b bg-card">
            <Button size="sm" variant="ghost" className="gap-1 text-xs" onClick={handleBackToList}>
              <Menu className="h-4 w-4" />
              Back to list
            </Button>
          </div>
          <EmailDetail
            email={selectedEmail}
            onEmailUpdated={fetchEmails}
            onReclassify={reclassifyEmail}
            isProcessing={processingEmail === selectedEmail?.id}
          />
        </div>
      </div>

      {/* Compose Dialog */}
      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent className="max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm md:text-base">
              <Plus className="h-4 w-4 md:h-5 md:w-5" />
              New Employee Request
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="space-y-1">
              <Label htmlFor="sender" className="text-xs md:text-sm">From (Employee Email)</Label>
              <Input id="sender" value={newEmail.sender} onChange={(e) => setNewEmail({ ...newEmail, sender: e.target.value })} placeholder="employee@company.com" className="text-xs md:text-sm" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="subject" className="text-xs md:text-sm">Subject</Label>
              <Input id="subject" value={newEmail.subject} onChange={(e) => setNewEmail({ ...newEmail, subject: e.target.value })} placeholder="e.g. VPN Connection Issue" className="text-xs md:text-sm" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="body" className="text-xs md:text-sm">Message</Label>
              <Textarea id="body" value={newEmail.body} onChange={(e) => setNewEmail({ ...newEmail, body: e.target.value })} placeholder="Describe the issue or request..." rows={5} className="text-xs md:text-sm resize-y" />
            </div>
            <Button onClick={sendNewEmail} disabled={!newEmail.sender || !newEmail.subject || !newEmail.body} className="w-full gap-2 text-xs md:text-sm">
              <Sparkles className="h-3 w-3 md:h-4 md:w-4" />
              Submit & Analyze with AI
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
