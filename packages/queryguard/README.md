# @wilsonguenther/queryguard

**Drop-in observability for Supabase apps.**

[![npm](https://img.shields.io/badge/npm-%40wilsonguenther%2Fqueryguard-red?style=flat-square)](https://www.npmjs.com/package/@wilsonguenther/queryguard) [![Supabase](https://img.shields.io/badge/Supabase-ready-green?style=flat-square)](https://supabase.com) [![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue?style=flat-square)](https://www.typescriptlang.org) [![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)

---

## Why this exists

I built [Drivia](https://drivia.consulting) — a full-stack LMS on Supabase. Users were hitting broken screens. Data wasn't loading. Nobody knew why.

Supabase's dashboard showed raw logs — thousands of them, ungrouped, unsorted, with no way to know which ones were actually hurting users. RLS policies were silently blocking queries and returning empty arrays. No exception. No alert. Just a blank screen.

I got annoyed. I built this.

**Wilson Guenther** — [LinkedIn](https://www.linkedin.com/in/wilsonguenther) · [GitHub](https://github.com/wilsonguenther-dev) · [Drivia Consulting](https://drivia.consulting)

---

## Install

```bash
npm install @wilsonguenther/queryguard
```

---

## What it catches

- **Silent RLS 403s** — PostgREST returns 403 without throwing. QueryGuard catches it.
- **Slow queries** — Any Supabase call over 3 seconds, flagged automatically.
- **Edge function failures** — Failed `functions/v1/` calls, caught and grouped.
- **Auth failures** — Broken token refreshes, unexpected 4xx on `/auth/v1/`.
- **Empty result anomalies** — Query returns `[]` on a table that should have data? That's a bug.
- **RPC failures** — Failed `supabase.rpc()` calls with full context.
- **Client JS errors** — Unhandled exceptions and promise rejections.
- **Regressions** — A bug you fixed comes back? Issue reopens automatically.

All grouped by fingerprint. **One issue per bug, not one row per user.**

---

## Quick setup (3 steps)

### 1. Initialize once at app startup

```ts
import { initQueryGuard } from "@wilsonguenther/queryguard";

initQueryGuard({
  endpoint: "https://your-queryguard-dashboard.com/api/ingest",
  environment: process.env.NODE_ENV ?? "production",
});
```

### 2. Wrap your Supabase client

```ts
import { createBrowserClient } from "@supabase/ssr";
import { createGuardedFetch } from "@wilsonguenther/queryguard/supabase";

const guardedFetch = createGuardedFetch({
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
});

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { fetch: guardedFetch } } // <-- this is the entire integration
  );
}
```

### 3. Mount global error capture

```tsx
import { ErrorLogger } from "@wilsonguenther/queryguard/react";

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <ErrorLogger />
        {children}
      </body>
    </html>
  );
}
```

That's it. Every Supabase query failure, RLS block, slow call, and JS exception is now captured, fingerprinted, impact-scored, and sent to your dashboard.

---

## Entrypoints

```ts
import { initQueryGuard, captureException } from "@wilsonguenther/queryguard";
import { createGuardedFetch } from "@wilsonguenther/queryguard/supabase";
import { ErrorLogger, QueryGuardErrorBoundary } from "@wilsonguenther/queryguard/react";
import { withErrorCapture } from "@wilsonguenther/queryguard/server";
```

All entrypoints are tree-shakeable. Import only what you use.

---

## Manual capture

```ts
import { captureException, captureMessage } from "@wilsonguenther/queryguard";

try {
  await riskyOperation();
} catch (err) {
  captureException(err, { severity: "error", entity: "orders" });
}

captureMessage("Something suspicious happened", { severity: "warn" });
```

---

## Error boundary

```tsx
import { QueryGuardErrorBoundary } from "@wilsonguenther/queryguard/react";

<QueryGuardErrorBoundary fallback={<p>Something went wrong.</p>}>
  <MyFeature />
</QueryGuardErrorBoundary>
```

---

## Server-side (Next.js API routes)

```ts
import { withErrorCapture } from "@wilsonguenther/queryguard/server";
import { NextRequest, NextResponse } from "next/server";

export const GET = withErrorCapture(async (req: NextRequest) => {
  const data = await getData();
  return NextResponse.json(data);
});
```

---

## Config options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `endpoint` | `string` | required | Your QueryGuard dashboard ingestion URL |
| `environment` | `string` | `NODE_ENV` | `production` / `staging` / `development` |
| `deployVersion` | `string` | auto-detect | Git SHA for regression correlation |
| `slowQueryThresholdMs` | `number` | `3000` | Slow query flag threshold |
| `flushIntervalMs` | `number` | `2000` | How often to batch-send events |
| `debug` | `boolean` | `false` | Log SDK internals to console |
| `disabled` | `boolean` | `false` | Kill switch |

---

## Dashboard

The SDK sends events to your self-hosted QueryGuard dashboard — a Next.js app that shows:

- Grouped issues with fingerprint, impact score, affected users, SLA status
- Regression detection (reopens resolved issues automatically)
- 7-day trend chart + spike detection
- Breadcrumb trail (navigation, clicks, fetch calls before each error)
- Webhook alerts to Slack / Discord
- Daily error budget burn rate

→ **[github.com/wilsonguenther-dev/queryGuard](https://github.com/wilsonguenther-dev/queryGuard)**

---

## License

MIT — use it, sell it, ship it.

---

Built by **[Wilson Guenther](https://www.linkedin.com/in/wilsonguenther)** · [Drivia Consulting](https://drivia.consulting)
