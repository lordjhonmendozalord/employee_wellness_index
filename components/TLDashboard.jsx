import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "../src/supabaseClient";

// ─── Constants ────────────────────────────────────────────────────────────────
const WELLNESS_CATEGORIES = [
  { min: 9, max: 10, status: "Excellent",  action: "No Action",              color: "text-green-700",  bg: "bg-green-100",  bar: "bg-green-500"  },
  { min: 7, max: 8,  status: "Healthy",    action: "Monitor",                color: "text-teal-700",   bg: "bg-teal-100",   bar: "bg-teal-500"   },
  { min: 5, max: 6,  status: "Watchlist",  action: "Supervisor Check-in",    color: "text-yellow-700", bg: "bg-yellow-100", bar: "bg-yellow-400" },
  { min: 3, max: 4,  status: "At Risk",    action: "Coaching Required",      color: "text-orange-700", bg: "bg-orange-100", bar: "bg-orange-500" },
  { min: 0, max: 2,  status: "Critical",   action: "Immediate Intervention", color: "text-red-700",    bg: "bg-red-100",    bar: "bg-red-500"    },
];

const EMOTION_LABELS = { 5:"Excited", 4:"Happy", 3:"Motivated", 2:"Concerned", 1:"Stressed", 0:"Burned Out" };
const EMOTION_ICONS  = { 5:"😀", 4:"🟢", 3:"🟢", 2:"🟡", 1:"🟠", 0:"🔴" };
const ENERGY_LABELS  = { 5:"Highly Energized", 4:"Energized", 3:"Normal", 2:"Low Energy", 1:"Exhausted" };
const ENERGY_ICONS   = { 5:"⚡", 4:"😊", 3:"😐", 2:"🥱", 1:"😴" };
const ENERGY_COLORS  = { 5:"bg-blue-600", 4:"bg-green-500", 3:"bg-slate-400", 2:"bg-orange-400", 1:"bg-red-500" };
const MOOD_COLORS    = { 5:"bg-blue-500", 4:"bg-green-500", 3:"bg-teal-500", 2:"bg-yellow-400", 1:"bg-orange-500", 0:"bg-red-500" };
const AVATAR_COLORS  = [
  "bg-blue-100 text-blue-700", "bg-teal-100 text-teal-700",
  "bg-violet-100 text-violet-700", "bg-amber-100 text-amber-700",
  "bg-pink-100 text-pink-700", "bg-indigo-100 text-indigo-700",
];

// ─── Date helpers (LOCAL time — avoids UTC+8 off-by-one) ─────────────────────
const toISO = (d) => {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dy}`;
};
const todayISO    = () => toISO(new Date());
const formatShort = (dateStr) =>
  new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const formatDisplay = (dateStr) =>
  new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

function weekStart(dateStr) {
  const d   = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return toISO(d);
}
function weekEnd(dateStr) {
  const d = new Date(weekStart(dateStr) + "T00:00:00");
  d.setDate(d.getDate() + 6);
  return toISO(d);
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────
const getWellnessCategory = (score) =>
  WELLNESS_CATEGORIES.find((c) => score >= c.min && score <= c.max) ?? WELLNESS_CATEGORIES[4];
const avatarInitials = (name = "") =>
  name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const avatarColor = (id) => {
  const n = parseInt(id?.replace(/\D/g, "") || "0", 10);
  return AVATAR_COLORS[n % AVATAR_COLORS.length];
};

// ─── Supabase queries ────────────────────────────────────────────────────────
// Fetch survey for a given date, optionally filtered by lob (team)
async function fetchTeamSurvey(dateStr, lob) {
  let q = supabase
    .from("employee_survey")
    .select("*")
    .gte("created_at", `${dateStr}T00:00:00+00:00`)
    .lte("created_at", `${dateStr}T23:59:59+00:00`)
    .order("created_at", { ascending: false });

  if (lob) q = q.eq("lob", lob);

  const { data, error } = await q;
  if (error || !data) return [];

  const seen = new Set();
  const deduped = [];
  for (const row of data) {
    if (!seen.has(row.employee_id)) {
      seen.add(row.employee_id);
      deduped.push({
        ...row,
        ewi_score:        row.energy_level + row.emotion_level,
        tl_trigger:       row.energy_level <= 2 || row.emotion_level <= 1,
        wellness_status:  getWellnessCategory(row.energy_level + row.emotion_level).status,
      });
    }
  }
  return deduped.sort((a, b) => a.ewi_score - b.ewi_score);
}

async function fetchTrendForWeek(dateStr, lob) {
  const start = weekStart(dateStr);
  const end   = weekEnd(dateStr);

  let q = supabase
    .from("employee_survey")
    .select("employee_id, energy_level, emotion_level, created_at")
    .gte("created_at", `${start}T00:00:00+00:00`)
    .lte("created_at", `${end}T23:59:59+00:00`)
    .order("created_at", { ascending: false });

  if (lob) q = q.eq("lob", lob);

  const { data, error } = await q;
  if (error || !data) return [];

  const byEmpDate = {};
  for (const row of data) {
    const d   = row.created_at.split("T")[0];
    const key = `${row.employee_id}__${d}`;
    if (!byEmpDate[key]) byEmpDate[key] = row;
  }

  const byDate = {};
  for (const row of Object.values(byEmpDate)) {
    const d = row.created_at.split("T")[0];
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(row.energy_level + row.emotion_level);
  }

  return Object.entries(byDate)
    .map(([date, scores]) => ({
      survey_date:      date,
      day_label:        new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" }),
      avg_ewi:          (scores.reduce((s, v) => s + v, 0) / scores.length).toFixed(2),
      respondent_count: scores.length,
    }))
    .sort((a, b) => a.survey_date.localeCompare(b.survey_date));
}

// Fetch distinct LOBs so the TL can pick their team
async function fetchLOBs() {
  const { data } = await supabase
    .from("employee_survey")
    .select("lob")
    .order("lob");
  if (!data) return [];
  return [...new Set(data.map((r) => r.lob))];
}

// ─── Reusable UI components ──────────────────────────────────────────────────
function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
    </div>
  );
}

function EmptyState({ message }) {
  return <p className="text-sm text-slate-400 text-center py-10">{message}</p>;
}

function WellnessBadge({ score }) {
  const cat = getWellnessCategory(score ?? 0);
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cat.bg} ${cat.color}`}>
      {cat.status}
    </span>
  );
}

function StatCard({ label, value, sub, icon, accent = "text-indigo-600", pulse }) {
  return (
    <div className="bg-slate-50 rounded-xl p-4">
      <div className="flex items-center gap-2 text-slate-400 text-xs font-medium mb-2">
        <span className={`text-base ${accent}`}>{icon}</span>
        {label}
        {pulse && <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse ml-1" />}
      </div>
      <div className="text-2xl font-semibold text-slate-800 leading-none">{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}

function DistBar({ icon, label, count, total, colorClass }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-base w-5 text-center flex-shrink-0">{icon}</span>
      <span className="text-xs text-slate-500 w-32 flex-shrink-0">{label}</span>
      <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
        <div className={`h-2 rounded-full ${colorClass} transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium text-slate-600 w-14 text-right">
        {count} <span className="text-slate-400">({pct}%)</span>
      </span>
    </div>
  );
}

function EWIGauge({ score }) {
  const pct = ((score ?? 0) / 10) * 100;
  const cat = getWellnessCategory(Math.round(score ?? 0));
  return (
    <div>
      <div className="flex items-end justify-between mb-1">
        <span className="text-3xl font-semibold text-slate-800">{(score ?? 0).toFixed(2)}</span>
        <span className="text-sm text-slate-400 mb-1">/ 10</span>
      </div>
      <div className="w-full bg-slate-100 rounded-full h-3 mb-2 overflow-hidden">
        <div className={`h-3 rounded-full transition-all duration-700 ${cat.bar}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${cat.bg} ${cat.color}`}>
        {cat.status} Team
      </span>
    </div>
  );
}

function TrendChart({ data, selectedDate, onDayClick }) {
  if (!data?.length) return <p className="text-xs text-slate-400 text-center py-6">No data for this week.</p>;
  const scores = data.map((d) => parseFloat(d.avg_ewi));
  const minV   = Math.max(0, Math.min(...scores) - 0.8);
  const maxV   = Math.min(10, Math.max(...scores) + 0.8);
  const H = 80, W = 420;
  const pts = data.map((d, i) => ({
    x: 40 + (i / Math.max(data.length - 1, 1)) * (W - 60),
    y: H - ((parseFloat(d.avg_ewi) - minV) / (maxV - minV)) * (H - 10),
    ...d,
  }));
  const polyline = pts.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H + 28}`} className="w-full">
      <polyline points={polyline} fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p) => {
        const isSel = p.survey_date === selectedDate;
        return (
          <g key={p.survey_date} className="cursor-pointer" onClick={() => onDayClick(p.survey_date)}>
            <circle cx={p.x} cy={p.y} r={isSel ? 6 : 4} fill={isSel ? "#4338ca" : "#6366f1"} />
            {isSel && <circle cx={p.x} cy={p.y} r={10} fill="none" stroke="#a5b4fc" strokeWidth="2" />}
            <text x={p.x} y={p.y - 10} textAnchor="middle" fontSize="10" fill={isSel ? "#4338ca" : "#64748b"} fontWeight={isSel ? "700" : "400"}>
              {parseFloat(p.avg_ewi).toFixed(1)}
            </text>
            <text x={p.x} y={H + 18} textAnchor="middle" fontSize="10" fill={isSel ? "#4338ca" : "#94a3b8"} fontWeight={isSel ? "700" : "400"}>
              {p.day_label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Date Filter Bar ──────────────────────────────────────────────────────────
function DateFilterBar({ selectedDate, onChange }) {
  const inputRef = useRef(null);
  const today    = todayISO();

  const shiftDay = (n) => {
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() + n);
    const shifted = toISO(d);
    if (shifted <= today) onChange(shifted);
  };

  const yesterday = () => {
    const d = new Date(today + "T00:00:00");
    d.setDate(d.getDate() - 1);
    return toISO(d);
  };

  const isHistorical = selectedDate !== today;

  return (
    <div className="bg-white border-b border-slate-200">
      <div className="max-w-6xl mx-auto px-6 py-2.5 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onChange(today)}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
              selectedDate === today ? "bg-indigo-600 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >Today</button>
          <button
            onClick={() => onChange(yesterday())}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
              selectedDate === yesterday() ? "bg-indigo-600 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >Yesterday</button>
        </div>

        <div className="w-px h-5 bg-slate-200" />

        <div className="flex items-center gap-1">
          <button onClick={() => shiftDay(-1)} title="Previous day"
            className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 text-sm">‹</button>
          <button onClick={() => shiftDay(1)} disabled={selectedDate >= today} title="Next day"
            className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 text-sm disabled:opacity-30 disabled:cursor-not-allowed">›</button>
        </div>

        <div
          className="flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-1.5 hover:border-indigo-300 transition-colors cursor-pointer"
          onClick={() => inputRef.current?.showPicker?.()}
        >
          <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <input
            ref={inputRef} type="date" value={selectedDate} max={today}
            onChange={(e) => e.target.value && onChange(e.target.value)}
            className="text-xs font-medium text-slate-700 bg-transparent outline-none cursor-pointer w-28"
          />
        </div>

        {isHistorical ? (
          <span className="flex items-center gap-1.5 text-xs font-medium text-amber-600 bg-amber-50 border border-amber-100 px-2.5 py-1 rounded-full">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Historical — {formatShort(selectedDate)}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-100 px-2.5 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
            Live — today
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Mood Summary Mini-bar ────────────────────────────────────────────────────
function MoodSummaryBar({ employees }) {
  const total = employees.length;
  if (!total) return null;
  // Aggregate
  const emotionCounts = {};
  const energyCounts  = {};
  employees.forEach((e) => {
    emotionCounts[e.emotion_level] = (emotionCounts[e.emotion_level] || 0) + 1;
    energyCounts[e.energy_level]   = (energyCounts[e.energy_level]  || 0) + 1;
  });
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">Team Mood</p>
        <h3 className="text-sm font-semibold text-slate-800 mb-4">Emotional level distribution</h3>
        <div className="space-y-3">
          {[5,4,3,2,1,0].map((lvl) => (
            <DistBar
              key={lvl}
              icon={EMOTION_ICONS[lvl]}
              label={EMOTION_LABELS[lvl]}
              count={emotionCounts[lvl] || 0}
              total={total}
              colorClass={MOOD_COLORS[lvl]}
            />
          ))}
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">Team Energy</p>
        <h3 className="text-sm font-semibold text-slate-800 mb-4">Energy level distribution</h3>
        <div className="space-y-3">
          {[5,4,3,2,1].map((lvl) => (
            <DistBar
              key={lvl}
              icon={ENERGY_ICONS[lvl]}
              label={ENERGY_LABELS[lvl]}
              count={energyCounts[lvl] || 0}
              total={total}
              colorClass={ENERGY_COLORS[lvl]}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main TL Dashboard ────────────────────────────────────────────────────────
export default function TLDashboard() {
  const [activeTab, setActiveTab]       = useState("overview");
  const [search, setSearch]             = useState("");
  const [loading, setLoading]           = useState(true);
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [selectedLOB, setSelectedLOB]   = useState("");   // "" = show all (TL may manage one LOB)
  const [lobs, setLobs]                 = useState([]);
  const [lastRefresh, setLastRefresh]   = useState(null);

  const [employees, setEmployees] = useState([]);
  const [trend, setTrend]         = useState([]);

  const fetchAll = useCallback(async (date, lob) => {
    setLoading(true);
    const [emps, trnd] = await Promise.all([
      fetchTeamSurvey(date, lob || null),
      fetchTrendForWeek(date, lob || null),
    ]);
    setEmployees(emps);
    setTrend(trnd);
    setLoading(false);
    setLastRefresh(new Date());
  }, []);

  // Initial load + LOBs
  useEffect(() => {
    fetchLOBs().then(setLobs);
    fetchAll(selectedDate, selectedLOB);
  }, []);

  // Refetch on date or LOB change
  useEffect(() => { fetchAll(selectedDate, selectedLOB); }, [selectedDate, selectedLOB]);

  // Realtime — today only
  useEffect(() => {
    if (selectedDate !== todayISO()) return;
    const channel = supabase
      .channel("tl_survey_changes")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "employee_survey" },
        () => fetchAll(selectedDate, selectedLOB))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [fetchAll, selectedDate, selectedLOB]);

  const handleDateChange = (date) => { setSelectedDate(date); setSearch(""); };

  // Derived
  const enriched = employees.map((e) => ({
    ...e,
    avatarColor: avatarColor(e.employee_id),
    initials:    avatarInitials(e.full_name),
  }));

  const tlAlerts  = enriched.filter((e) => e.tl_trigger);
  const avgEwi    = enriched.length > 0
    ? enriched.reduce((s, e) => s + e.ewi_score, 0) / enriched.length
    : 0;
  const isHistorical = selectedDate !== todayISO();

  const filtered = enriched.filter((e) =>
    e.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    e.employee_id?.toLowerCase().includes(search.toLowerCase()) ||
    e.account_name?.toLowerCase().includes(search.toLowerCase())
  );

  const weekLabel = (() => {
    const s  = weekStart(selectedDate);
    const en = weekEnd(selectedDate);
    const fmt = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${fmt(s)} – ${fmt(en)}`;
  })();

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "team",     label: "Team Mood" },
    { key: "alerts",   label: `Alerts${tlAlerts.length > 0 ? ` (${tlAlerts.length})` : ""}` },
  ];

  // Status breakdown counts
  const statusCounts = { Excellent: 0, Healthy: 0, Watchlist: 0, "At Risk": 0, Critical: 0 };
  enriched.forEach((e) => { if (statusCounts[e.wellness_status] !== undefined) statusCounts[e.wellness_status]++; });

  return (
    <div className="min-h-screen bg-slate-100 font-sans">

      {/* ── Topbar ── */}
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800 leading-tight">Wellness Check</p>
              <p className="text-xs text-slate-400 leading-tight">Team Leader Dashboard</p>
            </div>
            <span className="ml-2 text-xs font-semibold bg-indigo-600 text-white px-2.5 py-0.5 rounded-full">TL</span>
          </div>

          <div className="flex items-center gap-3">
            {/* LOB / Team selector */}
            {lobs.length > 0 && (
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-400 hidden sm:block">Team (LOB)</label>
                <select
                  value={selectedLOB}
                  onChange={(e) => setSelectedLOB(e.target.value)}
                  className="text-xs font-medium border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200"
                >
                  <option value="">All LOBs</option>
                  {lobs.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            )}

            {lastRefresh && (
              <span className="text-xs text-slate-400 hidden md:block">
                {isHistorical ? "Loaded" : "Refreshed"} {lastRefresh.toLocaleTimeString()}
              </span>
            )}
            {!isHistorical && (
              <button
                onClick={() => fetchAll(selectedDate, selectedLOB)}
                className="flex items-center gap-1.5 text-xs font-medium border border-slate-200 rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-50 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
            )}
            {tlAlerts.length > 0 && (
              <span className="flex items-center gap-1 text-xs font-semibold bg-orange-100 text-orange-700 px-2.5 py-1 rounded-full">
                <span className={`w-1.5 h-1.5 rounded-full bg-orange-500 inline-block ${!isHistorical ? "animate-pulse" : ""}`} />
                {tlAlerts.length} Alert{tlAlerts.length > 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>

        {/* Tab bar */}
        <div className="max-w-6xl mx-auto px-6 flex gap-1 border-t border-slate-100">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === t.key
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {/* ── Date Filter Bar ── */}
      <DateFilterBar selectedDate={selectedDate} onChange={handleDateChange} />

      {/* ── Historical banner ── */}
      {isHistorical && (
        <div className="bg-amber-50 border-b border-amber-100">
          <div className="max-w-6xl mx-auto px-6 py-2 flex items-center gap-2 text-xs text-amber-700">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Historical snapshot for <strong className="mx-1">{formatDisplay(selectedDate)}</strong>. Realtime updates paused.
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {loading ? <Spinner /> : (
          <>

            {/* ══════════════ OVERVIEW ══════════════ */}
            {activeTab === "overview" && (
              <>
                {/* Stat cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <StatCard
                    label="Team respondents"
                    value={enriched.length}
                    sub={`submitted on ${formatShort(selectedDate)}`}
                    icon="👥"
                  />
                  <StatCard
                    label="Team EWI"
                    value={enriched.length > 0 ? avgEwi.toFixed(2) : "—"}
                    sub={enriched.length > 0 ? getWellnessCategory(Math.round(avgEwi)).status : "No data"}
                    icon="📊"
                    accent="text-indigo-600"
                  />
                  <StatCard
                    label="Needs attention"
                    value={tlAlerts.length}
                    sub="low energy or stressed"
                    icon="🔔"
                    accent="text-orange-500"
                    pulse={tlAlerts.length > 0 && !isHistorical}
                  />
                  <StatCard
                    label="Fully well"
                    value={enriched.filter((e) => e.ewi_score >= 7).length}
                    sub="Healthy or Excellent"
                    icon="✅"
                    accent="text-green-600"
                  />
                </div>

                {/* EWI gauge + trend */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="bg-white rounded-2xl border border-slate-200 p-5">
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">Team Wellness Score</p>
                    <h2 className="text-base font-semibold text-slate-800 mb-4">
                      Team Wellness Index — {formatShort(selectedDate)}
                    </h2>
                    {enriched.length === 0
                      ? <EmptyState message="No data for this date." />
                      : <EWIGauge score={avgEwi} />
                    }

                    {/* Status breakdown */}
                    {enriched.length > 0 && (
                      <div className="mt-5 pt-4 border-t border-slate-100 space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Status breakdown</p>
                        {WELLNESS_CATEGORIES.map((c) => (
                          <div key={c.status} className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <span className={`w-1.5 h-1.5 rounded-full ${c.bar} flex-shrink-0`} />
                              <span className={`font-semibold px-2 py-0.5 rounded-full ${c.bg} ${c.color}`}>{c.status}</span>
                              <span className="text-slate-400">{c.action}</span>
                            </div>
                            <span className="font-semibold text-slate-700 tabular-nums">
                              {statusCounts[c.status] ?? 0}
                              <span className="text-slate-400 font-normal"> / {enriched.length}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Trend */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-5">
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
                      Trend — week of {weekLabel}
                    </p>
                    <h2 className="text-base font-semibold text-slate-800 mb-1">Weekly team wellness</h2>
                    <p className="text-xs text-slate-400 mb-4">
                      {isHistorical
                        ? `Week containing ${formatShort(selectedDate)}. Selected day is highlighted.`
                        : "Track your team's wellness pattern this week."}
                    </p>
                    <TrendChart data={trend} selectedDate={selectedDate} onDayClick={handleDateChange} />
                    {trend.length > 0 && (
                      <div
                        className="mt-4 pt-3 border-t border-slate-100 grid gap-1"
                        style={{ gridTemplateColumns: `repeat(${trend.length}, 1fr)` }}
                      >
                        {trend.map((d) => {
                          const s   = parseFloat(d.avg_ewi);
                          const cat = getWellnessCategory(Math.round(s));
                          const sel = d.survey_date === selectedDate;
                          return (
                            <button
                              key={d.survey_date}
                              onClick={() => handleDateChange(d.survey_date)}
                              className={`text-center rounded-lg py-1.5 px-1 transition-colors ${
                                sel ? "bg-indigo-50 ring-1 ring-indigo-200" : "hover:bg-slate-50"
                              }`}
                            >
                              <p className={`text-xs ${sel ? "text-indigo-600 font-semibold" : "text-slate-400"}`}>{d.day_label}</p>
                              <p className={`text-sm font-semibold ${sel ? "text-indigo-700" : "text-slate-700"}`}>{s.toFixed(1)}</p>
                              <span className={`text-[10px] font-semibold px-1 py-0.5 rounded-full ${cat.bg} ${cat.color}`}>{cat.status}</span>
                              <p className="text-[10px] text-slate-400 mt-0.5">{d.respondent_count} resp.</p>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Mood + energy bars */}
                {enriched.length > 0 && <MoodSummaryBar employees={enriched} />}
              </>
            )}

            {/* ══════════════ TEAM MOOD TABLE ══════════════ */}
            {activeTab === "team" && (
              <div className="bg-white rounded-2xl border border-slate-200">
                <div className="p-5 border-b border-slate-100 flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-0.5">Team Mood Overview</p>
                    <h2 className="text-base font-semibold text-slate-800">
                      {formatDisplay(selectedDate)} — {enriched.length} respondent{enriched.length !== 1 ? "s" : ""}
                      {selectedLOB && <span className="text-slate-400 font-normal text-sm ml-2">· {selectedLOB}</span>}
                    </h2>
                  </div>
                  <input
                    type="text"
                    placeholder="Search name, ID, account…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="text-sm border border-slate-200 rounded-lg px-3 py-2 w-56 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  />
                </div>

                {filtered.length === 0 ? (
                  <EmptyState message={enriched.length === 0 ? `No submissions on ${formatDisplay(selectedDate)}.` : "No employees match your search."} />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-slate-400 uppercase tracking-wider border-b border-slate-100">
                          <th className="text-left px-5 py-3 font-medium">Employee</th>
                          <th className="text-left px-4 py-3 font-medium">Account</th>
                          <th className="text-center px-4 py-3 font-medium">Energy</th>
                          <th className="text-center px-4 py-3 font-medium">Feeling</th>
                          <th className="text-center px-4 py-3 font-medium">EWI</th>
                          <th className="text-center px-4 py-3 font-medium">Status</th>
                          <th className="text-center px-4 py-3 font-medium">Alert</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {filtered.map((e) => {
                          const cat   = getWellnessCategory(e.ewi_score);
                          const alert = e.tl_trigger;
                          return (
                            <tr
                              key={e.id}
                              className={`hover:bg-slate-50 transition-colors ${
                                e.ewi_score <= 2 ? "bg-red-50" : e.ewi_score <= 4 ? "bg-orange-50" : ""
                              }`}
                            >
                              {/* Employee */}
                              <td className="px-5 py-3">
                                <div className="flex items-center gap-3">
                                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${e.avatarColor}`}>
                                    {e.initials}
                                  </div>
                                  <div>
                                    <p className="font-medium text-slate-800">{e.full_name}</p>
                                    <p className="text-xs text-slate-400">{e.employee_id}</p>
                                  </div>
                                </div>
                              </td>

                              {/* Account */}
                              <td className="px-4 py-3">
                                <p className="text-xs font-medium text-slate-700">{e.lob}</p>
                                <p className="text-xs text-slate-400">{e.account_name}</p>
                              </td>

                              {/* Energy */}
                              <td className="px-4 py-3 text-center">
                                <div className="flex flex-col items-center gap-0.5">
                                  <span className="text-xl">{ENERGY_ICONS[e.energy_level]}</span>
                                  <span className="text-xs text-slate-500">{ENERGY_LABELS[e.energy_level]}</span>
                                  <span className="text-[10px] text-slate-400">({e.energy_level} pts)</span>
                                </div>
                              </td>

                              {/* Feeling */}
                              <td className="px-4 py-3 text-center">
                                <div className="flex flex-col items-center gap-0.5">
                                  <span className="text-xl">{EMOTION_ICONS[e.emotion_level]}</span>
                                  <span className="text-xs text-slate-500">{EMOTION_LABELS[e.emotion_level]}</span>
                                  <span className="text-[10px] text-slate-400">({e.emotion_level} pts)</span>
                                </div>
                              </td>

                              {/* EWI */}
                              <td className="px-4 py-3 text-center">
                                <div className="flex flex-col items-center gap-1">
                                  <span className="text-lg font-semibold text-slate-800">{e.ewi_score}<span className="text-xs text-slate-400">/10</span></span>
                                  <div className="w-16 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                    <div className={`h-1.5 rounded-full ${cat.bar}`} style={{ width: `${(e.ewi_score / 10) * 100}%` }} />
                                  </div>
                                </div>
                              </td>

                              {/* Status */}
                              <td className="px-4 py-3 text-center">
                                <WellnessBadge score={e.ewi_score} />
                                <p className="text-[10px] text-slate-400 mt-1">{cat.action}</p>
                              </td>

                              {/* Alert */}
                              <td className="px-4 py-3 text-center">
                                {alert
                                  ? <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">🔔 Check-in</span>
                                  : <span className="text-xs text-slate-300">—</span>
                                }
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ══════════════ ALERTS ══════════════ */}
            {activeTab === "alerts" && (
              <div className="space-y-4">
                {isHistorical && (
                  <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Showing TL alerts as they were on <strong className="mx-1">{formatDisplay(selectedDate)}</strong>.
                  </div>
                )}

                {/* What triggers alerts */}
                <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 flex items-start gap-3">
                  <span className="text-xl flex-shrink-0">🔔</span>
                  <div>
                    <p className="text-sm font-semibold text-orange-700 mb-1">Team Leader Notification Trigger</p>
                    <p className="text-xs text-orange-600">
                      Auto-triggered when an employee selects <strong>Low Energy</strong> or <strong>Exhausted</strong>, or feels <strong>Stressed</strong> or <strong>Burned Out</strong>.
                      These employees need a check-in or coaching session today.
                    </p>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-orange-200">
                  <div className="p-5 border-b border-orange-100 flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full bg-orange-400 flex-shrink-0 ${!isHistorical && tlAlerts.length > 0 ? "animate-pulse" : ""}`} />
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-widest text-orange-400 mb-0.5">Team Leader Alerts</p>
                      <h2 className="text-base font-semibold text-slate-800">
                        Employees needing immediate check-in — {formatShort(selectedDate)}
                      </h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {tlAlerts.length} of {enriched.length} team member{enriched.length !== 1 ? "s" : ""} flagged
                      </p>
                    </div>
                  </div>

                  {tlAlerts.length === 0 ? (
                    <div className="text-center py-12">
                      <p className="text-3xl mb-2">🎉</p>
                      <p className="text-sm font-medium text-slate-600">No alerts for {formatShort(selectedDate)}.</p>
                      <p className="text-xs text-slate-400 mt-1">Your team is doing well!</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-50">
                      {tlAlerts.map((e) => {
                        const cat = getWellnessCategory(e.ewi_score);
                        return (
                          <div key={e.id} className={`flex items-center gap-4 px-5 py-4 ${e.ewi_score <= 2 ? "bg-red-50" : ""}`}>
                            {/* Avatar */}
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${e.avatarColor}`}>
                              {e.initials}
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-slate-800">
                                {e.full_name}
                                <span className="text-xs text-slate-400 font-normal ml-2">· {e.employee_id}</span>
                              </p>
                              <p className="text-xs text-slate-400">{e.lob} · {e.account_name}</p>
                              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                                <span className="flex items-center gap-1 text-xs text-slate-600">
                                  <span>{ENERGY_ICONS[e.energy_level]}</span>
                                  {ENERGY_LABELS[e.energy_level]}
                                  <span className="text-slate-400">({e.energy_level}pts)</span>
                                </span>
                                <span className="text-slate-300">·</span>
                                <span className="flex items-center gap-1 text-xs text-slate-600">
                                  <span>{EMOTION_ICONS[e.emotion_level]}</span>
                                  {EMOTION_LABELS[e.emotion_level]}
                                  <span className="text-slate-400">({e.emotion_level}pts)</span>
                                </span>
                              </div>
                            </div>

                            {/* EWI + status */}
                            <div className="text-right flex-shrink-0">
                              <p className="text-lg font-semibold text-slate-800">
                                {e.ewi_score}<span className="text-xs text-slate-400">/10</span>
                              </p>
                              <WellnessBadge score={e.ewi_score} />
                            </div>

                            {/* Action badge */}
                            <div className={`text-xs font-semibold rounded-xl px-3 py-2.5 text-center flex-shrink-0 border ${
                              e.ewi_score <= 2
                                ? "bg-red-50 border-red-100 text-red-600"
                                : "bg-orange-50 border-orange-100 text-orange-600"
                            }`}>
                              <p className="text-xl">{e.ewi_score <= 2 ? "🚨" : "🔔"}</p>
                              <p>{cat.action.split(" ")[0]}</p>
                              <p>{cat.action.split(" ").slice(1).join(" ")}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

          </>
        )}
      </div>
    </div>
  );
}
