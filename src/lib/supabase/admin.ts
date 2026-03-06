import { createClient } from "@supabase/supabase-js";

/**
 * Admin / service-role Supabase client.
 * Bypasses RLS — only use in API routes and server-side ingestion.
 * Never expose SUPABASE_SERVICE_ROLE_KEY to the browser.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("[QueryGuard] Missing SUPABASE_SERVICE_ROLE_KEY for admin client");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
