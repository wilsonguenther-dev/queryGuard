/**
 * QueryGuard Demo — Instrumented Supabase Client
 *
 * The only change from a standard Supabase client:
 * add { global: { fetch: createGuardedFetch() } }
 */
import { createBrowserClient } from "@supabase/ssr";
import { createGuardedFetch } from "queryguard/supabase";

// Create the guarded fetch wrapper once
const guardedFetch = createGuardedFetch({
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
});

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: guardedFetch }, // <-- this is the entire integration
    }
  );
}
