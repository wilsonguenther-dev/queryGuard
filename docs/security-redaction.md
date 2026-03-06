# QueryGuard — Security & Redaction

## What is redacted by default

QueryGuard applies a redaction pipeline before any event is shipped to the ingestion endpoint. The following are **always** removed or replaced with `[REDACTED]`:

### Headers (case-insensitive)
- `authorization`
- `cookie` / `set-cookie`
- `x-auth-token` / `x-api-key` / `x-access-token` / `x-refresh-token`
- `apikey` / `api-key`
- `x-supabase-auth`

### Body fields (when body logging is enabled)
- `password` / `passwd`
- `secret` / `token`
- `access_token` / `refresh_token`
- `api_key` / `apikey`
- `private_key`
- `credit_card` / `card_number` / `cvv` / `ssn`

### URLs
- All query parameters are stripped from request URLs before logging
- `?access_token=...`, `?apikey=...`, etc. never appear in events

### Body logging
Body logging is **disabled by default** (`maxBodySize: 0`).
Enable it explicitly if needed:

```ts
initQueryGuard({
  endpoint: "...",
  redaction: {
    maxBodySize: 512, // max bytes to capture
  },
});
```

## Custom redaction config

```ts
import { initQueryGuard } from "queryguard";
import type { RedactionConfig } from "queryguard";

const myRedactionConfig: RedactionConfig = {
  redactHeaders: [
    "authorization",
    "cookie",
    "x-my-internal-token",
  ],
  redactBodyFields: [
    "password",
    "ssn",
    "credit_card",
    "my_custom_secret_field",
  ],
  maxMetadataValueLength: 200,
  maxBodySize: 0, // keep disabled
};

initQueryGuard({
  endpoint: "...",
  redaction: myRedactionConfig,
});
```

## Protection against logging loops

QueryGuard uses a re-entrancy guard (`_isCapturing`) to prevent recursive logging.
If the ingestion endpoint fails, the failure is **not** logged back to QueryGuard — it is silently dropped. This prevents cascading log floods.

## Circuit breaker

If the ingestion endpoint fails 5 consecutive times, the `BatchQueue` opens a circuit breaker and stops enqueuing events. This protects against:

- Flooding an unhealthy endpoint
- Degrading app performance during outage
- Generating unbounded memory growth

## Breadcrumb limits

Breadcrumbs are capped at 30 entries (configurable via `maxBreadcrumbs`). When the buffer is full, the oldest entry is dropped. This prevents unbounded memory growth on long-lived sessions.

## SSR safety

All browser API access is guarded behind `typeof window !== "undefined"` checks.
The SDK is safe to import and use in server-side contexts — browser-only code paths are skipped automatically.

## Event size limits

- `message`: truncated at 2000 chars at ingestion
- `stack`: truncated at 5000 chars at ingestion
- `metadata` values: truncated at 500 chars (configurable)
- Breadcrumbs: max 30 entries, each message capped at 150 chars
- Batch size: max 100 events per POST to `/api/ingest`

## PII policy

QueryGuard is designed to **not** capture PII by default:

- URLs have query parameters stripped (which often contain tokens or user IDs)
- User context (`user.id`, `user.role`) is optional and opt-in
- No email addresses are captured in the default configuration
- No full request/response bodies are captured by default
- IP addresses are not captured by the SDK (they may appear in server logs separately)
