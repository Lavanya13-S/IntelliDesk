# IntelliDesk — AI Employee Helpdesk

IntelliDesk is a production-ready AI-powered internal helpdesk system for enterprises. It automatically receives employee requests via Gmail, classifies them using a rule-based AI engine, routes tickets to the correct department and subteam, manages approval workflows, assists engineers in resolving tickets, and builds a searchable knowledge base from resolved cases.

---

## Features

### Core Workflow
1. **Gmail Sync** — Automatically imports unread employee emails from a connected Gmail account via OAuth 2.0
2. **AI Classification** — Classifies each email by intent, department, subteam, priority, sentiment, risk level, and recommended decision using a deterministic rule-based taxonomy (185 test cases, 100% pass rate)
3. **Smart Routing** — Routes tickets to the correct department queue (HR, IT, Finance, SAP/ERP, Security, Facilities)
4. **Approval Workflow** — High-risk or sensitive tickets go through manager approval before a response is sent
5. **Department Resolution** — Engineers are assigned tickets, record internal resolution notes, and generate AI-assisted customer response emails via Gemini
6. **Knowledge Base (RAG)** — Resolved cases and uploaded enterprise documents are embedded and indexed for semantic search, powering future AI responses

### Additional Capabilities
- Real-time notification bell (new emails, critical alerts, approval requests, sent confirmations)
- Analytics dashboard (ticket volume, resolution rates, department breakdown)
- Organization directory (departments, teams, employees, managers)
- Semantic search across indexed knowledge base documents
- LangGraph multi-agent pipeline for orchestrated AI processing
- Smart attachments (PDF, DOCX, XLSX, PPTX, images via OCR, ZIP)
- System validation health check page

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 13 (App Router) |
| Language | TypeScript |
| Database | Supabase (PostgreSQL + pgvector) |
| AI | Google Gemini 2.5 Flash |
| AI Pipeline | LangGraph (`@langchain/langgraph`) |
| Auth | Supabase Auth |
| Gmail | Google OAuth 2.0 + Gmail API |
| Embeddings | Gemini `text-embedding-004` (768-dim) |
| Vector Search | pgvector (cosine similarity) |
| UI | React, Tailwind CSS, shadcn/ui, Framer Motion |
| Fonts | Inter (Google Fonts) |

---

## Getting Started

### Prerequisites
- Node.js 18+
- A [Supabase](https://supabase.com) project
- A [Google Cloud](https://console.cloud.google.com) project with Gmail API enabled and OAuth 2.0 credentials
- A [Google Gemini API key](https://aistudio.google.com/app/apikey)

### 1. Clone and Install

```bash
git clone <repo-url>
cd project
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the project root:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Gemini AI
GEMINI_API_KEY=your-gemini-api-key

# Google OAuth (Gmail)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 3. Run Database Migrations

Apply all SQL migrations in order via the Supabase SQL editor:

```
supabase/migrations/20260620110717_001_initial_schema.sql
supabase/migrations/20260620114651_002_knowledge_base.sql
... (apply all files in numerical order)
supabase/migrations/20260830000002_041_two_phase_resolution.sql
```

### 4. Create Admin User

```bash
$env:NEXT_PUBLIC_SUPABASE_URL="..."; $env:SUPABASE_SERVICE_ROLE_KEY="..."; npx tsx scripts/seed-demo-users.ts
```

### 5. Run the App

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### 6. Log In

| Email | Password | Role |
|-------|----------|------|
| intellidesk.support@gmail.com | demo123@1 | Admin |

Or click **Use Demo Login** on the login page to autofill credentials.

### 7. Connect Gmail

Go to **Settings → Email → Connect Gmail** and authorize your Google account to enable email sync.

---

## Project Structure

```
project/
├── app/
│   ├── auth/login/         # Login page
│   ├── dashboard/          # Main dashboard
│   ├── inbox/              # Email inbox & ticket view
│   ├── approvals/          # Manager approval queue
│   ├── department/         # Engineer department workspace
│   ├── knowledge/          # Document upload & semantic search
│   ├── settings/           # AI, Email, Notification settings
│   ├── validation/         # System health check
│   └── api/                # All API routes
├── components/             # Reusable UI components
├── lib/
│   ├── ai/
│   │   ├── classification-engine.ts   # Rule-based classifier
│   │   ├── classification-taxonomy.ts # Intent/dept/subteam rules
│   │   └── classification-test-cases.ts # 185 test cases
│   ├── langgraph-pipeline.ts          # Multi-agent pipeline
│   ├── gmail-client.ts                # Gmail API client
│   ├── agents.ts                      # Gemini AI agents
│   └── supabase.ts                    # Supabase client
├── scripts/                # Admin/maintenance scripts
└── supabase/migrations/    # Database schema (41 migrations)
```

---

## Classification Engine

The classification engine (`lib/ai/classification-engine.ts`) is a deterministic rule-based system — **no LLM required for classification**. It uses keyword scoring, regex patterns, and a weighted taxonomy to classify emails into:

- **Intent** (50+ types: Leave Request, IT Hardware Issue, Payroll Query, etc.)
- **Department** (HR, IT, Finance, SAP/ERP, Security, Facilities, General)
- **Subteam** (e.g. HR → Payroll, IT → Network Support, Finance → Accounts Payable)
- **Priority** (low / medium / high / critical / urgent)
- **Risk Level** (low / medium / high / critical)
- **Decision** (auto_resolve / needs_approval / escalate / needs_info)

**Test coverage:** 185 test cases · 100% pass rate

```bash
npx tsx scripts/run-classification-tests.ts
```

---

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/seed-demo-users.ts` | Create/update Supabase Auth users |
| `scripts/run-classification-tests.ts` | Run 185 classification test cases |
| `scripts/clear-stale-test-data.ts` | Remove test emails (no `gmail_message_id`) |

---

## License

Internal enterprise use. All rights reserved.
