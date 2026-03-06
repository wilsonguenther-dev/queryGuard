# QueryGuard — Migration Guide

## Migrating from the legacy single-event API to the SDK

### Before (legacy — still works)

```ts
// Your app directly called /api/error-log with a single event
fetch("/api/error-log", {
  method: "POST",
  body: JSON.stringify({
    error_message: "Something failed",
    page_url: window.location.href,
    severity: "error",
  }),
});
```

### After (SDK)

```ts
// 1. Install and init once
import { initQueryGuard, captureException } from "queryguard";

initQueryGuard({
  endpoint: "https://your-queryguard.yourdomain.com/api/ingest",
});

// 2. Use captureException anywhere
captureException(new Error("Something failed"), {
  severity: "error",
});
// Events are batched and sent automatically — no fetch() call needed
```

The legacy `/api/error-log` route **remains fully functional**. You do not need to migrate existing integrations unless you want the richer SDK features (batching, tracing, breadcrumbs, better fingerprinting).

## Migrating from ad-hoc guarded fetch to SDK

### Before

```ts
// src/lib/supabase/client.ts
import { guardedFetch } from "@/lib/query-guard";

export function createClient() {
  return createBrowserClient(url, key, {
    global: { fetch: guardedFetch },
  });
}
```

### After

```ts
// src/lib/supabase/client.ts
import { createGuardedFetch } from "queryguard/supabase";

const guardedFetch = createGuardedFetch({
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
});

export function createClient() {
  return createBrowserClient(url, key, {
    global: { fetch: guardedFetch },
  });
}
```

The behavior is identical — the SDK version is just typed, tested, and tree-shakeable.

## Ingestion endpoint change

The new SDK sends events to `/api/ingest` (batch format) instead of `/api/error-log` (single event).

Both endpoints are supported simultaneously:

| Endpoint | Format | Status |
|---|---|---|
| `POST /api/error-log` | Single event | Legacy — maintained |
| `POST /api/ingest` | Batch (IngestionPayload) | New SDK default |

To point existing integrations at the new batch endpoint, just update the `endpoint` in `initQueryGuard`.

## Schema migration

If you are running an older version of QueryGuard schema, apply the latest migration:

```bash
# Option A: Supabase CLI
supabase db push --db-url postgresql://...

# Option B: Paste into Supabase SQL Editor
# supabase/migrations/001_queryguard_schema.sql
```

The schema is backward-compatible. New columns use `DEFAULT` values so existing rows are not affected.
