# QueryGuard SDK — Usage Guide

## Installation

```bash
npm install queryguard
# or
pnpm add queryguard
# or
yarn add queryguard
```

## 1. Initialize once at app startup

```ts
// app/providers.tsx (or wherever you bootstrap your app)
import { initQueryGuard } from "queryguard";

initQueryGuard({
  endpoint: "https://your-queryguard.yourdomain.com/api/ingest",
  environment: process.env.NODE_ENV ?? "production",
  deployVersion: process.env.NEXT_PUBLIC_DEPLOY_SHA,
});
```

The SDK is a no-op until `initQueryGuard()` is called. It never throws.

## 2. Instrument your Supabase client

### Browser client

```ts
// lib/supabase/client.ts
import { createBrowserClient } from "@supabase/ssr";
import { createGuardedFetch } from "queryguard/supabase";

const guardedFetch = createGuardedFetch({
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
});

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { fetch: guardedFetch } }
  );
}
```

### Server client (Next.js App Router)

```ts
// lib/supabase/server.ts
import { createServerClient } from "@supabase/ssr";
import { createGuardedFetch } from "queryguard/supabase";
import { cookies } from "next/headers";

const guardedFetch = createGuardedFetch({
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
});

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    global: { fetch: guardedFetch },
    cookies: { /* ... */ },
  });
}
```

That is the entire Supabase integration. All PostgREST queries, RPC calls, auth requests, and edge function calls are now instrumented.

## 3. Mount global error capture

```tsx
// app/layout.tsx
import { ErrorLogger } from "queryguard/react";

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

`<ErrorLogger />` attaches `window.onerror` and `unhandledrejection` handlers and starts breadcrumb collection. It renders nothing — it's a side-effect only component.

## 4. Wrap React trees with the error boundary (optional)

```tsx
import { QueryGuardErrorBoundary } from "queryguard/react";

<QueryGuardErrorBoundary fallback={<p>Something went wrong.</p>}>
  <MyFeature />
</QueryGuardErrorBoundary>
```

## 5. Manual capture

```ts
import { captureException, captureMessage } from "queryguard";

// Capture a caught exception
try {
  await riskyOperation();
} catch (err) {
  captureException(err, {
    category: "server_error",
    entity: "orders",
    severity: "error",
  });
}

// Capture a plain message
captureMessage("User hit an edge case we should investigate", {
  severity: "warn",
  category: "unknown",
  metadata: { userId: "abc123" },
});
```

## 6. Server-side (API routes)

```ts
// app/api/my-route/route.ts
import { withErrorCapture } from "queryguard/server";
import { NextRequest, NextResponse } from "next/server";

export const GET = withErrorCapture(async (req: NextRequest) => {
  const data = await getData();
  return NextResponse.json(data);
});
```

## Configuration reference

| Option | Type | Default | Description |
|---|---|---|---|
| `endpoint` | `string` | required | Ingestion URL |
| `apiKey` | `string` | — | Future: multi-project auth |
| `environment` | `string` | `NODE_ENV` | `production` / `staging` / `development` |
| `deployVersion` | `string` | auto-detect | Git SHA for regression correlation |
| `slowQueryThresholdMs` | `number` | `3000` | Slow query threshold in ms |
| `flushIntervalMs` | `number` | `2000` | Batch flush interval |
| `maxBatchSize` | `number` | `20` | Max events per batch |
| `maxBreadcrumbs` | `number` | `30` | Max breadcrumbs in memory |
| `debug` | `boolean` | `false` | Log SDK internals to console |
| `disabled` | `boolean` | `false` | Disable SDK entirely |

## Tree-shaking

The SDK uses `"sideEffects": false` in its package.json. Import only what you use:

```ts
import { initQueryGuard } from "queryguard";                    // core only
import { createGuardedFetch } from "queryguard/supabase";       // Supabase only
import { QueryGuardErrorBoundary } from "queryguard/react";     // React only
import { withErrorCapture } from "queryguard/server";           // Server only
```
