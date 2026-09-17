'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { getCurrentProfile } from '@/lib/auth';
import { Laptop2, Mail, Lock, Loader2, Eye, EyeOff, AlertCircle, ArrowLeft } from 'lucide-react';

export default function LoginPage() {
  const searchParams = useSearchParams();
  const redirectTo   = searchParams.get('redirect') || null;

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      console.log('[Login] Signing in:', email);
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) throw authError;

      const profile = await getCurrentProfile();
      const role    = profile?.role || 'department_staff';
      let home: string;
      if (redirectTo) { home = redirectTo; }
      else {
        switch (role) {
          case 'admin':            home = '/dashboard'; break;
          case 'department_staff': home = '/dashboard'; break;
          case 'manager':          home = '/approvals'; break;
          case 'employee':         home = '/dashboard'; break;
          default:                 home = '/dashboard'; break;
        }
      }
      console.log('[Login] Redirect to:', home, '| role:', role);
      window.location.href = home;
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check your credentials.');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex">
      {/* Left — Branding panel */}
      <div className="hidden lg:flex flex-col justify-between w-[420px] shrink-0 bg-[#4F46E5] p-12">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center">
            <Laptop2 className="h-4.5 w-4.5 text-white" style={{ width: 18, height: 18 }} />
          </div>
          <span className="font-bold text-white text-base">IntelliDesk</span>
        </div>

        <div>
          <p className="text-indigo-200 text-sm font-semibold uppercase tracking-wider mb-4">AI Employee Helpdesk</p>
          <h2 className="text-3xl font-extrabold text-white leading-tight mb-6">
            Automate your entire helpdesk workflow
          </h2>
          <div className="space-y-3">
            {[
              'Emails automatically converted to tickets',
              'AI classifies type, priority and department',
              'Manager approvals routed automatically',
              'Engineers get AI-generated resolution drafts',
              'Knowledge Base built from every resolved case',
            ].map(f => (
              <div key={f} className="flex items-start gap-2.5">
                <div className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center shrink-0 mt-0.5">
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                    <path d="M1.5 4L3 5.5L6.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <p className="text-sm text-indigo-100 leading-snug">{f}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="text-indigo-300 text-xs">© 2026 IntelliDesk. All rights reserved.</p>
      </div>

      {/* Right — Login form */}
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="w-full max-w-[400px]">

          {/* Back */}
          <Link href="/"
            className="inline-flex items-center gap-1.5 text-sm text-[#6B7280] hover:text-[#111827] transition-colors mb-8 group">
            <ArrowLeft className="h-3.5 w-3.5 group-hover:-translate-x-0.5 transition-transform" />
            Back to Home
          </Link>

          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            {/* Logo (mobile only) */}
            <div className="flex items-center gap-2 mb-6 lg:hidden">
              <div className="w-8 h-8 rounded-lg bg-[#4F46E5] flex items-center justify-center">
                <Laptop2 className="h-4 w-4 text-white" />
              </div>
              <span className="font-bold text-[#111827]">IntelliDesk</span>
            </div>

            <h1 className="text-2xl font-extrabold text-[#111827] tracking-tight mb-1">Welcome back</h1>
            <p className="text-sm text-[#6B7280] mb-7">Sign in to continue to IntelliDesk.</p>

            {error && (
              <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5 mb-5">
                <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label htmlFor="login-email" className="block text-xs font-semibold text-[#374151] mb-1.5">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
                  <input
                    id="login-email" type="email" autoComplete="email" required
                    value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="w-full bg-white border border-[#E5E7EB] rounded-xl pl-10 pr-4 py-2.5 text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#4F46E5]/30 focus:border-[#4F46E5] transition-all"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="login-password" className="block text-xs font-semibold text-[#374151]">Password</label>
                  <Link href="/auth/forgot-password" className="text-xs text-[#4F46E5] hover:text-[#4338CA] transition-colors">
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
                  <input
                    id="login-password" type={showPass ? 'text' : 'password'} autoComplete="current-password" required
                    value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••"
                    className="w-full bg-white border border-[#E5E7EB] rounded-xl pl-10 pr-10 py-2.5 text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#4F46E5]/30 focus:border-[#4F46E5] transition-all"
                  />
                  <button type="button" onClick={() => setShowPass(!showPass)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#6B7280] transition-colors">
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button id="btn-login-submit" type="submit" disabled={loading}
                className="w-full flex items-center justify-center gap-2 bg-[#4F46E5] hover:bg-[#4338CA] disabled:opacity-60 text-white font-semibold rounded-xl py-2.5 text-sm transition-colors shadow-sm shadow-indigo-200/50 mt-1">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {loading ? 'Signing in…' : 'Sign In'}
              </button>

              <p className="text-center text-xs text-[#9CA3AF] pt-1">
                <button
                  type="button"
                  onClick={() => { setEmail('intellidesk.support@gmail.com'); setPassword('demo123@1'); setError(null); }}
                  className="text-[#4F46E5] hover:text-[#4338CA] font-medium transition-colors underline underline-offset-2"
                >
                  Use Demo Login
                </button>
              </p>
            </form>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
