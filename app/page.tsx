'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Mail, Cpu, UserCheck, Building2, Wrench, BookOpen,
  BarChart3, Shield, ArrowRight, ChevronRight, Check,
  Laptop2, Clock, AlertCircle, CheckCircle2, Users,
  GitBranch, Inbox, TrendingUp,
} from 'lucide-react';

// ── Animation variants ────────────────────────────────────────────────────────
const fadeUp = {
  hidden:  { opacity: 0, y: 20 },
  visible: (i = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.5, delay: i * 0.08, ease: 'easeOut' as const } }),
};

// ── Features ──────────────────────────────────────────────────────────────────
const FEATURES = [
  { icon: Mail,         title: 'Email Integration',        desc: 'Employee emails are automatically converted into structured tickets — no form needed.' },
  { icon: Cpu,          title: 'AI Classification',        desc: 'Issue type, department, priority and urgency detected in under 3 seconds.' },
  { icon: UserCheck,    title: 'Manager Approval',         desc: 'Approval-required requests are routed to the correct manager automatically.' },
  { icon: Building2,    title: 'Department Routing',       desc: 'Tickets are assigned to the right support team based on skill and load.' },
  { icon: Wrench,       title: 'Resolution Assistant',     desc: 'Engineers get AI-generated draft responses to resolve tickets faster.' },
  { icon: BookOpen,     title: 'Knowledge Base',           desc: 'Every resolved ticket automatically generates a reusable KB article.' },
  { icon: BarChart3,    title: 'Analytics',                desc: 'SLA compliance, engineer productivity and ticket trends in real time.' },
  { icon: Shield,       title: 'Enterprise Security',      desc: 'Role-based access control with a complete audit trail on every action.' },
];

// ── Process timeline ──────────────────────────────────────────────────────────
const STEPS = [
  { icon: Mail,      label: 'Employee Request',   desc: 'Email received' },
  { icon: Cpu,       label: 'AI Classification',  desc: 'Type & priority set' },
  { icon: UserCheck, label: 'Manager Approval',   desc: 'If required' },
  { icon: Building2, label: 'Dept Routing',        desc: 'Right team assigned' },
  { icon: Wrench,    label: 'Resolution',          desc: 'Draft generated' },
  { icon: BookOpen,  label: 'Knowledge Base',      desc: 'Article created' },
];

// ── Case studies ──────────────────────────────────────────────────────────────
const CASES = [
  { dept: 'HR Department',  metric: '72%',  desc: 'Reduction in average ticket resolution time after routing automation.',     tag: 'Routing' },
  { dept: 'Finance',         metric: '100%', desc: 'Approval requests automatically routed to the correct manager with zero manual effort.', tag: 'Approvals' },
  { dept: 'IT Support',     metric: '38%',  desc: 'Fewer repeated tickets after Knowledge Base was enabled from resolved cases.', tag: 'Knowledge Base' },
];

// ── Nav links ─────────────────────────────────────────────────────────────────
const NAV = [
  { href: '#features', label: 'Features' },
  { href: '#workflow', label: 'How it works' },
  { href: '#results',  label: 'Results' },
];

// ── Hero mockup ───────────────────────────────────────────────────────────────
function HeroMockup() {
  return (
    <div className="relative w-full max-w-[520px] select-none">
      {/* Main card */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl shadow-gray-200/80 overflow-hidden">
        {/* Title bar */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50/80">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-400" />
            <div className="w-3 h-3 rounded-full bg-amber-400" />
            <div className="w-3 h-3 rounded-full bg-emerald-400" />
          </div>
          <div className="flex-1 flex justify-center">
            <div className="text-xs text-gray-400 bg-white border border-gray-200 rounded-md px-3 py-1">
              intellidesk.app/dashboard
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3">
          {/* KPI row */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Open Tickets', value: '24', color: 'text-indigo-600', bg: 'bg-indigo-50' },
              { label: 'Pending Approval', value: '7',  color: 'text-amber-600', bg: 'bg-amber-50' },
              { label: 'Resolved Today', value: '18', color: 'text-emerald-600', bg: 'bg-emerald-50' },
            ].map(k => (
              <div key={k.label} className={`rounded-xl ${k.bg} p-3`}>
                <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
                <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">{k.label}</p>
              </div>
            ))}
          </div>

          {/* Ticket list */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Recent Tickets</p>
            {[
              { id: '#1042', subject: 'SAP access provisioning request',  dept: 'SAP Basis', status: 'In Progress', badge: 'bg-blue-100 text-blue-600' },
              { id: '#1041', subject: 'Leave encashment query',            dept: 'HR',        status: 'Approval',    badge: 'bg-amber-100 text-amber-600' },
              { id: '#1040', subject: 'Laptop replacement needed',         dept: 'IT',        status: 'Resolved',    badge: 'bg-emerald-100 text-emerald-600' },
            ].map(t => (
              <div key={t.id} className="flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-2 hover:bg-gray-50">
                <span className="text-[10px] text-gray-400 font-mono w-10 shrink-0">{t.id}</span>
                <span className="text-xs text-gray-700 flex-1 truncate">{t.subject}</span>
                <span className="text-[10px] text-gray-400 hidden sm:block">{t.dept}</span>
                <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${t.badge}`}>{t.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Floating approval card */}
      <motion.div
        initial={{ opacity: 0, x: 20, y: 10 }}
        animate={{ opacity: 1, x: 0, y: 0 }}
        transition={{ delay: 0.6, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="absolute -right-6 top-1/3 w-44 bg-white rounded-xl border border-gray-200 shadow-xl shadow-gray-200/60 p-3"
      >
        <div className="flex items-center gap-2 mb-2">
          <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center">
            <Clock className="h-3 w-3 text-amber-600" />
          </div>
          <p className="text-[10px] font-semibold text-gray-700">Pending Approval</p>
        </div>
        <p className="text-[10px] text-gray-500 leading-tight">Leave encashment — Sarah Johnson</p>
        <div className="flex gap-1.5 mt-2">
          <div className="flex-1 bg-emerald-500 text-white text-[9px] font-bold rounded-md py-1 text-center">Approve</div>
          <div className="flex-1 bg-gray-100 text-gray-500 text-[9px] font-bold rounded-md py-1 text-center">Reject</div>
        </div>
      </motion.div>

      {/* Floating classification card */}
      <motion.div
        initial={{ opacity: 0, x: -20, y: 10 }}
        animate={{ opacity: 1, x: 0, y: 0 }}
        transition={{ delay: 0.8, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="absolute -left-6 bottom-8 w-40 bg-white rounded-xl border border-gray-200 shadow-xl shadow-gray-200/60 p-3"
      >
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-5 h-5 rounded-md bg-indigo-100 flex items-center justify-center">
            <Cpu className="h-3 w-3 text-indigo-600" />
          </div>
          <p className="text-[10px] font-semibold text-gray-700">AI Classified</p>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-[9px] text-gray-400">Priority</span>
            <span className="text-[9px] font-semibold text-red-500">High</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[9px] text-gray-400">Dept</span>
            <span className="text-[9px] font-semibold text-gray-700">SAP Basis</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1 mt-1">
            <div className="bg-indigo-500 h-1 rounded-full" style={{ width: '91%' }} />
          </div>
          <p className="text-[9px] text-gray-400 text-right">91% confidence</p>
        </div>
      </motion.div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#111827] overflow-x-hidden">

      {/* ── Navbar ─────────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 inset-x-0 z-50 bg-white/80 backdrop-blur-xl border-b border-[#E5E7EB]">
        <div className="max-w-7xl mx-auto px-6 h-15 flex items-center justify-between" style={{ height: 60 }}>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#4F46E5] flex items-center justify-center">
              <Laptop2 className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-[15px] text-[#111827] tracking-tight">IntelliDesk</span>
          </div>

          <div className="hidden md:flex items-center gap-6">
            {NAV.map(n => (
              <a key={n.href} href={n.href}
                className="text-sm text-[#6B7280] hover:text-[#111827] transition-colors font-medium">
                {n.label}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-2.5">
            <Link href="/auth/login"
              className="hidden sm:block text-sm font-medium text-[#6B7280] hover:text-[#111827] transition-colors px-3 py-1.5">
              Sign In
            </Link>
            <Link href="/auth/login"
              className="text-sm font-semibold bg-[#4F46E5] hover:bg-[#4338CA] text-white rounded-lg px-4 py-2 transition-colors shadow-sm">
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section className="pt-28 pb-24 px-6">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row items-center gap-16">

          {/* Left */}
          <div className="flex-1 max-w-xl">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="inline-flex items-center gap-2 bg-[#EEF2FF] text-[#4F46E5] rounded-full px-3.5 py-1.5 text-xs font-semibold mb-6 border border-indigo-100"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-[#4F46E5]" />
              AI Employee Helpdesk
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.05 }}
              className="text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.08] text-[#111827] mb-5"
            >
              Employee support,{' '}
              <span className="text-[#4F46E5]">fully automated</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.1 }}
              className="text-lg text-[#6B7280] leading-relaxed mb-8 max-w-lg"
            >
              IntelliDesk receives employee requests, routes them to the right team,
              manages manager approvals, assists engineers in resolving tickets,
              and builds a knowledge base from every case — automatically.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.15 }}
              className="flex flex-wrap gap-3 mb-10"
            >
              {[
                { label: 'Employee Portal',  role: 'employee' },
                { label: 'Manager Portal',   role: 'manager' },
                { label: 'Engineer Portal',  role: 'engineer' },
                { label: 'Admin Portal',     role: 'admin' },
              ].map(p => (
                <Link key={p.label} href="/auth/login"
                  className="flex items-center gap-1.5 text-sm font-medium border border-[#E5E7EB] bg-white hover:border-[#4F46E5] hover:text-[#4F46E5] text-[#374151] rounded-lg px-4 py-2 transition-all shadow-sm">
                  {p.label}
                  <ChevronRight className="h-3.5 w-3.5 opacity-50" />
                </Link>
              ))}
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="flex items-center gap-5 text-sm text-[#6B7280]"
            >
              {['No manual routing', 'Auto approval workflow', 'Zero config KB'].map(f => (
                <span key={f} className="flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-[#4F46E5]" />
                  {f}
                </span>
              ))}
            </motion.div>
          </div>

          {/* Right — Dashboard mockup */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="flex-1 flex justify-center lg:justify-end"
          >
            <HeroMockup />
          </motion.div>
        </div>
      </section>

      {/* ── Metrics strip ──────────────────────────────────────────────────── */}
      <section className="border-y border-[#E5E7EB] bg-white py-6 px-6">
        <div className="max-w-5xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-6">
          {[
            { label: 'Classification time',   value: '< 3s' },
            { label: 'Routing accuracy',      value: '94%' },
            { label: 'Avg resolution',        value: '< 6h' },
            { label: 'Audit coverage',        value: '100%' },
          ].map((m, i) => (
            <motion.div key={m.label} custom={i} variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}
              className="text-center">
              <p className="text-2xl font-extrabold text-[#111827]">{m.value}</p>
              <p className="text-xs text-[#6B7280] mt-1">{m.label}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────────────────────── */}
      <section id="features" className="py-24 px-6">
        <div className="max-w-7xl mx-auto">
          <motion.div variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}
            className="mb-14">
            <p className="text-xs font-bold uppercase tracking-widest text-[#4F46E5] mb-3">Platform</p>
            <h2 className="text-4xl font-extrabold text-[#111827] tracking-tight max-w-lg leading-tight">
              Everything your helpdesk needs
            </h2>
            <p className="text-[#6B7280] mt-4 max-w-lg leading-relaxed">
              From the first email to a closed ticket and an auto-generated knowledge base article — IntelliDesk handles every step.
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {FEATURES.map((f, i) => {
              const Icon = f.icon;
              return (
                <motion.div key={f.title} custom={i} variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}
                  className="group bg-white rounded-2xl border border-[#E5E7EB] p-6 hover:border-[#4F46E5]/30 hover:shadow-md hover:-translate-y-0.5 transition-all cursor-default">
                  <div className="w-9 h-9 rounded-xl bg-[#EEF2FF] flex items-center justify-center mb-4">
                    <Icon className="h-4.5 w-4.5 text-[#4F46E5]" style={{ width: 18, height: 18 }} />
                  </div>
                  <h3 className="font-semibold text-[#111827] mb-1.5 text-sm">{f.title}</h3>
                  <p className="text-xs text-[#6B7280] leading-relaxed">{f.desc}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Workflow timeline ───────────────────────────────────────────────── */}
      <section id="workflow" className="py-24 px-6 bg-white border-y border-[#E5E7EB]">
        <div className="max-w-7xl mx-auto">
          <motion.div variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}
            className="mb-14 text-center">
            <p className="text-xs font-bold uppercase tracking-widest text-[#4F46E5] mb-3">Workflow</p>
            <h2 className="text-4xl font-extrabold text-[#111827] tracking-tight">How every ticket flows</h2>
            <p className="text-[#6B7280] mt-4 max-w-lg mx-auto">
              Six stages. Fully automated. Each one tracked and audited.
            </p>
          </motion.div>

          <div className="relative">
            {/* Connector line */}
            <div className="absolute top-9 left-[8%] right-[8%] h-px bg-[#E5E7EB] hidden lg:block" />

            <div className="grid grid-cols-2 lg:grid-cols-6 gap-8 relative">
              {STEPS.map((s, i) => {
                const Icon = s.icon;
                return (
                  <motion.div key={s.label} custom={i} variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}
                    className="flex flex-col items-center text-center gap-3">
                    <div className="w-[72px] h-[72px] rounded-full bg-white border-2 border-[#E5E7EB] flex items-center justify-center shadow-sm z-10 group hover:border-[#4F46E5] transition-colors">
                      <Icon className="h-6 w-6 text-[#4F46E5]" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-[#111827]">{s.label}</p>
                      <p className="text-[11px] text-[#6B7280] mt-0.5">{s.desc}</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ── Results / Case studies ──────────────────────────────────────────── */}
      <section id="results" className="py-24 px-6">
        <div className="max-w-7xl mx-auto">
          <motion.div variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}
            className="mb-14">
            <p className="text-xs font-bold uppercase tracking-widest text-[#4F46E5] mb-3">Results</p>
            <h2 className="text-4xl font-extrabold text-[#111827] tracking-tight max-w-lg leading-tight">
              Teams that use IntelliDesk move faster
            </h2>
          </motion.div>

          <div className="grid sm:grid-cols-3 gap-5">
            {CASES.map((c, i) => (
              <motion.div key={c.dept} custom={i} variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}
                className="bg-white rounded-2xl border border-[#E5E7EB] p-7 hover:shadow-md hover:-translate-y-0.5 transition-all">
                <div className="inline-flex items-center gap-1.5 bg-[#EEF2FF] text-[#4F46E5] rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide mb-5">
                  {c.tag}
                </div>
                <p className="text-5xl font-extrabold text-[#111827] mb-3">{c.metric}</p>
                <p className="text-sm font-semibold text-[#111827] mb-1">{c.dept}</p>
                <p className="text-sm text-[#6B7280] leading-relaxed">{c.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────────────────── */}
      <section className="py-24 px-6 bg-white border-t border-[#E5E7EB]">
        <div className="max-w-3xl mx-auto text-center">
          <motion.div variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}>
            <h2 className="text-4xl font-extrabold text-[#111827] tracking-tight mb-4">
              Ready to automate your helpdesk?
            </h2>
            <p className="text-[#6B7280] mb-8 text-lg max-w-xl mx-auto leading-relaxed">
              Sign in and experience the full lifecycle — from AI classification to automatic knowledge base creation.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link href="/auth/login"
                className="flex items-center gap-2 bg-[#4F46E5] hover:bg-[#4338CA] text-white font-semibold rounded-xl px-6 py-3 text-sm transition-colors shadow-sm shadow-indigo-200">
                Sign In
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/auth/signup"
                className="flex items-center gap-2 border border-[#E5E7EB] bg-white hover:border-[#4F46E5] hover:text-[#4F46E5] text-[#374151] font-semibold rounded-xl px-6 py-3 text-sm transition-all">
                Create Account
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="border-t border-[#E5E7EB] py-10 px-6 bg-[#F8FAFC]">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-md bg-[#4F46E5] flex items-center justify-center">
              <Laptop2 className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="font-bold text-[#111827] text-sm">IntelliDesk</span>
            <span className="text-xs text-[#6B7280]">— AI Employee Helpdesk</span>
          </div>

          <div className="flex items-center gap-5 text-sm text-[#6B7280]">
            <Link href="/"            className="hover:text-[#111827] transition-colors">Home</Link>
            <Link href="/auth/login"  className="hover:text-[#111827] transition-colors">Login</Link>
            <Link href="/auth/signup" className="hover:text-[#111827] transition-colors">Register</Link>
            <Link href="/dashboard"   className="hover:text-[#111827] transition-colors">Dashboard</Link>
          </div>

          <p className="text-xs text-[#6B7280]">© 2026 IntelliDesk. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
