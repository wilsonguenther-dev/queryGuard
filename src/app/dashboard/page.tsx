"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  AlertTriangle, Bug, RefreshCw, Loader2, ExternalLink, Trash2,
  Clock, Globe, User, Monitor, ChevronDown, ChevronRight,
  AlertCircle, Info, Flame, Search, X, Database, Zap,
  Activity, Table2, TrendingUp, Shield, Bell, Gauge,
  CheckCircle2, RotateCcw, EyeOff, Timer, Users,
  Fingerprint, Heart, Sparkles, BarChart3,
  MousePointerClick, Navigation, Terminal, ArrowRight,
  Download, Copy, Tag, MessageSquare, UserCheck, BellOff,
  ArrowUpDown, ListFilter, LayoutList, LayoutGrid,
  Target, Hourglass, PieChart, Hash, StickyNote,
  CircleDot, GitBranch, Layers, CalendarClock,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface ErrorEntry {
  id: string; user_id: string | null; error_message: string; error_stack: string | null;
  component_name: string | null; page_url: string | null; user_agent: string | null;
  metadata: Record<string, unknown>; severity: string; created_at: string;
  fingerprint?: string; impact_score?: number; deploy_version?: string;
  session_id?: string; error_type?: string; duration_ms?: number;
}

interface ErrorIssue {
  id: string; fingerprint: string; title: string; error_type: string; status: string;
  severity: string; impact_score: number; occurrence_count: number; affected_users: number;
  first_seen: string; last_seen: string; resolved_at: string | null;
  last_page_url: string | null; last_metadata: Record<string, unknown>;
  assigned_to?: string | null; tags?: string[]; environment?: string;
  muted_until?: string | null; regression_count?: number;
}

interface IssueNote { id: string; issue_id: string; author_id: string; content: string; created_at: string; }
interface SLAConfig { severity: string; max_response_minutes: number; max_resolve_minutes: number; }
interface Snapshot { snapshot_date: string; open_count: number; resolved_count: number; regressed_count: number; total_occurrences: number; affected_users_count: number; avg_impact_score: number; top_error_type: string | null; }

type SortField = "last_seen" | "impact_score" | "occurrence_count" | "affected_users" | "first_seen";
type ViewMode = "list" | "compact";

interface TrendPoint { hour: string; total: number; fatal: number; error: number; warn: number; query: number; }
interface BudgetEntry { date: string; budget_limit: number; error_count: number; query_failure_count: number; burn_rate: number; }

const SEV: Record<string, { icon: typeof Flame; label: string; color: string; bg: string }> = {
  fatal: { icon: Flame, label: "Fatal", color: "text-red-600", bg: "bg-red-500/10 border-red-500/30" },
  error: { icon: AlertTriangle, label: "Error", color: "text-red-500", bg: "bg-red-500/10 border-red-500/20" },
  warn: { icon: AlertCircle, label: "Warning", color: "text-amber-500", bg: "bg-amber-500/10 border-amber-500/20" },
  info: { icon: Info, label: "Info", color: "text-blue-500", bg: "bg-blue-500/10 border-blue-500/20" },
};

const STATUS: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  open: { label: "Open", color: "text-red-500 bg-red-500/10 border-red-500/20", icon: AlertCircle },
  resolved: { label: "Resolved", color: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20", icon: CheckCircle2 },
  regressed: { label: "Regressed", color: "text-purple-500 bg-purple-500/10 border-purple-500/20", icon: RotateCcw },
  ignored: { label: "Ignored", color: "text-zinc-500 bg-zinc-500/10 border-zinc-500/20", icon: EyeOff },
  auto_resolved: { label: "Auto-Resolved", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", icon: Sparkles },
};

const ETYPE: Record<string, { label: string; color: string; icon: typeof Database }> = {
  silent_query_failure: { label: "Query", color: "text-orange-500", icon: Database },
  rpc_failure: { label: "RPC", color: "text-purple-500", icon: Terminal },
  edge_function_failure: { label: "Edge Fn", color: "text-cyan-500", icon: Zap },
  auth_failure: { label: "Auth", color: "text-red-500", icon: Shield },
  slow_query: { label: "Slow", color: "text-amber-500", icon: Timer },
  empty_result: { label: "Empty", color: "text-yellow-500", icon: AlertCircle },
  client_error: { label: "Client", color: "text-zinc-400", icon: Monitor },
  canary: { label: "Canary", color: "text-emerald-500", icon: Heart },
};

const HTTP_COLORS: Record<number, string> = {
  400: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  403: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  404: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  500: "bg-red-500/10 text-red-600 border-red-500/20",
};

const CRUMB_ICONS: Record<string, typeof Navigation> = {
  navigation: Navigation, click: MousePointerClick, fetch: ArrowRight,
  console: Terminal, custom: Sparkles,
};

function pagePath(url: string | null): string {
  if (!url) return "—";
  try { return new URL(url).pathname; } catch { return url; }
}

function ago(date: string): string {
  const d = Date.now() - new Date(date).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function TrendChart({ data }: { data: TrendPoint[] }) {
  if (!data.length) return <p className="text-[10px] text-muted-foreground p-4">No data</p>;
  const max = Math.max(...data.map(d => d.total), 1);
  const w = 800, h = 100;
  const pts = data.map((d, i) => ({ x: (i / Math.max(data.length - 1, 1)) * w, y: h - (d.total / max) * (h - 8) - 4, ...d }));
  const line = pts.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[100px]" preserveAspectRatio="none">
        <defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ef4444" stopOpacity="0.25" /><stop offset="100%" stopColor="#ef4444" stopOpacity="0" /></linearGradient></defs>
        <path d={`${line} L ${w} ${h} L 0 ${h} Z`} fill="url(#tg)" />
        <path d={line} fill="none" stroke="#ef4444" strokeWidth="2" />
        {pts.filter(p => p.total > 0).map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="#ef4444" opacity="0.7"><title>{p.hour.slice(5, 13)}: {p.total}</title></circle>)}
      </svg>
      <div className="flex justify-between text-[8px] text-muted-foreground px-1">
        <span>{data[0]?.hour?.slice(5, 10)}</span>
        <span>{data[data.length - 1]?.hour?.slice(5, 10)}</span>
      </div>
    </div>
  );
}

function BudgetGauge({ budget }: { budget: BudgetEntry | null }) {
  if (!budget) return <p className="text-[10px] text-muted-foreground">No budget data</p>;
  const pct = Math.min((budget.burn_rate || 0) * 100, 100);
  const color = pct < 50 ? "#10b981" : pct < 80 ? "#f59e0b" : "#ef4444";
  const r = 32, circ = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-3">
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} fill="none" stroke="currentColor" strokeWidth="5" className="text-muted/20" />
        <circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="5" strokeDasharray={circ} strokeDashoffset={circ - (pct / 100) * circ} strokeLinecap="round" transform="rotate(-90 36 36)" />
        <text x="36" y="34" textAnchor="middle" fill={color} className="text-xs font-bold">{Math.round(pct)}%</text>
        <text x="36" y="46" textAnchor="middle" fill="currentColor" className="text-[7px] text-muted-foreground">burned</text>
      </svg>
      <div>
        <p className="text-xs font-medium">{budget.error_count}/{budget.budget_limit} today</p>
        <p className="text-[10px] text-muted-foreground">{budget.query_failure_count} query failures</p>
      </div>
    </div>
  );
}

export default function AdminErrorsPage() {
  const [tab, setTab] = useState<"issues" | "logs" | "health" | "analytics" | "config">("issues");
  const [issues, setIssues] = useState<ErrorIssue[]>([]);
  const [errors, setErrors] = useState<ErrorEntry[]>([]);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [budget, setBudget] = useState<BudgetEntry | null>(null);
  const [spike, setSpike] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sevF, setSevF] = useState("all");
  const [statusF, setStatusF] = useState("all");
  const [typeF, setTypeF] = useState("all");
  const [q, setQ] = useState("");
  const [profiles, setProfiles] = useState<Record<string, string>>({});

  // v3 state
  const [sortBy, setSortBy] = useState<SortField>("last_seen");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, IssueNote[]>>({});
  const [newNote, setNewNote] = useState("");
  const [slaConfigs, setSlaConfigs] = useState<SLAConfig[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [pageFilter, setPageFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, b, c, d, e] = await Promise.all([
        fetch("/api/error-log?view=issues&limit=200"),
        fetch("/api/error-log?view=logs&limit=200"),
        fetch("/api/error-log?view=trend"),
        fetch("/api/error-log?view=budget"),
        fetch("/api/error-log?view=spike"),
      ]);
      if (a.ok) setIssues((await a.json()).issues || []);
      if (b.ok) {
        const data = (await b.json()).errors || [];
        setErrors(data);
        const uids = [...new Set(data.map((x: any) => x.user_id).filter(Boolean))];
        if (uids.length) {
          const sb = createClient();
          const { data: p } = await sb.from("user_profiles").select("id,display_name,email").in("id", uids);
          if (p) { const m: Record<string, string> = {}; p.forEach((x: any) => { m[x.id] = x.display_name || x.email || x.id.slice(0, 8); }); setProfiles(m); }
        }
      }
      if (c.ok) setTrend((await c.json()).trend || []);
      if (d.ok) setBudget((await d.json()).budget?.[0] || null);
      if (e.ok) setSpike((await e.json()).spike || null);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); loadV3(); }, [load]);

  async function loadV3() {
    const sb = createClient();
    const [slaRes, snapRes] = await Promise.all([
      sb.from("queryguard_sla").select("*").order("max_response_minutes"),
      sb.from("queryguard_snapshots").select("*").order("snapshot_date", { ascending: false }).limit(30),
    ]);
    if (slaRes.data) setSlaConfigs(slaRes.data);
    if (snapRes.data) setSnapshots(snapRes.data);
  }

  async function loadNotes(issueId: string) {
    const sb = createClient();
    const { data } = await sb.from("queryguard_notes").select("*").eq("issue_id", issueId).order("created_at", { ascending: true });
    setNotes(prev => ({ ...prev, [issueId]: data || [] }));
  }

  async function addNote(issueId: string) {
    if (!newNote.trim()) return;
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    await sb.from("queryguard_notes").insert({ issue_id: issueId, author_id: user?.id, content: newNote.trim() });
    setNewNote("");
    loadNotes(issueId);
  }

  async function bulkAction(action: string) {
    if (!selected.size) return;
    const ids = [...selected];
    for (const id of ids) await updateStatusDirect(id, action);
    setSelected(new Set());
    load();
  }

  async function addTag(issueId: string, tag: string) {
    if (!tag.trim()) return;
    const sb = createClient();
    const issue = issues.find(i => i.id === issueId);
    const tags = [...(issue?.tags || []), tag.trim().toLowerCase()];
    await sb.from("error_issues").update({ tags }).eq("id", issueId);
    setIssues(prev => prev.map(i => i.id === issueId ? { ...i, tags } : i));
    setTagInput("");
  }

  async function removeTag(issueId: string, tag: string) {
    const sb = createClient();
    const issue = issues.find(i => i.id === issueId);
    const tags = (issue?.tags || []).filter(t => t !== tag);
    await sb.from("error_issues").update({ tags }).eq("id", issueId);
    setIssues(prev => prev.map(i => i.id === issueId ? { ...i, tags } : i));
  }

  async function muteIssue(issueId: string, hours: number) {
    const sb = createClient();
    const until = new Date(Date.now() + hours * 3600000).toISOString();
    await sb.from("error_issues").update({ muted_until: until }).eq("id", issueId);
    setIssues(prev => prev.map(i => i.id === issueId ? { ...i, muted_until: until } : i));
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function selectAll() {
    if (selected.size === fIssues.length) setSelected(new Set());
    else setSelected(new Set(fIssues.map(i => i.id)));
  }

  function exportCSV() {
    const rows = [["Title", "Type", "Severity", "Status", "Occurrences", "Users", "Impact", "First Seen", "Last Seen", "Page"]];
    for (const i of fIssues) rows.push([i.title, i.error_type, i.severity, i.status, String(i.occurrence_count), String(i.affected_users), String(i.impact_score), i.first_seen, i.last_seen, i.last_page_url || ""]);
    const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `queryguard-issues-${new Date().toISOString().split("T")[0]}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function copyIssue(issue: ErrorIssue) {
    const text = `[${issue.severity.toUpperCase()}] ${issue.title}\nType: ${issue.error_type}\nOccurrences: ${issue.occurrence_count} | Users: ${issue.affected_users}\nPage: ${issue.last_page_url || "—"}\nFirst: ${new Date(issue.first_seen).toLocaleString()}\nLast: ${new Date(issue.last_seen).toLocaleString()}`;
    navigator.clipboard.writeText(text);
  }

  function getSlaStatus(issue: ErrorIssue): { label: string; color: string; breached: boolean } {
    const sla = slaConfigs.find(s => s.severity === issue.severity);
    if (!sla) return { label: "No SLA", color: "text-zinc-400", breached: false };
    const openMinutes = (Date.now() - new Date(issue.first_seen).getTime()) / 60000;
    if (issue.status === "resolved" || issue.status === "auto_resolved") {
      const resolveTime = issue.resolved_at ? (new Date(issue.resolved_at).getTime() - new Date(issue.first_seen).getTime()) / 60000 : 0;
      return resolveTime <= sla.max_resolve_minutes
        ? { label: `${Math.round(resolveTime)}m`, color: "text-emerald-500", breached: false }
        : { label: `${Math.round(resolveTime)}m (SLA breached)`, color: "text-red-500", breached: true };
    }
    if (openMinutes > sla.max_resolve_minutes) return { label: `${Math.round(openMinutes)}m (BREACHED)`, color: "text-red-500", breached: true };
    if (openMinutes > sla.max_response_minutes) return { label: `${Math.round(openMinutes)}m (respond!)`, color: "text-amber-500", breached: false };
    return { label: `${Math.round(openMinutes)}m`, color: "text-emerald-500", breached: false };
  }

  const mttr = useMemo(() => {
    const resolved = issues.filter(i => i.resolved_at && i.first_seen);
    if (!resolved.length) return null;
    const total = resolved.reduce((s, i) => s + (new Date(i.resolved_at!).getTime() - new Date(i.first_seen).getTime()), 0);
    const avg = total / resolved.length / 60000;
    return avg < 60 ? `${Math.round(avg)}m` : avg < 1440 ? `${(avg / 60).toFixed(1)}h` : `${(avg / 1440).toFixed(1)}d`;
  }, [issues]);

  const pageStats = useMemo(() => {
    const m: Record<string, { count: number; impact: number }> = {};
    issues.forEach(i => {
      const p = pagePath(i.last_page_url);
      if (!m[p]) m[p] = { count: 0, impact: 0 };
      m[p].count += i.occurrence_count;
      m[p].impact += i.impact_score;
    });
    return Object.entries(m).map(([page, d]) => ({ page, ...d })).sort((a, b) => b.count - a.count).slice(0, 15);
  }, [issues]);

  const uniquePages = useMemo(() => [...new Set(issues.map(i => pagePath(i.last_page_url)).filter(p => p !== "—"))], [issues]);

  const slaBreaches = useMemo(() => issues.filter(i => i.status === "open" && getSlaStatus(i).breached).length, [issues, slaConfigs]);

  const updateStatusDirect = async (id: string, s: string) => {
    await fetch("/api/error-log", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update_status", issue_id: id, status: s }) });
  };

  const updateStatus = async (id: string, s: string) => {
    await fetch("/api/error-log", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update_status", issue_id: id, status: s }) });
    setIssues(prev => prev.map(i => i.id === id ? { ...i, status: s, resolved_at: s === "resolved" ? new Date().toISOString() : i.resolved_at } : i));
  };

  const cleanup = async () => {
    if (!confirm("Run cleanup? Deletes old resolved errors.")) return;
    await fetch("/api/error-log", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cleanup" }) });
    load();
  };

  const clearAll = async () => {
    if (!confirm("Delete ALL logs?")) return;
    const sb = createClient();
    await sb.from("client_error_log").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    setErrors([]);
  };

  const delOne = async (id: string) => {
    const sb = createClient();
    await sb.from("client_error_log").delete().eq("id", id);
    setErrors(prev => prev.filter(e => e.id !== id));
  };

  const fIssues = useMemo(() => {
    const filtered = issues.filter(i => {
      if (statusF !== "all" && i.status !== statusF) return false;
      if (sevF !== "all" && i.severity !== sevF) return false;
      if (typeF !== "all" && i.error_type !== typeF) return false;
      if (pageFilter !== "all" && pagePath(i.last_page_url) !== pageFilter) return false;
      if (q) { const s = q.toLowerCase(); return i.title.toLowerCase().includes(s) || (i.last_page_url || "").toLowerCase().includes(s) || (i.tags || []).some(t => t.includes(s)); }
      return true;
    });
    return filtered.sort((a, b) => {
      switch (sortBy) {
        case "impact_score": return b.impact_score - a.impact_score;
        case "occurrence_count": return b.occurrence_count - a.occurrence_count;
        case "affected_users": return b.affected_users - a.affected_users;
        case "first_seen": return new Date(b.first_seen).getTime() - new Date(a.first_seen).getTime();
        default: return new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime();
      }
    });
  }, [issues, statusF, sevF, typeF, q, sortBy, pageFilter]);

  const fLogs = useMemo(() => errors.filter(e => {
    if (sevF !== "all" && e.severity !== sevF) return false;
    if (typeF !== "all" && (e.error_type || "client_error") !== typeF) return false;
    if (q) { const s = q.toLowerCase(); return e.error_message.toLowerCase().includes(s) || (e.page_url || "").toLowerCase().includes(s); }
    return true;
  }), [errors, sevF, typeF, q]);

  const stats = useMemo(() => ({
    open: issues.filter(i => i.status === "open").length,
    regressed: issues.filter(i => i.status === "regressed").length,
    occ: issues.reduce((s, i) => s + (i.occurrence_count || 0), 0),
    logs: errors.length,
    day: errors.filter(e => Date.now() - new Date(e.created_at).getTime() < 86400000).length,
    canary: errors.find(e => e.error_type === "canary")?.created_at || null,
  }), [issues, errors]);

  const health = useMemo(() => {
    const m: Record<string, { failures: number; slow: number; last: string }> = {};
    errors.forEach(e => {
      const t = (e.metadata as any)?.table; if (!t) return;
      if (!m[t]) m[t] = { failures: 0, slow: 0, last: "" };
      if (e.error_type === "slow_query") m[t].slow++; else m[t].failures++;
      if (!m[t].last || e.created_at > m[t].last) m[t].last = e.created_at;
    });
    return Object.entries(m).map(([t, d]) => ({ table: t, ...d })).sort((a, b) => b.failures - a.failures);
  }, [errors]);

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bug className="h-6 w-6 text-red-500" /> QueryGuard v3
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-500"><Zap className="h-3 w-3" /> Active</span>
            {spike?.is_spike && <span className="flex items-center gap-1 rounded-full bg-red-500/10 border border-red-500/20 px-2 py-0.5 text-[10px] font-medium text-red-500 animate-pulse"><TrendingUp className="h-3 w-3" /> SPIKE {spike.spike_ratio}×</span>}
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">Silent failures, slow queries, edge functions, auth, regressions, impact scoring</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={cleanup} className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[10px] text-muted-foreground hover:bg-muted"><Sparkles className="h-3 w-3" /> Cleanup</button>
          <button onClick={load} className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[10px] text-muted-foreground hover:bg-muted"><RefreshCw className="h-3 w-3" /> Refresh</button>
          <button onClick={clearAll} className="flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/5 px-2.5 py-1.5 text-[10px] text-red-500 hover:bg-red-500/10"><Trash2 className="h-3 w-3" /> Clear</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 md:grid-cols-9">
        {([
          ["Open", stats.open, "text-red-500", AlertCircle],
          ["Regressed", stats.regressed, "text-purple-500", RotateCcw],
          ["Occurrences", stats.occ, "text-orange-500", BarChart3],
          ["Logs", stats.logs, "text-foreground", Bug],
          ["24h", stats.day, "text-amber-500", Clock],
          ["MTTR", mttr || "—", "text-cyan-500", Hourglass],
          ["SLA ⚠", slaBreaches, slaBreaches > 0 ? "text-red-500" : "text-emerald-500", Target],
          ["Budget", budget ? `${Math.round((budget.burn_rate || 0) * 100)}%` : "—", budget && budget.burn_rate > 0.8 ? "text-red-500" : "text-emerald-500", Gauge],
          ["Canary", stats.canary ? ago(stats.canary) : "None", stats.canary ? "text-emerald-500" : "text-red-500", Heart],
        ] as [string, string | number, string, any][]).map(([label, value, color, Icon]) => (
          <div key={label} className="rounded-xl border border-border bg-card p-2.5">
            <div className="flex items-center gap-1.5"><Icon className={`h-3 w-3 ${color}`} /><p className={`text-lg font-bold ${color}`}>{value}</p></div>
            <p className="text-[9px] text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>

      {/* Budget + Trend */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-xs font-bold flex items-center gap-1.5 mb-3"><Gauge className="h-3.5 w-3.5 text-blue-500" /> Error Budget</h3>
          <BudgetGauge budget={budget} />
        </div>
        <div className="md:col-span-2 rounded-xl border border-border bg-card p-4">
          <h3 className="text-xs font-bold flex items-center gap-1.5 mb-2"><TrendingUp className="h-3.5 w-3.5 text-red-500" /> 7-Day Trend</h3>
          <TrendChart data={trend} />
        </div>
      </div>

      {/* Tabs + Filters */}
      <div className="flex items-center gap-2 border-b border-border pb-1 flex-wrap">
        {([["issues", `Issues (${issues.length})`, Fingerprint], ["logs", `Logs (${errors.length})`, Bug], ["health", "Query Health", Activity], ["analytics", "Analytics", PieChart], ["config", "Config", Bell]] as [string, string, any][]).map(([k, l, I]) => (
          <button key={k} onClick={() => setTab(k as any)} className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium border-b-2 -mb-[5px] ${tab === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <I className="h-3.5 w-3.5" />{l}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
          <select value={sevF} onChange={e => setSevF(e.target.value)} className="rounded border border-border bg-background px-2 py-1 text-[10px]">
            <option value="all">Severity</option><option value="fatal">Fatal</option><option value="error">Error</option><option value="warn">Warn</option><option value="info">Info</option>
          </select>
          <select value={typeF} onChange={e => setTypeF(e.target.value)} className="rounded border border-border bg-background px-2 py-1 text-[10px]">
            <option value="all">Type</option><option value="silent_query_failure">Query</option><option value="rpc_failure">RPC</option><option value="edge_function_failure">Edge Fn</option><option value="slow_query">Slow</option><option value="empty_result">Empty</option><option value="client_error">Client</option>
          </select>
          {tab === "issues" && <>
            <select value={statusF} onChange={e => setStatusF(e.target.value)} className="rounded border border-border bg-background px-2 py-1 text-[10px]">
              <option value="all">Status</option><option value="open">Open</option><option value="regressed">Regressed</option><option value="resolved">Resolved</option><option value="ignored">Ignored</option>
            </select>
            <select value={pageFilter} onChange={e => setPageFilter(e.target.value)} className="rounded border border-border bg-background px-2 py-1 text-[10px] max-w-[120px]">
              <option value="all">All Pages</option>
              {uniquePages.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={sortBy} onChange={e => setSortBy(e.target.value as SortField)} className="rounded border border-border bg-background px-2 py-1 text-[10px]">
              <option value="last_seen">Recent</option><option value="impact_score">Impact</option><option value="occurrence_count">Frequency</option><option value="affected_users">Users</option><option value="first_seen">Oldest</option>
            </select>
            <button onClick={() => setViewMode(viewMode === "list" ? "compact" : "list")} className="rounded border border-border bg-background px-1.5 py-1 text-muted-foreground hover:text-foreground" title={viewMode === "list" ? "Compact view" : "List view"}>
              {viewMode === "list" ? <LayoutGrid className="h-3 w-3" /> : <LayoutList className="h-3 w-3" />}
            </button>
            <button onClick={exportCSV} className="rounded border border-border bg-background px-1.5 py-1 text-muted-foreground hover:text-foreground" title="Export CSV">
              <Download className="h-3 w-3" />
            </button>
          </>}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search..." className="rounded border border-border bg-background pl-6 pr-5 py-1 text-[10px] w-36 focus:border-primary focus:outline-none" />
            {q && <button onClick={() => setQ("")} className="absolute right-1.5 top-1/2 -translate-y-1/2"><X className="h-2.5 w-2.5 text-muted-foreground" /></button>}
          </div>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {tab === "issues" && selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2">
          <span className="text-xs font-medium">{selected.size} selected</span>
          <button onClick={() => bulkAction("resolved")} className="flex items-center gap-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-[10px] font-medium text-emerald-500 hover:bg-emerald-500/20"><CheckCircle2 className="h-3 w-3" /> Resolve All</button>
          <button onClick={() => bulkAction("ignored")} className="flex items-center gap-1 rounded-lg bg-zinc-500/10 border border-zinc-500/20 px-2.5 py-1 text-[10px] font-medium text-zinc-400 hover:bg-zinc-500/20"><EyeOff className="h-3 w-3" /> Ignore All</button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-[10px] text-muted-foreground hover:text-foreground">Clear</button>
        </div>
      )}

      {/* ═══ ISSUES TAB ═══ */}
      {tab === "issues" && (
        <div className="space-y-2">
          {!fIssues.length ? (
            <div className="rounded-xl border border-border bg-card p-12 text-center">
              <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-500/30" />
              <p className="text-sm text-muted-foreground">No matching issues</p>
            </div>
          ) : <>
          {/* Select All */}
          <div className="flex items-center gap-2 px-1">
            <button onClick={selectAll} className="text-[10px] text-muted-foreground hover:text-foreground">{selected.size === fIssues.length ? "Deselect all" : "Select all"}</button>
            <span className="text-[9px] text-muted-foreground">{fIssues.length} issues</span>
          </div>
          {fIssues.map(issue => {
            const sv = SEV[issue.severity] || SEV.error;
            const st = STATUS[issue.status] || STATUS.open;
            const et = ETYPE[issue.error_type] || ETYPE.client_error;
            const StI = st.icon; const EtI = et.icon;
            const exp = expandedId === issue.id;
            const meta = issue.last_metadata as any;
            const sla = getSlaStatus(issue);
            const isMuted = issue.muted_until && new Date(issue.muted_until) > new Date();
            const issueAge = Math.round((Date.now() - new Date(issue.first_seen).getTime()) / 86400000);

            if (viewMode === "compact") return (
              <div key={issue.id} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 hover:bg-muted/30 cursor-pointer" onClick={() => setExpandedId(exp ? null : issue.id)}>
                <input type="checkbox" checked={selected.has(issue.id)} onChange={() => toggleSelect(issue.id)} onClick={e => e.stopPropagation()} className="h-3 w-3 rounded accent-primary" />
                <StI className={`h-3 w-3 shrink-0 ${st.color.split(" ")[0]}`} />
                <span className={`rounded px-1 py-0.5 text-[7px] font-bold border ${sv.bg} ${sv.color}`}>{sv.label}</span>
                <p className="text-[10px] font-medium truncate flex-1">{issue.title}</p>
                <span className="text-[8px] text-muted-foreground">{issue.occurrence_count}×</span>
                <span className={`text-[8px] ${sla.color}`}>{sla.label}</span>
                <span className="text-[8px] text-muted-foreground">{ago(issue.last_seen)}</span>
              </div>
            );

            return (
              <div key={issue.id} className={`rounded-xl border bg-card overflow-hidden ${exp ? "border-primary/30" : issue.status === "regressed" ? "border-purple-500/30" : isMuted ? "border-zinc-500/20 opacity-60" : "border-border"}`}>
                <div className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-muted/30">
                  <input type="checkbox" checked={selected.has(issue.id)} onChange={() => toggleSelect(issue.id)} className="h-3 w-3 mt-1 rounded accent-primary shrink-0" />
                  <button onClick={() => setExpandedId(exp ? null : issue.id)} className="flex items-start gap-3 flex-1 min-w-0 text-left">
                    <StI className={`h-4 w-4 mt-0.5 shrink-0 ${st.color.split(" ")[0]}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium line-clamp-1">{issue.title}</p>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <span className={`rounded px-1.5 py-0.5 text-[8px] font-bold border ${st.color}`}>{st.label}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[8px] font-bold border ${sv.bg} ${sv.color}`}>{sv.label}</span>
                        <span className="flex items-center gap-0.5 text-[8px] text-muted-foreground"><EtI className={`h-2.5 w-2.5 ${et.color}`} />{et.label}</span>
                        <span className="text-[8px] text-muted-foreground"><BarChart3 className="inline h-2.5 w-2.5" /> {issue.occurrence_count}×</span>
                        <span className="text-[8px] text-muted-foreground"><Users className="inline h-2.5 w-2.5" /> {issue.affected_users}</span>
                        <span className="text-[8px] text-muted-foreground"><Clock className="inline h-2.5 w-2.5" /> {ago(issue.last_seen)}</span>
                        {issueAge > 0 && <span className="text-[8px] text-muted-foreground"><CalendarClock className="inline h-2.5 w-2.5" /> {issueAge}d old</span>}
                        {isMuted && <span className="text-[8px] text-zinc-400"><BellOff className="inline h-2.5 w-2.5" /> muted</span>}
                        {(issue.tags || []).map(t => <span key={t} className="rounded bg-violet-500/10 border border-violet-500/20 px-1 py-0.5 text-[7px] text-violet-400">{t}</span>)}
                        {(issue.regression_count || 0) > 0 && <span className="text-[8px] text-purple-400"><GitBranch className="inline h-2.5 w-2.5" /> {issue.regression_count}× regressed</span>}
                      </div>
                    </div>
                  </button>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-bold ${sla.breached ? "bg-red-500/10 border border-red-500/20 text-red-500" : "bg-blue-500/10 border border-blue-500/20 text-blue-500"}`} title="SLA">{sla.label}</span>
                    <span className="rounded-full bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 text-[8px] font-bold text-blue-500">{issue.impact_score}</span>
                    {exp ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                  </div>
                </div>
                {exp && (
                  <div className="border-t border-border px-4 py-3 space-y-2.5 bg-muted/10">
                    <div className="flex flex-wrap gap-4 text-[10px]">
                      <div><label className="font-bold text-muted-foreground uppercase tracking-wider">Fingerprint</label><p className="font-mono">{issue.fingerprint}</p></div>
                      <div><label className="font-bold text-muted-foreground uppercase tracking-wider">First</label><p>{new Date(issue.first_seen).toLocaleString()}</p></div>
                      <div><label className="font-bold text-muted-foreground uppercase tracking-wider">Last</label><p>{new Date(issue.last_seen).toLocaleString()}</p></div>
                      {issue.last_page_url && <div><label className="font-bold text-muted-foreground uppercase tracking-wider">Page</label><a href={pagePath(issue.last_page_url)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-500 font-mono">{pagePath(issue.last_page_url)} <ExternalLink className="h-2.5 w-2.5" /></a></div>}
                    </div>
                    {meta?.pg_error && <p className="text-[10px] font-mono bg-red-500/5 rounded p-2 border border-red-500/10 text-red-400">{meta.pg_error}</p>}
                    {meta?.query_params && Object.keys(meta.query_params).length > 0 && (
                      <div className="space-y-0.5">{Object.entries(meta.query_params).map(([k, v]) => <div key={k} className="flex gap-1.5 rounded bg-zinc-950 px-2 py-0.5 text-[9px] font-mono"><span className="text-blue-400">{k}:</span><span className="text-zinc-300 break-all">{String(v)}</span></div>)}</div>
                    )}
                    {meta?.duration_ms && <p className="text-[10px] text-amber-500">Duration: {meta.duration_ms}ms</p>}
                    {meta?.breadcrumbs && (
                      <div>
                        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Breadcrumbs</label>
                        <div className="mt-1 max-h-[150px] overflow-y-auto space-y-0.5">
                          {(meta.breadcrumbs as any[]).map((c: any, i: number) => {
                            const Ic = CRUMB_ICONS[c.type] || Sparkles;
                            return <div key={i} className="flex items-center gap-1.5 text-[9px] font-mono py-0.5 px-1.5 rounded hover:bg-muted/50"><Ic className="h-2.5 w-2.5 text-muted-foreground shrink-0" /><span className="text-muted-foreground">{new Date(c.timestamp).toLocaleTimeString()}</span><span>{c.message}</span></div>;
                          })}
                        </div>
                      </div>
                    )}
                    {/* Tags */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Tag className="h-3 w-3 text-muted-foreground" />
                      {(issue.tags || []).map(t => (
                        <span key={t} className="flex items-center gap-1 rounded bg-violet-500/10 border border-violet-500/20 px-1.5 py-0.5 text-[8px] text-violet-400">
                          {t} <button onClick={() => removeTag(issue.id, t)} className="hover:text-red-400"><X className="h-2 w-2" /></button>
                        </span>
                      ))}
                      <input value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { addTag(issue.id, tagInput); } }} placeholder="add tag..." className="rounded border border-border bg-background px-1.5 py-0.5 text-[9px] w-20 focus:border-primary focus:outline-none" />
                    </div>

                    {/* Notes */}
                    <div className="space-y-1.5">
                      <button onClick={() => loadNotes(issue.id)} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"><StickyNote className="h-3 w-3" /> Notes {notes[issue.id]?.length ? `(${notes[issue.id].length})` : ""}</button>
                      {notes[issue.id] && (
                        <div className="space-y-1 ml-4">
                          {notes[issue.id].map(n => (
                            <div key={n.id} className="rounded bg-muted/50 px-2 py-1 text-[9px]">
                              <span className="text-muted-foreground">{new Date(n.created_at).toLocaleString()}</span>
                              <p>{n.content}</p>
                            </div>
                          ))}
                          <div className="flex gap-1">
                            <input value={newNote} onChange={e => setNewNote(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addNote(issue.id); }} placeholder="Add note..." className="flex-1 rounded border border-border bg-background px-2 py-1 text-[9px] focus:border-primary focus:outline-none" />
                            <button onClick={() => addNote(issue.id)} className="rounded bg-primary/10 border border-primary/20 px-2 py-1 text-[9px] text-primary hover:bg-primary/20">Add</button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-2 border-t border-border/50 flex-wrap">
                      {issue.status !== "resolved" && <button onClick={() => updateStatus(issue.id, "resolved")} className="flex items-center gap-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 text-[10px] text-emerald-500 hover:bg-emerald-500/20"><CheckCircle2 className="h-3 w-3" /> Resolve</button>}
                      {issue.status === "resolved" && <button onClick={() => updateStatus(issue.id, "open")} className="flex items-center gap-1 rounded-lg bg-red-500/10 border border-red-500/20 px-2 py-1 text-[10px] text-red-500"><AlertCircle className="h-3 w-3" /> Reopen</button>}
                      {issue.status !== "ignored" && <button onClick={() => updateStatus(issue.id, "ignored")} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted"><EyeOff className="h-3 w-3" /> Ignore</button>}
                      <button onClick={() => muteIssue(issue.id, 24)} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted"><BellOff className="h-3 w-3" /> Mute 24h</button>
                      <button onClick={() => copyIssue(issue)} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted"><Copy className="h-3 w-3" /> Copy</button>
                      <span className="ml-auto text-[8px] text-muted-foreground font-mono">{issue.fingerprint}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          </>}
        </div>
      )}

      {/* ═══ LOGS TAB ═══ */}
      {tab === "logs" && (
        <div className="space-y-1.5">
          {!fLogs.length ? (
            <div className="rounded-xl border border-border bg-card p-12 text-center"><Bug className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" /><p className="text-sm text-muted-foreground">No logs</p></div>
          ) : fLogs.map(err => {
            const sv = SEV[err.severity] || SEV.error;
            const SvI = sv.icon;
            const et = ETYPE[err.error_type || "client_error"] || ETYPE.client_error;
            const EtI = et.icon;
            const exp = expandedId === err.id;
            const meta = err.metadata as any;
            return (
              <div key={err.id} className={`rounded-xl border bg-card overflow-hidden ${exp ? "border-primary/30" : "border-border"}`}>
                <button onClick={() => setExpandedId(exp ? null : err.id)} className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-muted/30">
                  <SvI className={`h-3 w-3 mt-0.5 shrink-0 ${sv.color}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-medium line-clamp-1">{err.error_message}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[8px] text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-0.5"><EtI className={`h-2.5 w-2.5 ${et.color}`} />{et.label}</span>
                      <span>{ago(err.created_at)}</span>
                      {pagePath(err.page_url) !== "—" && <span className="font-mono truncate max-w-[120px]">{pagePath(err.page_url)}</span>}
                      {err.duration_ms ? <span>{err.duration_ms}ms</span> : null}
                      {err.fingerprint && <span className="font-mono opacity-40">{err.fingerprint}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {err.impact_score ? <span className="rounded bg-blue-500/10 px-1 py-0.5 text-[7px] font-bold text-blue-500">{err.impact_score}</span> : null}
                    <span className={`rounded-full px-1.5 py-0.5 text-[7px] font-bold border ${sv.bg} ${sv.color}`}>{sv.label}</span>
                  </div>
                </button>
                {exp && (
                  <div className="border-t border-border px-3 py-2.5 space-y-2 bg-muted/10 text-[10px]">
                    <p className="font-mono bg-red-500/5 rounded p-2 border border-red-500/10 whitespace-pre-wrap break-all">{err.error_message}</p>
                    {err.error_stack && <pre className="font-mono bg-zinc-950 text-zinc-300 rounded p-2 max-h-[150px] overflow-auto text-[9px] whitespace-pre-wrap break-all">{err.error_stack}</pre>}
                    {meta?.pg_error && <p className="font-mono bg-red-500/5 rounded p-2 border border-red-500/10 text-red-400">{meta.pg_error}</p>}
                    {meta?.table && <div className="flex gap-2"><span className={`rounded px-1.5 py-0.5 text-[9px] font-bold border ${HTTP_COLORS[meta.http_status] || "bg-zinc-500/10 text-zinc-500 border-zinc-500/20"}`}>{meta.http_method} {meta.http_status}</span><span className="rounded bg-purple-500/10 border border-purple-500/20 px-1.5 py-0.5 text-[9px] font-mono text-purple-500"><Table2 className="inline h-2.5 w-2.5 mr-0.5" />{meta.table}</span></div>}
                    {meta?.query_params && Object.keys(meta.query_params).length > 0 && <div className="space-y-0.5">{Object.entries(meta.query_params).map(([k, v]) => <div key={k} className="flex gap-1.5 rounded bg-zinc-950 px-2 py-0.5 text-[9px] font-mono"><span className="text-blue-400">{k}:</span><span className="text-zinc-300 break-all">{String(v)}</span></div>)}</div>}
                    {meta?.breadcrumbs && <div><label className="font-bold text-muted-foreground uppercase tracking-wider">Breadcrumbs</label><div className="mt-1 max-h-[120px] overflow-y-auto space-y-0.5">{(meta.breadcrumbs as any[]).map((c: any, i: number) => { const Ic = CRUMB_ICONS[c.type] || Sparkles; return <div key={i} className="flex items-center gap-1 text-[9px] font-mono"><Ic className="h-2.5 w-2.5 text-muted-foreground" /><span className="text-muted-foreground">{new Date(c.timestamp).toLocaleTimeString()}</span><span>{c.message}</span></div>; })}</div></div>}
                    <div className="flex items-center justify-between pt-1.5 border-t border-border/50">
                      <span className="text-muted-foreground">{new Date(err.created_at).toLocaleString()}{err.deploy_version ? ` · ${err.deploy_version.slice(0, 8)}` : ""}{err.session_id ? ` · ${err.session_id}` : ""}</span>
                      <div className="flex items-center gap-1.5">
                        {err.page_url && <a href={pagePath(err.page_url)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 rounded bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 text-blue-500 hover:bg-blue-500/20"><ExternalLink className="h-2.5 w-2.5" /> Page</a>}
                        <button onClick={(ev) => { ev.stopPropagation(); delOne(err.id); }} className="flex items-center gap-1 rounded px-2 py-0.5 text-red-500 hover:bg-red-500/10"><Trash2 className="h-2.5 w-2.5" /> Del</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ═══ HEALTH TAB ═══ */}
      {tab === "health" && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-muted/30">
            <h3 className="text-xs font-bold flex items-center gap-2"><Activity className="h-3.5 w-3.5 text-blue-500" /> Query Health by Table</h3>
          </div>
          {!health.length ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No query errors recorded</div>
          ) : (
            <div className="divide-y divide-border">
              {health.map(h => {
                const rate = h.failures + h.slow;
                const dot = rate === 0 ? "bg-emerald-500" : rate < 5 ? "bg-amber-500" : "bg-red-500";
                return (
                  <div key={h.table} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30">
                    <div className={`h-2 w-2 rounded-full ${dot}`} />
                    <span className="text-xs font-mono font-medium flex-1">{h.table}</span>
                    <span className="text-[10px] text-red-500 font-medium">{h.failures} failures</span>
                    <span className="text-[10px] text-amber-500 font-medium">{h.slow} slow</span>
                    <span className="text-[10px] text-muted-foreground">{ago(h.last)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ ANALYTICS TAB ═══ */}
      {tab === "analytics" && (
        <div className="space-y-4">
          {/* Key Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-2"><Hourglass className="h-4 w-4 text-cyan-500" /><h3 className="text-xs font-bold">Mean Time to Resolve</h3></div>
              <p className="text-2xl font-bold text-cyan-500">{mttr || "—"}</p>
              <p className="text-[9px] text-muted-foreground mt-1">Avg time from first seen to resolved</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-2"><Target className="h-4 w-4 text-red-500" /><h3 className="text-xs font-bold">SLA Breaches</h3></div>
              <p className={`text-2xl font-bold ${slaBreaches > 0 ? "text-red-500" : "text-emerald-500"}`}>{slaBreaches}</p>
              <p className="text-[9px] text-muted-foreground mt-1">Open issues past SLA deadline</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-2"><Layers className="h-4 w-4 text-purple-500" /><h3 className="text-xs font-bold">Unique Error Types</h3></div>
              <p className="text-2xl font-bold text-purple-500">{new Set(issues.map(i => i.error_type)).size}</p>
              <p className="text-[9px] text-muted-foreground mt-1">Distinct error categories</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-2"><Users className="h-4 w-4 text-amber-500" /><h3 className="text-xs font-bold">Total Users Affected</h3></div>
              <p className="text-2xl font-bold text-amber-500">{issues.reduce((s, i) => s + i.affected_users, 0)}</p>
              <p className="text-[9px] text-muted-foreground mt-1">Across all open issues</p>
            </div>
          </div>

          {/* Error Rate by Page */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border bg-muted/30">
              <h3 className="text-xs font-bold flex items-center gap-2"><Globe className="h-3.5 w-3.5 text-blue-500" /> Error Rate by Page</h3>
            </div>
            {!pageStats.length ? (
              <div className="p-6 text-center text-sm text-muted-foreground">No page-level data</div>
            ) : (
              <div className="divide-y divide-border">
                {pageStats.map(p => {
                  const maxCount = pageStats[0]?.count || 1;
                  return (
                    <div key={p.page} className="flex items-center gap-3 px-4 py-2 hover:bg-muted/30">
                      <span className="text-xs font-mono flex-1 truncate">{p.page}</span>
                      <div className="w-32 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-red-500" style={{ width: `${(p.count / maxCount) * 100}%` }} />
                      </div>
                      <span className="text-[10px] text-red-500 font-medium w-12 text-right">{p.count}×</span>
                      <span className="text-[10px] text-blue-500 font-medium w-10 text-right">{Math.round(p.impact)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Severity Distribution */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="text-xs font-bold flex items-center gap-2 mb-3"><PieChart className="h-3.5 w-3.5 text-purple-500" /> Severity Distribution</h3>
              <div className="space-y-2">
                {(["fatal", "error", "warn", "info"] as const).map(sev => {
                  const count = issues.filter(i => i.severity === sev).length;
                  const pct = issues.length ? Math.round((count / issues.length) * 100) : 0;
                  const sv = SEV[sev];
                  return (
                    <div key={sev} className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold w-10 ${sv.color}`}>{sv.label}</span>
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full rounded-full ${sev === "fatal" ? "bg-red-600" : sev === "error" ? "bg-red-500" : sev === "warn" ? "bg-amber-500" : "bg-blue-500"}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] text-muted-foreground w-14 text-right">{count} ({pct}%)</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="text-xs font-bold flex items-center gap-2 mb-3"><CircleDot className="h-3.5 w-3.5 text-blue-500" /> Status Breakdown</h3>
              <div className="space-y-2">
                {(["open", "regressed", "resolved", "ignored"] as const).map(st => {
                  const count = issues.filter(i => i.status === st).length;
                  const pct = issues.length ? Math.round((count / issues.length) * 100) : 0;
                  const s = STATUS[st] || STATUS.open;
                  return (
                    <div key={st} className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold w-14 ${s.color.split(" ")[0]}`}>{s.label}</span>
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full rounded-full ${st === "open" ? "bg-red-500" : st === "regressed" ? "bg-purple-500" : st === "resolved" ? "bg-emerald-500" : "bg-zinc-500"}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] text-muted-foreground w-14 text-right">{count} ({pct}%)</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* SLA Compliance */}
          {slaConfigs.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="text-xs font-bold flex items-center gap-2 mb-3"><Shield className="h-3.5 w-3.5 text-emerald-500" /> SLA Compliance</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {slaConfigs.map(sla => {
                  const sevIssues = issues.filter(i => i.severity === sla.severity && i.status === "open");
                  const breached = sevIssues.filter(i => getSlaStatus(i).breached).length;
                  const compliant = sevIssues.length - breached;
                  return (
                    <div key={sla.severity} className="rounded-lg border border-border bg-muted/20 p-3">
                      <p className={`text-[10px] font-bold ${SEV[sla.severity]?.color || "text-foreground"}`}>{SEV[sla.severity]?.label || sla.severity}</p>
                      <p className="text-[9px] text-muted-foreground">Respond: {sla.max_response_minutes}m / Resolve: {sla.max_resolve_minutes}m</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-[10px] text-emerald-500">{compliant} OK</span>
                        {breached > 0 && <span className="text-[10px] text-red-500">{breached} breached</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Daily Snapshots */}
          {snapshots.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="text-xs font-bold flex items-center gap-2 mb-3"><CalendarClock className="h-3.5 w-3.5 text-amber-500" /> Daily Snapshots</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-[10px]">
                  <thead><tr className="border-b border-border text-muted-foreground"><th className="text-left py-1 px-2">Date</th><th className="text-right py-1 px-2">Open</th><th className="text-right py-1 px-2">Resolved</th><th className="text-right py-1 px-2">Regressed</th><th className="text-right py-1 px-2">Occurrences</th><th className="text-right py-1 px-2">Avg Impact</th></tr></thead>
                  <tbody>
                    {snapshots.slice(0, 14).map(s => (
                      <tr key={s.snapshot_date} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="py-1 px-2 font-mono">{s.snapshot_date}</td>
                        <td className="py-1 px-2 text-right text-red-500">{s.open_count}</td>
                        <td className="py-1 px-2 text-right text-emerald-500">{s.resolved_count}</td>
                        <td className="py-1 px-2 text-right text-purple-500">{s.regressed_count}</td>
                        <td className="py-1 px-2 text-right">{s.total_occurrences}</td>
                        <td className="py-1 px-2 text-right text-blue-500">{Number(s.avg_impact_score).toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ CONFIG TAB ═══ */}
      {tab === "config" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-xs font-bold flex items-center gap-2 mb-3"><Bell className="h-3.5 w-3.5 text-blue-500" /> Webhook Alerts</h3>
            <p className="text-[10px] text-muted-foreground mb-3">Add Slack or Discord webhook URLs to get real-time alerts when new issues are detected or regressions occur.</p>
            <WebhookConfig />
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-xs font-bold flex items-center gap-2 mb-2"><Heart className="h-3.5 w-3.5 text-emerald-500" /> Canary Status</h3>
            <p className="text-[10px] text-muted-foreground">
              {stats.canary
                ? <>Last canary: <span className="text-emerald-500 font-medium">{ago(stats.canary)}</span> — QueryGuard is running</>
                : <span className="text-red-500">No canary received — QueryGuard may not be active on client</span>
              }
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-xs font-bold flex items-center gap-2 mb-2"><Gauge className="h-3.5 w-3.5 text-amber-500" /> Error Budget Settings</h3>
            <p className="text-[10px] text-muted-foreground">Daily budget: {budget?.budget_limit || 50} errors. Adjust in the <code className="bg-muted px-1 rounded">queryguard_error_budget</code> table.</p>
          </div>
          {/* SLA Configuration */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-xs font-bold flex items-center gap-2 mb-3"><Target className="h-3.5 w-3.5 text-red-500" /> SLA Targets</h3>
            <p className="text-[10px] text-muted-foreground mb-3">Response and resolution time targets per severity level.</p>
            <div className="space-y-2">
              {slaConfigs.map(sla => (
                <div key={sla.severity} className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
                  <span className={`text-xs font-bold w-12 ${SEV[sla.severity]?.color || ""}`}>{SEV[sla.severity]?.label || sla.severity}</span>
                  <span className="text-[10px] text-muted-foreground">Respond:</span>
                  <span className="text-[10px] font-medium">{sla.max_response_minutes}m</span>
                  <span className="text-[10px] text-muted-foreground">Resolve:</span>
                  <span className="text-[10px] font-medium">{sla.max_resolve_minutes}m</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WebhookConfig() {
  const [configs, setConfigs] = useState<any[]>([]);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sb = createClient();
    sb.from("queryguard_alert_config").select("*").order("created_at", { ascending: false }).then(({ data }) => {
      setConfigs(data || []);
      setLoading(false);
    });
  }, []);

  const addWebhook = async () => {
    if (!url.startsWith("http")) return;
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    await sb.from("queryguard_alert_config").insert({ alert_type: "webhook", target_url: url, enabled: true, min_severity: "error", throttle_minutes: 60, created_by: user?.id });
    setUrl("");
    const { data } = await sb.from("queryguard_alert_config").select("*").order("created_at", { ascending: false });
    setConfigs(data || []);
  };

  const toggle = async (id: string, enabled: boolean) => {
    const sb = createClient();
    await sb.from("queryguard_alert_config").update({ enabled: !enabled }).eq("id", id);
    setConfigs(prev => prev.map(c => c.id === id ? { ...c, enabled: !enabled } : c));
  };

  const del = async (id: string) => {
    const sb = createClient();
    await sb.from("queryguard_alert_config").delete().eq("id", id);
    setConfigs(prev => prev.filter(c => c.id !== id));
  };

  if (loading) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://hooks.slack.com/services/..." className="flex-1 rounded border border-border bg-background px-3 py-1.5 text-xs focus:border-primary focus:outline-none" />
        <button onClick={addWebhook} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">Add</button>
      </div>
      {configs.map(c => (
        <div key={c.id} className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
          <div className={`h-2 w-2 rounded-full ${c.enabled ? "bg-emerald-500" : "bg-zinc-400"}`} />
          <span className="flex-1 text-[10px] font-mono truncate">{c.target_url || c.alert_type}</span>
          <span className="text-[9px] text-muted-foreground">≥{c.min_severity}</span>
          <button onClick={() => toggle(c.id, c.enabled)} className="text-[10px] text-muted-foreground hover:text-foreground">{c.enabled ? "Disable" : "Enable"}</button>
          <button onClick={() => del(c.id)} className="text-[10px] text-red-500 hover:text-red-400">Delete</button>
        </div>
      ))}
      {!configs.length && <p className="text-[10px] text-muted-foreground">No webhooks configured</p>}
    </div>
  );
}