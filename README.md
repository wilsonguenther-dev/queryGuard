# QueryGuard

**Drop-in observability for Supabase apps.**

![QueryGuard](https://img.shields.io/badge/@wilsonguenther%2Fqueryguard-v0.1.0-red?style=flat-square) ![Supabase](https://img.shields.io/badge/Supabase-ready-green?style=flat-square) ![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue?style=flat-square) ![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

---

## The origin story

I built [Drivia](https://drivia.consulting) — a full-stack LMS platform on Supabase. Users were hitting broken screens. Data wasn't loading. Nobody knew why.

Supabase's dashboard showed raw logs. Thousands of them. No grouping. No "this is the one that broke 47 users." No way to know if a bug was new or something we'd already fixed. RLS policies were silently blocking queries and returning empty arrays instead of errors — so the UI just... showed nothing. No exception. No alert. Nothing.

I got annoyed. I built this.

**Wilson Guenther** — Founder, [Drivia Consulting](https://drivia.consulting)
[LinkedIn](https://www.linkedin.com/in/wilsonguenther) · [GitHub](https://github.com/wilsonguenther-dev) · [npm](https://www.npmjs.com/package/@wilsonguenther/queryguard)

---

## What QueryGuard actually does

It sits between your app and Supabase and catches what the Supabase dashboard misses:

- **Silent RLS 403s** — PostgREST returns 403 without throwing. Your UI shows nothing. QueryGuard catches it, logs it, groups it, scores it.
- **Slow queries** — Any Supabase call over 3 seconds is flagged automatically.
- **Edge function failures** — Failed `functions/v1/` calls caught and grouped.
- **Auth failures** — Broken token refreshes, unexpected 4xx on `/auth/v1/`.
- **Empty result anomalies** — A query returns `[]` on a table that should have data for this user? That's a bug. QueryGuard sees it.
- **RPC failures** — Failed `supabase.rpc()` calls with full context.
- **Client JS errors** — Unhandled exceptions and promise rejections.
- **Regressions** — A bug you already fixed comes back? QueryGuard reopens the issue automatically.

All grouped by fingerprint. One issue per bug, not one row per user.

---

## What it catches

| Error Type | Description |
|---|---|
| **Silent Query Failures** | PostgREST 400/403/404/500 that return without throwing |
| **RLS 403 Forbidden** | Policies blocking authenticated users silently |
| **Slow Queries** | Any Supabase query taking > 3 seconds |
| **Edge Function Errors** | Failed Supabase Edge Function calls |
| **Auth Failures** | Token refresh failures, unexpected 4xx on `/auth/v1/` |
| **Empty Result Anomalies** | Queries that return `[]` on tables expected to have data |
| **RPC Failures** | Failed `supabase.rpc()` calls |
| **Client Errors** | Unhandled JS exceptions + promise rejections |
| **Regressions** | Previously resolved issues that come back |

---

## Features

- **Fingerprinting** — Same error groups into 1 issue, not 500 rows
- **Impact Scoring** — Dashboard errors score higher than admin errors
- **Error Budget** — Daily burn rate meter (like SRE error budgets)
- **7-Day Trend Chart** — Visual error spike detection
- **Regression Detection** — Reopens issues automatically when a fixed bug comes back
- **Breadcrumb Trail** — Captures navigation, clicks, and fetch calls before each error
- **Webhook Alerts** — POST to Slack/Discord on new issues
- **SLA Tracking** — Configurable response/resolve SLAs per severity
- **Bulk Actions** — Resolve/ignore/reopen 100 issues at once
- **CSV Export** — Full issue export for reporting
- **Canary Self-Check** — Heartbeat verifying the guard is running
- **Zero Performance Impact** — Batched async logging, never blocks the UI

---

## Quick Start

### 1. Clone + Install

```bash
git clone https://github.com/YOUR_ORG/queryguard.git
cd queryguard
npm install
```

### 2. Set up Supabase

Create a Supabase project at [supabase.com](https://supabase.com), then run the schema:

```bash
# Option A: Supabase CLI
supabase db push --db-url postgresql://...

# Option B: Paste into Supabase SQL Editor
# Copy contents of supabase/migrations/001_queryguard_schema.sql
```

### 3. Configure environment

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
NEXT_PUBLIC_SITE_URL=https://your-app.com
```

### 4. Adapt the RLS policies

QueryGuard's admin policies reference `public.user_profiles.role`. If your app uses a different auth/role system, update the `USING` clauses in `001_queryguard_schema.sql` to match. Example:

```sql
-- Default (user_profiles table with role column)
USING ((SELECT role FROM public.user_profiles WHERE auth_id = auth.uid() LIMIT 1) IN ('admin'))

-- Alternative (custom claims in JWT)
USING ((auth.jwt() ->> 'role') = 'admin')
```

### 5. Run the dashboard

```bash
npm run dev
# Open http://localhost:3001
```

---

## Integration into your existing Next.js + Supabase app

You need 4 files from the `src/` directory:

### Step 1 — Replace your Supabase clients

**Browser client** (`src/lib/supabase/client.ts`):
```typescript
import { createBrowserClient } from "@supabase/ssr";
import { guardedFetch } from "@/lib/query-guard"; // <-- add this

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: guardedFetch }, // <-- add this
    }
  );
}
```

**Server client** (`src/lib/supabase/server.ts`):
```typescript
import { serverGuardedFetch } from "@/lib/query-guard"; // <-- add this

// In createServerClient options:
global: { fetch: serverGuardedFetch }, // <-- add this
```

### Step 2 — Mount the ErrorLogger

In your root layout (`src/app/layout.tsx`):
```tsx
import { ErrorLogger } from "@/components/error-logger";

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <ErrorLogger /> {/* <-- add this */}
        {children}
      </body>
    </html>
  );
}
```

### Step 3 — Add the API route

Copy `src/app/api/error-log/route.ts` to your app's API routes directory.

### Step 4 — Add the dashboard page

Copy `src/app/dashboard/page.tsx` to your admin section (e.g., `/admin/errors`).

That's it. QueryGuard is now intercepting all Supabase traffic.

---

## API Reference

### `POST /api/error-log`

Log an error event. Called automatically by the guarded fetch and ErrorLogger.

```typescript
{
  error_message: string;       // Required
  error_stack?: string;
  component_name?: string;
  page_url?: string;
  severity?: "fatal" | "error" | "warn" | "info";
  error_type?: string;
  fingerprint?: string;        // Auto-generated if not provided
  impact_score?: number;       // Auto-calculated if not provided
  deploy_version?: string;
  session_id?: string;
  duration_ms?: number;
  metadata?: Record<string, unknown>;
}
```

**Response:**
```json
{ "logged": true, "fingerprint": "qg_abc123" }
```

---

### `GET /api/error-log`

Requires admin authentication.

| Query Param | Values | Description |
|---|---|---|
| `view` | `issues`, `logs`, `budget`, `spike`, `trend` | Data view to return |
| `limit` | integer | Max results (default: 100) |
| `severity` | `fatal`, `error`, `warn`, `info` | Filter by severity |
| `error_type` | `silent_query_failure`, etc. | Filter by type |
| `status` | `open`, `resolved`, `regressed` | Filter by status |

**Examples:**
```bash
GET /api/error-log?view=issues&limit=50&status=open
GET /api/error-log?view=budget
GET /api/error-log?view=spike
GET /api/error-log?view=trend
```

---

### `PATCH /api/error-log`

Requires admin authentication.

**Resolve an issue:**
```json
{ "action": "update_status", "issue_id": "uuid", "status": "resolved" }
```

**Run cleanup:**
```json
{ "action": "cleanup" }
```

---

## Dashboard

The QueryGuard dashboard is at `/dashboard` (or wherever you mount it). It includes:

- **Issues tab** — Grouped errors with fingerprint, impact score, occurrence count, affected users, SLA status, breadcrumbs, and bulk actions
- **Logs tab** — Raw event stream with full metadata
- **Query Health tab** — Per-table failure rates and slow query counts
- **Analytics tab** — Page-level breakdown and regression counts
- **Config tab** — Webhook alerts, SLA settings, daily snapshots

---

## Database Tables

| Table | Purpose |
|---|---|
| `client_error_log` | Raw error events (every individual occurrence) |
| `error_issues` | Grouped issues (one per unique fingerprint) |
| `queryguard_error_budget` | Daily burn rate tracking |
| `queryguard_alert_config` | Webhook/Slack/Discord alert configs |
| `queryguard_notes` | Issue comments and investigation logs |
| `queryguard_sla` | SLA configs per severity level |
| `queryguard_snapshots` | Daily trend snapshots |
| `queryguard_schema_manifest` | Schema drift detection |

---

## How Fingerprinting Works

Every error is reduced to a canonical key:

```
{error_type}|{entity}|{http_status}|{normalized_page_path}|{core_error_message}
```

Dynamic segments are normalized:
- UUIDs → `/:id`
- Long slugs → `/:slug`
- Query parameters → stripped

This means 500 users hitting the same RLS policy error on 500 different user pages produces **1 issue**, not 500.

---

## Impact Scoring

Issues are scored by journey criticality × severity:

```
impact = page_criticality (1-10) × severity_multiplier × type_multiplier
```

| Page | Criticality |
|---|---|
| `/dashboard` | 10 |
| `/dashboard/learn` | 9 |
| `/dashboard/courses` | 8 |
| `/admin` | 3 |

| Severity | Multiplier |
|---|---|
| 500 Server Error | 3× |
| 403 Forbidden | 2× |
| 400 Bad Request | 1.5× |

---

## Webhook Alerts

Configure in the dashboard Config tab or directly in `queryguard_alert_config`:

```sql
INSERT INTO queryguard_alert_config (name, alert_type, target_url, min_severity, throttle_minutes)
VALUES ('Slack #errors', 'webhook', 'https://hooks.slack.com/...', 'error', 60);
```

Payloads are Slack AND Discord compatible:
```json
{
  "text": "🔴 *[QueryGuard] NEW ISSUE*\nGET user_profiles → 403 Forbidden (RLS policy?)\nSeverity: error\nFingerprint: `qg_abc123`",
  "content": "..."
}
```

---

## Deployment

### Netlify / Vercel

```bash
# Add env vars in your dashboard:
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_SITE_URL=https://queryguard.yourdomain.com
```

### Self-hosted

QueryGuard is a standard Next.js app. Any Node.js hosting works:

```bash
npm run build
npm start
```

---

## Roadmap

- [ ] **SaaS mode** — Multi-tenant with per-project API keys
- [ ] **Email alerts** — Weekly digest + instant critical alerts
- [ ] **AI triage** — Auto-suggest fixes using AI based on error pattern
- [ ] **GitHub integration** — Auto-open issues on new regressions
- [ ] **Mobile app** — React Native dashboard for on-call engineers
- [ ] **OpenTelemetry** — OTEL trace correlation
- [x] **npm package** — `npm install queryguard` — shipped in v0.1.0

---

## License

MIT — use it, sell it, ship it.

---

## Built by

**Wilson Guenther** — [@wilsonguenther-dev](https://github.com/wilsonguenther-dev) · [Drivia Consulting](https://drivia.consulting)

QueryGuard was extracted from the [Drivia](https://drivia.consulting) LMS platform after getting tired of silent Supabase failures that affected real users with zero visibility. Built it. Packaged it. Shipped it.

If this helps you — star the repo, open issues, and tell people about it.
