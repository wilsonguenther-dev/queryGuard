-- ═══════════════════════════════════════════════════════════════
-- QueryGuard Schema — Full Observability Engine for Supabase
-- Run this migration in your Supabase project via the SQL editor
-- or the Supabase CLI: supabase db push
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Raw error log (every individual error event) ──────────
CREATE TABLE IF NOT EXISTS public.client_error_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  error_message text NOT NULL,
  error_stack text,
  component_name text,
  page_url text,
  user_agent text,
  metadata jsonb DEFAULT '{}',
  severity text NOT NULL DEFAULT 'error' CHECK (severity IN ('fatal', 'error', 'warn', 'info')),
  fingerprint text,
  impact_score numeric DEFAULT 0,
  deploy_version text,
  session_id text,
  error_type text DEFAULT 'client_error' CHECK (error_type IN (
    'client_error', 'silent_query_failure', 'rpc_failure',
    'edge_function_failure', 'auth_failure', 'slow_query',
    'empty_result', 'canary', 'server_error'
  )),
  duration_ms integer,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_client_error_log_created_at ON client_error_log (created_at DESC);
CREATE INDEX idx_client_error_log_fingerprint ON client_error_log (fingerprint);
CREATE INDEX idx_client_error_log_severity ON client_error_log (severity);
CREATE INDEX idx_client_error_log_error_type ON client_error_log (error_type);
CREATE INDEX idx_client_error_log_user_id ON client_error_log (user_id) WHERE user_id IS NOT NULL;

ALTER TABLE public.client_error_log ENABLE ROW LEVEL SECURITY;

-- Admins can read all logs
CREATE POLICY "admin_read_error_log" ON client_error_log FOR SELECT TO authenticated
  USING ((SELECT role FROM public.user_profiles WHERE auth_id = auth.uid() LIMIT 1) IN ('super_admin', 'org_admin', 'manager', 'admin'));

-- Anyone (including anon) can insert (errors come from unauthenticated users too)
CREATE POLICY "anyone_insert_error_log" ON client_error_log FOR INSERT WITH CHECK (true);

-- Admin delete
CREATE POLICY "admin_delete_error_log" ON client_error_log FOR DELETE TO authenticated
  USING ((SELECT role FROM public.user_profiles WHERE auth_id = auth.uid() LIMIT 1) IN ('super_admin', 'admin'));

GRANT SELECT, INSERT, DELETE ON public.client_error_log TO authenticated;
GRANT INSERT ON public.client_error_log TO anon;
GRANT ALL ON public.client_error_log TO service_role;


-- ── 2. Grouped issues (one per unique fingerprint) ────────────
CREATE TABLE IF NOT EXISTS public.error_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL UNIQUE,
  title text NOT NULL,
  error_type text NOT NULL DEFAULT 'client_error',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'regressed', 'ignored', 'auto_resolved')),
  severity text NOT NULL DEFAULT 'error' CHECK (severity IN ('fatal', 'error', 'warn', 'info')),
  impact_score numeric DEFAULT 0,
  occurrence_count integer DEFAULT 1,
  affected_users integer DEFAULT 0,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  last_page_url text,
  last_metadata jsonb DEFAULT '{}',
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  tags text[] DEFAULT '{}',
  environment text DEFAULT 'production',
  muted_until timestamptz,
  regression_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_error_issues_fingerprint ON error_issues (fingerprint);
CREATE INDEX idx_error_issues_status ON error_issues (status);
CREATE INDEX idx_error_issues_severity ON error_issues (severity);
CREATE INDEX idx_error_issues_last_seen ON error_issues (last_seen DESC);
CREATE INDEX idx_error_issues_impact_score ON error_issues (impact_score DESC);

ALTER TABLE public.error_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_error_issues" ON error_issues FOR ALL TO authenticated
  USING ((SELECT role FROM public.user_profiles WHERE auth_id = auth.uid() LIMIT 1) IN ('super_admin', 'org_admin', 'manager', 'admin'))
  WITH CHECK ((SELECT role FROM public.user_profiles WHERE auth_id = auth.uid() LIMIT 1) IN ('super_admin', 'org_admin', 'manager', 'admin'));

-- Server/anon can upsert issues (triggered from error-log API)
CREATE POLICY "service_upsert_issues" ON error_issues FOR INSERT WITH CHECK (true);
CREATE POLICY "service_update_issues" ON error_issues FOR UPDATE USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.error_issues TO authenticated;
GRANT INSERT, UPDATE ON public.error_issues TO anon;
GRANT ALL ON public.error_issues TO service_role;


-- ── 3. Error budget (daily burn rate tracking) ────────────────
CREATE TABLE IF NOT EXISTS public.queryguard_error_budget (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL UNIQUE DEFAULT CURRENT_DATE,
  budget_limit integer NOT NULL DEFAULT 50,
  error_count integer NOT NULL DEFAULT 0,
  query_failure_count integer NOT NULL DEFAULT 0,
  burn_rate numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.queryguard_error_budget ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_read_budget" ON queryguard_error_budget FOR SELECT TO authenticated
  USING ((SELECT role FROM public.user_profiles WHERE auth_id = auth.uid() LIMIT 1) IN ('super_admin', 'org_admin', 'manager', 'admin'));
CREATE POLICY "service_upsert_budget" ON queryguard_error_budget FOR ALL WITH CHECK (true);

GRANT SELECT ON public.queryguard_error_budget TO authenticated;
GRANT ALL ON public.queryguard_error_budget TO service_role;


-- ── 4. Alert configuration (webhooks, Slack, Discord) ─────────
CREATE TABLE IF NOT EXISTS public.queryguard_alert_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  alert_type text NOT NULL CHECK (alert_type IN ('webhook', 'slack', 'discord', 'email', 'system_alert')),
  target_url text,
  min_severity text NOT NULL DEFAULT 'error' CHECK (min_severity IN ('fatal', 'error', 'warn', 'info')),
  throttle_minutes integer NOT NULL DEFAULT 60,
  enabled boolean NOT NULL DEFAULT true,
  last_fired_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.queryguard_alert_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all_alert_config" ON queryguard_alert_config FOR ALL TO authenticated
  USING ((SELECT role FROM public.user_profiles WHERE auth_id = auth.uid() LIMIT 1) IN ('super_admin', 'admin'))
  WITH CHECK ((SELECT role FROM public.user_profiles WHERE auth_id = auth.uid() LIMIT 1) IN ('super_admin', 'admin'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.queryguard_alert_config TO authenticated;
GRANT ALL ON public.queryguard_alert_config TO service_role;


-- ── 5. Issue notes (comments/investigation log) ───────────────
CREATE TABLE IF NOT EXISTS public.queryguard_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL REFERENCES public.error_issues(id) ON DELETE CASCADE,
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_queryguard_notes_issue_id ON queryguard_notes (issue_id);

ALTER TABLE public.queryguard_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all_notes" ON queryguard_notes FOR ALL TO authenticated
  USING ((SELECT role FROM public.user_profiles WHERE auth_id = auth.uid() LIMIT 1) IN ('super_admin', 'org_admin', 'manager', 'admin'))
  WITH CHECK ((SELECT role FROM public.user_profiles WHERE auth_id = auth.uid() LIMIT 1) IN ('super_admin', 'org_admin', 'manager', 'admin'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.queryguard_notes TO authenticated;
GRANT ALL ON public.queryguard_notes TO service_role;


-- ── 6. SLA configuration ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.queryguard_sla (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity text NOT NULL UNIQUE CHECK (severity IN ('fatal', 'error', 'warn', 'info')),
  max_response_minutes integer NOT NULL DEFAULT 60,
  max_resolve_minutes integer NOT NULL DEFAULT 480,
  created_at timestamptz DEFAULT now()
);

INSERT INTO public.queryguard_sla (severity, max_response_minutes, max_resolve_minutes)
VALUES
  ('fatal', 15, 60),
  ('error', 60, 480),
  ('warn', 240, 1440),
  ('info', 1440, 10080)
ON CONFLICT (severity) DO NOTHING;

ALTER TABLE public.queryguard_sla ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_read_sla" ON queryguard_sla FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_write_sla" ON queryguard_sla FOR ALL TO authenticated
  WITH CHECK ((SELECT role FROM public.user_profiles WHERE auth_id = auth.uid() LIMIT 1) IN ('super_admin', 'admin'));

GRANT SELECT ON public.queryguard_sla TO authenticated;
GRANT ALL ON public.queryguard_sla TO service_role;


-- ── 7. Daily snapshots (for trend analysis) ───────────────────
CREATE TABLE IF NOT EXISTS public.queryguard_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL UNIQUE DEFAULT CURRENT_DATE,
  open_count integer DEFAULT 0,
  resolved_count integer DEFAULT 0,
  regressed_count integer DEFAULT 0,
  total_occurrences integer DEFAULT 0,
  affected_users_count integer DEFAULT 0,
  avg_impact_score numeric DEFAULT 0,
  top_error_type text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.queryguard_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_read_snapshots" ON queryguard_snapshots FOR SELECT TO authenticated
  USING ((SELECT role FROM public.user_profiles WHERE auth_id = auth.uid() LIMIT 1) IN ('super_admin', 'org_admin', 'manager', 'admin'));
CREATE POLICY "service_insert_snapshots" ON queryguard_snapshots FOR INSERT WITH CHECK (true);

GRANT SELECT ON public.queryguard_snapshots TO authenticated;
GRANT ALL ON public.queryguard_snapshots TO service_role;


-- ── 8. Schema manifest (drift detection) ─────────────────────
CREATE TABLE IF NOT EXISTS public.queryguard_schema_manifest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  column_name text NOT NULL,
  data_type text,
  snapshot_at timestamptz DEFAULT now(),
  UNIQUE(table_name, column_name)
);

ALTER TABLE public.queryguard_schema_manifest ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_read_manifest" ON queryguard_schema_manifest FOR SELECT TO authenticated
  USING ((SELECT role FROM public.user_profiles WHERE auth_id = auth.uid() LIMIT 1) IN ('super_admin', 'admin'));
CREATE POLICY "service_upsert_manifest" ON queryguard_schema_manifest FOR ALL WITH CHECK (true);

GRANT SELECT ON public.queryguard_schema_manifest TO authenticated;
GRANT ALL ON public.queryguard_schema_manifest TO service_role;


-- ── 9. RPC: Spike detection ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.queryguard_check_spike()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  now_count integer;
  prev_count integer;
  ratio numeric;
BEGIN
  SELECT count(*) INTO now_count
  FROM client_error_log
  WHERE created_at > now() - interval '15 minutes'
    AND error_type != 'canary';

  SELECT count(*) INTO prev_count
  FROM client_error_log
  WHERE created_at BETWEEN now() - interval '30 minutes' AND now() - interval '15 minutes'
    AND error_type != 'canary';

  IF prev_count = 0 THEN
    ratio := 0;
  ELSE
    ratio := round((now_count::numeric / prev_count::numeric)::numeric, 2);
  END IF;

  RETURN jsonb_build_object(
    'now_count', now_count,
    'prev_count', prev_count,
    'spike_ratio', ratio,
    'is_spike', ratio > 2 AND now_count > 5
  );
END;
$$;


-- ── 10. RPC: Auto-cleanup old resolved errors ─────────────────
CREATE OR REPLACE FUNCTION public.queryguard_cleanup_old_errors()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  deleted_logs integer;
  deleted_issues integer;
BEGIN
  -- Delete raw logs older than 30 days
  DELETE FROM client_error_log
  WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS deleted_logs = ROW_COUNT;

  -- Auto-resolve issues with no occurrence in 14 days
  UPDATE error_issues
  SET status = 'auto_resolved', resolved_at = now()
  WHERE status = 'open'
    AND last_seen < now() - interval '14 days';
  GET DIAGNOSTICS deleted_issues = ROW_COUNT;

  RETURN format('Deleted %s logs, auto-resolved %s issues', deleted_logs, deleted_issues);
END;
$$;


-- ── NOTE on user_profiles ─────────────────────────────────────
-- QueryGuard's RLS policies reference public.user_profiles.role
-- Your app must have a user_profiles table with a `role` column
-- and an `auth_id` column linking to auth.users.id.
-- 
-- If your app uses a different auth/role system, update the
-- USING clauses in each policy above to match your schema.
-- ─────────────────────────────────────────────────────────────
