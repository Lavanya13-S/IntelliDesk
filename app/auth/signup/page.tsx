'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Laptop2, Mail, Lock, User, Building2, Loader2, Eye, EyeOff, AlertCircle, CheckCircle2, ArrowLeft } from 'lucide-react';
import type { AppRole } from '@/lib/auth';

const ROLE_OPTIONS: { value: AppRole; label: string; description: string }[] = [
  { value: 'employee',         label: 'Employee',  description: 'Submit and track requests' },
  { value: 'manager',          label: 'Manager',   description: 'Approve and review tickets' },
  { value: 'department_staff', label: 'Engineer',  description: 'Process and resolve tickets' },
];

export default function SignupPage() {
  const router = useRouter();
  const [name,     setName]     = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [role,     setRole]     = useState<AppRole>('employee');
  const [dept,     setDept]     = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [success,  setSuccess]  = useState(false);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name } },
      });
      if (authError) throw authError;
      if (!data.user) throw new Error('Account creation failed. Please try again.');

      const { error: roleError } = await supabase.from('user_roles').upsert({
        email, role, display_name: name, department: dept.trim() || null, active: true,
      }, { onConflict: 'email' });

      if (roleError) console.warn('user_roles upsert warning:', roleError.message);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Account creation failed.');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-100 border border-emerald-200 mb-4">
            <CheckCircle2 className="h-7 w-7 text-emerald-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Account Created!</h2>
          <p className="text-gray-400 text-sm mb-6">
            Check your email to confirm your account, then sign in.
          </p>
          <Link href="/auth/login"
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl px-6 py-2.5 text-sm transition-all">
            Go to Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#e5e7eb_1px,transparent_1px),linear-gradient(to_bottom,#e5e7eb_1px,transparent_1px)] bg-[size:48px_48px] opacity-40" />

      <div className="relative w-full max-w-md">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition-colors mb-6 group">
          <ArrowLeft className="h-3.5 w-3.5 group-hover:-translate-x-0.5 transition-transform" />
          Back to Home
        </Link>

        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-600 shadow-lg shadow-indigo-200 mb-4">
            <Laptop2 className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">IntelliDesk</h1>
          <p className="text-gray-400 text-sm mt-1">Create your account</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-1">Create Account</h2>
          <p className="text-gray-400 text-sm mb-6">Join the IntelliDesk platform.</p>

          {error && (
            <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-lg p-3 mb-5">
              <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label htmlFor="signup-name" className="block text-xs font-medium text-gray-600 mb-1.5">Full Name</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input id="signup-name" type="text" required value={name} onChange={e => setName(e.target.value)}
                  placeholder="Sarah Johnson"
                  className="w-full bg-white border border-gray-200 rounded-xl pl-10 pr-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all" />
              </div>
            </div>

            <div>
              <label htmlFor="signup-email" className="block text-xs font-medium text-gray-600 mb-1.5">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input id="signup-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full bg-white border border-gray-200 rounded-xl pl-10 pr-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all" />
              </div>
            </div>

            <div>
              <label htmlFor="signup-password" className="block text-xs font-medium text-gray-600 mb-1.5">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input id="signup-password" type={showPass ? 'text' : 'password'} autoComplete="new-password" required minLength={8}
                  value={password} onChange={e => setPassword(e.target.value)} placeholder="Min. 8 characters"
                  className="w-full bg-white border border-gray-200 rounded-xl pl-10 pr-10 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all" />
                <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">Role</label>
              <div className="grid grid-cols-3 gap-2">
                {ROLE_OPTIONS.map(opt => (
                  <button key={opt.value} type="button" onClick={() => setRole(opt.value)}
                    className={`rounded-xl border p-2.5 text-left transition-all ${
                      role === opt.value
                        ? 'border-indigo-400 bg-indigo-50 ring-1 ring-indigo-400'
                        : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                    <p className={`text-xs font-bold ${role === opt.value ? 'text-indigo-600' : 'text-gray-700'}`}>{opt.label}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{opt.description}</p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="signup-dept" className="block text-xs font-medium text-gray-600 mb-1.5">
                Department <span className="text-gray-400">(optional)</span>
              </label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input id="signup-dept" type="text" value={dept} onChange={e => setDept(e.target.value)}
                  placeholder="e.g. SAP Basis, IT, HR"
                  className="w-full bg-white border border-gray-200 rounded-xl pl-10 pr-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all" />
              </div>
            </div>

            <button id="btn-signup-submit" type="submit" disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold rounded-xl py-2.5 text-sm transition-all shadow-sm mt-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {loading ? 'Creating account…' : 'Create Account'}
            </button>
          </form>

          <p className="text-center text-xs text-gray-400 mt-4">
            Already have an account?{' '}
            <Link href="/auth/login" className="text-indigo-500 hover:text-indigo-700 font-medium">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
