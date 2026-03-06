# QueryGuard — Next.js + Supabase Demo

This example shows the minimal setup to instrument a Next.js + Supabase app with QueryGuard.

## What it demonstrates

- Installing the `queryguard` SDK
- Wrapping the Supabase browser client with `createGuardedFetch`
- Mounting `<ErrorLogger />` in the root layout for global error capture
- Triggering a sample logged failure (RLS 403 simulation)
- Viewing the issue in the QueryGuard dashboard

## Setup

```bash
cd examples/nextjs-supabase-demo
npm install
cp .env.example .env.local
# Fill in your Supabase URL, anon key, and QueryGuard endpoint
npm run dev
```

## Environment variables

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
NEXT_PUBLIC_QUERYGUARD_ENDPOINT=http://localhost:3001/api/ingest
```

## How it works

1. `initQueryGuard()` is called once in `app/providers.tsx` (client component)
2. The Supabase client uses `createGuardedFetch()` as its `global.fetch`
3. `<ErrorLogger />` is mounted in `app/layout.tsx` to capture global JS errors
4. Any Supabase query failure, RLS 403, or slow query is automatically batched and sent to `/api/ingest`
5. Open the QueryGuard dashboard at `http://localhost:3001/dashboard` to see the issues
