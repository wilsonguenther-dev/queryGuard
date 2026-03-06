# QueryGuard — Architecture

## Overview

QueryGuard is structured as two independent layers:

```
┌─────────────────────────────────────────────────┐
│  Your App (Next.js + Supabase)                  │
│                                                 │
│  initQueryGuard({ endpoint })                   │
│  createGuardedFetch()  ←── wraps all Supabase   │
│  <ErrorLogger />       ←── global JS errors     │
└──────────────────┬──────────────────────────────┘
                   │ POST /api/ingest (batched)
                   ▼
┌─────────────────────────────────────────────────┐
│  QueryGuard Dashboard (Next.js app)             │
│  /api/ingest   ←── SDK batch ingestion          │
│  /api/error-log ←── legacy single-event         │
│  /dashboard    ←── issues, logs, trends         │
└──────────────────┬──────────────────────────────┘
                   │ admin client (service role)
                   ▼
┌─────────────────────────────────────────────────┐
│  Supabase (Postgres)                            │
│  client_error_log   ← raw events               │
│  error_issues       ← grouped by fingerprint   │
│  queryguard_*       ← budget, alerts, SLA, etc │
└─────────────────────────────────────────────────┘
```

## SDK Layer (`packages/queryguard`)

### Modules

| Module | Purpose |
|---|---|
| `core/init.ts` | Singleton config + BatchQueue lifecycle |
| `core/capture.ts` | `captureException` / `captureMessage` |
| `core/breadcrumbs.ts` | Rolling breadcrumb store (30 max) |
| `core/impact.ts` | Impact score calculation (0–100) |
| `fingerprint/` | Deterministic grouping key generation |
| `normalize/` | Route normalization, entity extraction |
| `redaction/` | Header/body/metadata sanitization |
| `transport/batch-queue.ts` | Event buffering + flush + sendBeacon |
| `supabase/` | `createGuardedFetch`, `withQueryGuardSupabase` |
| `client/` | `setupGlobalClientErrorCapture` |
| `server/` | `withErrorCapture`, server-side helpers |
| `react/` | `QueryGuardErrorBoundary`, `ErrorLogger`, `useQueryGuard` |

### Event Flow (Browser)

```
Supabase fetch()
  → createGuardedFetch() intercepts
  → classifies endpoint (PostgREST / RPC / Auth / Edge Fn)
  → measures duration
  → if failure/slow: builds QueryGuardEvent
  → BatchQueue.enqueue(event)
  → [every 2s] BatchQueue.flush()
  → POST /api/ingest { events: [...] }
```

### Fingerprinting

Every event reduces to a canonical key:

```
{category}|{entity}|{http_status}|{normalized_route}|{core_message}
```

Dynamic segments are stripped:
- UUIDs → `:id`
- Long slugs (32+ chars) → `:slug`
- Numeric IDs (4+ digits) → `:id`
- Query parameters → removed

This means 500 users hitting the same RLS policy failure on different user pages produces **one issue**, not 500.

### Impact Scoring

```
impact = route_criticality(1–10) × severity_mult × status_mult × category_mult
```

Normalized to 0–100. Used to sort the issues list — high-impact issues always surface first.

### Tracing

Every event carries trace-ready fields:

- `trace_id` — correlates a chain of related events
- `span_id` — individual span within a trace
- `parent_span_id` — parent span for hierarchical context
- `session_id` — stable per-tab session ID
- `deploy_version` — git SHA for regression correlation

These fields are present in the schema now for future OpenTelemetry integration.

## Dashboard Layer (`src/`)

### Ingestion Routes

| Route | Purpose |
|---|---|
| `POST /api/ingest` | New SDK batch endpoint (IngestionPayload) |
| `POST /api/error-log` | Legacy single-event endpoint (backward compat) |
| `GET /api/error-log` | Issues, logs, budget, spike, trend data |
| `PATCH /api/error-log` | Resolve, ignore, cleanup |

### Database Tables

| Table | Purpose |
|---|---|
| `client_error_log` | Raw events (every occurrence) |
| `error_issues` | Grouped issues (one per fingerprint) |
| `queryguard_error_budget` | Daily burn rate tracking |
| `queryguard_alert_config` | Webhook/Slack/Discord alerts |
| `queryguard_notes` | Issue comments |
| `queryguard_sla` | SLA configs per severity |
| `queryguard_snapshots` | Daily trend snapshots |
| `queryguard_schema_manifest` | Schema drift detection |

## Security

- All admin routes check `user_profiles.role` via RLS
- Raw event inserts are open to `anon` (errors come from unauthenticated users too)
- SDK ingestion uses admin client (service role) server-side — never exposes service key to browser
- All event payloads are redacted before ingestion (no tokens, no auth headers)
- sendBeacon fallback for unload scenarios uses same redaction pipeline

## Multi-project (future)

The event model already includes `project_id` and `environment` fields. The `/api/ingest` route accepts an optional `api_key` field. Full multi-tenant SaaS mode requires:

1. A `projects` table with API keys
2. `api_key` validation middleware on `/api/ingest`
3. Scoping all dashboard queries by `project_id`
