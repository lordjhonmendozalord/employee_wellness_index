import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../src/supabaseClient";
import { useAuth } from "../src/useAuth";
import ExportSurveyButton from "./ExportSurveyButton";

// ─── Constants ────────────────────────────────────────────────────────────────
const WELLNESS_CATEGORIES = [
  { min: 9, max: 10, status: "Excellent",  action: "No Action",              color: "text-green-700",  bg: "bg-green-100",  bar: "bg-green-500"  },
  { min: 7, max: 8,  status: "Healthy",    action: "Monitor",                color: "text-teal-700",   bg: "bg-teal-100",   bar: "bg-teal-500"   },
  { min: 5, max: 6,  status: "Watchlist",  action: "Supervisor Check-in",    color: "text-yellow-700", bg: "bg-yellow-100", bar: "bg-yellow-400" },
  { min: 3, max: 4,  status: "At Risk",    action: "Coaching Required",      color: "text-orange-700", bg: "bg-orange-100", bar: "bg-orange-500" },
  { min: 0, max: 2,  status: "Critical",   action: "Immediate Intervention", color: "text-red-700",    bg: "bg-red-100",    bar: "bg-red-500"    },
];

const EMOTION_LABELS = { 5:"Excited", 4:"Happy", 3:"Motivated", 2:"Concerned", 1:"Stressed", 0:"Burned Out" };
const EMOTION_ICONS  = { 5:"😀", 4:"🟢", 3:"🔵", 2:"🟡", 1:"🟠", 0:"🔴" };
const ENERGY_LABELS  = { 5:"Highly Energized", 4:"Energized", 3:"Normal", 2:"Low Energy", 1:"Exhausted" };
const ENERGY_ICONS   = { 5:"⚡", 4:"🔋", 3:"🙂", 2:"🥱", 1:"🪫" };
const MOOD_COLORS    = { 5:"bg-blue-500", 4:"bg-green-500", 3:"bg-teal-500", 2:"bg-yellow-400", 1:"bg-orange-500", 0:"bg-red-500" };
const ENERGY_COLORS  = { 5:"bg-blue-600", 4:"bg-green-500", 3:"bg-slate-400", 2:"bg-orange-400", 1:"bg-red-500" };
const AVATAR_COLORS  = [
  "bg-blue-100 text-blue-700","bg-teal-100 text-teal-700",
  "bg-violet-100 text-violet-700","bg-amber-100 text-amber-700",
  "bg-pink-100 text-pink-700","bg-indigo-100 text-indigo-700",
];

// ─── Date helpers ─────────────────────────────────────────────────────────────
// Use LOCAL date parts — toISOString() returns UTC which causes off-by-one in UTC+8
const toISO = (d) => {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dy}`;
};
const todayISO = () => toISO(new Date());

/** Monday of the week containing `dateStr` (ISO string) */
function weekStart(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();                    // 0=Sun … 6=Sat
  const diff = day === 0 ? -6 : 1 - day;    // shift to Monday
  d.setDate(d.getDate() + diff);
  return toISO(d);
}

/** Sunday of the week containing `dateStr` */
function weekEnd(dateStr) {
  const d = new Date(weekStart(dateStr) + "T00:00:00");
  d.setDate(d.getDate() + 6);
  return toISO(d);
}

function formatDisplay(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    weekday:"long", month:"long", day:"numeric", year:"numeric",
  });
}

function formatShort(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    month:"short", day:"numeric", year:"numeric",
  });
}

function isToday(dateStr) { return dateStr === todayISO(); }

// ─── Pure helpers ─────────────────────────────────────────────────────────────
function getWellnessCategory(score) {
  return WELLNESS_CATEGORIES.find((c) => score >= c.min && score <= c.max) ?? WELLNESS_CATEGORIES[4];
}
function avatarInitials(name = "") {
  return name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}
function avatarColor(id) {
  const n = parseInt(id?.replace(/\D/g, "") || "0", 10);
  return AVATAR_COLORS[n % AVATAR_COLORS.length];
}

// ─── Supabase queries (parameterized by date) ─────────────────────────────────
async function fetchSurveyForDate(dateStr) {
  // Latest submission per employee on the selected date
  const { data, error } = await supabase
    .from("employee_survey")
    .select("*")
    .gte("created_at", `${dateStr}T00:00:00`)
    .lte("created_at", `${dateStr}T23:59:59`)
    .order("created_at", { ascending: false });

  if (error || !data) return [];
  // Keep only the latest row per employee_id
  const seen = new Set();
  const deduped = [];
  for (const row of data) {
    if (!seen.has(row.employee_id)) {
      seen.add(row.employee_id);
      deduped.push({
        ...row,
        ewi_score: row.energy_level + row.emotion_level,
        tl_trigger: row.energy_level <= 2 || row.emotion_level <= 1,
        wellness_status: getWellnessCategory(row.energy_level + row.emotion_level).status,
      });
    }
  }
  return deduped.sort((a, b) => a.ewi_score - b.ewi_score);
}

async function fetchStreaksAsOf(dateStr) {
  // For streak: look at the 6 days ending on dateStr
  const startDate = new Date(dateStr + "T00:00:00");
  startDate.setDate(startDate.getDate() - 6);
  const rangeStart = toISO(startDate);

  const { data, error } = await supabase
    .from("employee_survey")
    .select("employee_id, full_name, energy_level, emotion_level, created_at")
    .gte("created_at", `${rangeStart}T00:00:00`)
    .lte("created_at", `${dateStr}T23:59:59`)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  // Deduplicate: keep latest per employee per date
  const byEmpDate = {};
  for (const row of data) {
    const d = row.created_at.split("T")[0];
    const key = `${row.employee_id}__${d}`;
    if (!byEmpDate[key]) byEmpDate[key] = row;
  }

  // Group by employee_id
  const byEmp = {};
  for (const row of Object.values(byEmpDate)) {
    if (!byEmp[row.employee_id]) byEmp[row.employee_id] = { employee_id: row.employee_id, full_name: row.full_name, days: [] };
    byEmp[row.employee_id].days.push({ date: row.created_at.split("T")[0], energy: row.energy_level, emotion: row.emotion_level });
  }

  // Count consecutive streak ending on dateStr
  return Object.values(byEmp).map((emp) => {
    const sorted = emp.days.sort((a, b) => b.date.localeCompare(a.date)); // desc

    let burnoutStreak = 0;
    let exhaustedStreak = 0;
    let prev = dateStr;

    for (const day of sorted) {
      // Must be consecutive from dateStr backwards
      if (day.date !== prev) break;
      if (day.emotion === 0) burnoutStreak++;
      else { burnoutStreak = 0; }
      const d2 = new Date(prev + "T00:00:00");
      d2.setDate(d2.getDate() - 1);
      prev = toISO(d2);
    }

    prev = dateStr;
    for (const day of sorted) {
      if (day.date !== prev) break;
      if (day.energy === 1) exhaustedStreak++;
      else { exhaustedStreak = 0; }
      const d2 = new Date(prev + "T00:00:00");
      d2.setDate(d2.getDate() - 1);
      prev = toISO(d2);
    }

    return {
      employee_id: emp.employee_id,
      full_name: emp.full_name,
      burnout_streak: burnoutStreak,
      exhausted_streak: exhaustedStreak,
      hr_alert: burnoutStreak >= 3 || exhaustedStreak >= 3,
    };
  });
}

async function fetchTrendForWeek(dateStr) {
  const start = weekStart(dateStr);
  const end   = weekEnd(dateStr);

  const { data, error } = await supabase
    .from("employee_survey")
    .select("employee_id, energy_level, emotion_level, created_at")
    .gte("created_at", `${start}T00:00:00`)
    .lte("created_at", `${end}T23:59:59`)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  // Latest per employee per day
  const byEmpDate = {};
  for (const row of data) {
    const d = row.created_at.split("T")[0];
    const key = `${row.employee_id}__${d}`;
    if (!byEmpDate[key]) byEmpDate[key] = row;
  }

  // Group by date
  const byDate = {};
  for (const row of Object.values(byEmpDate)) {
    const d = row.created_at.split("T")[0];
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(row.energy_level + row.emotion_level);
  }

  return Object.entries(byDate)
    .map(([date, scores]) => ({
      survey_date: date,
      day_label: new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" }),
      avg_ewi: (scores.reduce((s, v) => s + v, 0) / scores.length).toFixed(2),
      respondent_count: scores.length,
    }))
    .sort((a, b) => a.survey_date.localeCompare(b.survey_date));
}

function computeDistribution(employees) {
  const total = employees.length;
  const dist  = { total_respondents: total, avg_ewi: 0 };
  ["excited","happy","motivated","concerned","stressed","burnedout"].forEach((k) => { dist[`${k}_count`] = 0; });
  ["highly_energized","energized","normal","low_energy","exhausted"].forEach((k) => { dist[`${k}_count`] = 0; });

  const emotionKeys = ["burnedout","stressed","concerned","motivated","happy","excited"];   // index = emotion_level
  const energyKeys  = ["exhausted","low_energy","normal","energized","highly_energized"];  // index = energy_level - 1? no: 1..5

  let totalEwi = 0;
  for (const e of employees) {
    dist[`${emotionKeys[e.emotion_level]}_count`]++;
    dist[`${energyKeys[e.energy_level - 1]}_count`]++;
    totalEwi += e.ewi_score;
  }
  dist.avg_ewi = total > 0 ? (totalEwi / total).toFixed(2) : "0.00";
  return dist;
}

// ─── Reusable UI ─────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon, accent = "text-blue-600", pulse }) {
  return (
    <div className="bg-slate-50 rounded-xl p-4">
      <div className="flex items-center gap-2 text-slate-400 text-xs font-medium mb-2">
        <span className={`text-base ${accent}`}>{icon}</span>
        {label}
        {pulse && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse ml-1" />}
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
        {cat.status} Workforce
      </span>
    </div>
  );
}

function WellnessBadge({ score }) {
  const cat = getWellnessCategory(score ?? 0);
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cat.bg} ${cat.color}`}>
      {cat.status}
    </span>
  );
}

function TrendChart({ data, selectedDate }) {
  if (!data?.length) return <p className="text-xs text-slate-400 text-center py-6">No data for this week.</p>;
  const scores = data.map((d) => parseFloat(d.avg_ewi));
  const minV = Math.max(0, Math.min(...scores) - 0.8);
  const maxV = Math.min(10, Math.max(...scores) + 0.8);
  const H = 80, W = 420;
  const pts = data.map((d, i) => ({
    x: 40 + (i / Math.max(data.length - 1, 1)) * (W - 60),
    y: H - ((parseFloat(d.avg_ewi) - minV) / (maxV - minV)) * (H - 10),
    ...d,
  }));
  const polyline = pts.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H + 28}`} className="w-full">
      <polyline points={polyline} fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p) => {
        const isSelected = p.survey_date === selectedDate;
        return (
          <g key={p.survey_date}>
            <circle cx={p.x} cy={p.y} r={isSelected ? 6 : 4} fill={isSelected ? "#1d4ed8" : "#3b82f6"} />
            {isSelected && <circle cx={p.x} cy={p.y} r={10} fill="none" stroke="#93c5fd" strokeWidth="2" />}
            <text x={p.x} y={p.y - 10} textAnchor="middle" fontSize="10" fill={isSelected ? "#1d4ed8" : "#64748b"} fontWeight={isSelected ? "700" : "400"}>
              {parseFloat(p.avg_ewi).toFixed(1)}
            </text>
            <text x={p.x} y={H + 18} textAnchor="middle" fontSize="10" fill={isSelected ? "#1d4ed8" : "#94a3b8"} fontWeight={isSelected ? "700" : "400"}>
              {p.day_label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
    </div>
  );
}

function EmptyState({ message }) {
  return <p className="text-sm text-slate-400 text-center py-8">{message}</p>;
}

// ─── Date Picker Bar ──────────────────────────────────────────────────────────
function DateFilterBar({ selectedDate, onChange }) {
  const inputRef = useRef(null);
  const today = todayISO();

  const yesterday = () => {
    const d = new Date(today + "T00:00:00");
    d.setDate(d.getDate() - 1);
    return toISO(d);
  };

  const shiftDay = (n) => {
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() + n);
    const shifted = toISO(d);
    if (shifted <= today) onChange(shifted);
  };

  const isHistorical = selectedDate !== today;

  return (
    <div className="bg-white border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-6 py-2.5 flex items-center gap-3 flex-wrap">
        {/* Quick buttons */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onChange(today)}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
              selectedDate === today
                ? "bg-blue-600 text-white"
                : "border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            Today
          </button>
          <button
            onClick={() => onChange(yesterday())}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
              selectedDate === yesterday()
                ? "bg-blue-600 text-white"
                : "border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            Yesterday
          </button>
        </div>

        <div className="w-px h-5 bg-slate-200" />

        {/* Prev / Next day arrows */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => shiftDay(-1)}
            className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors text-sm"
            title="Previous day"
          >
            ‹
          </button>
          <button
            onClick={() => shiftDay(1)}
            disabled={selectedDate >= today}
            className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors text-sm disabled:opacity-30 disabled:cursor-not-allowed"
            title="Next day"
          >
            ›
          </button>
        </div>

        {/* Date input */}
        <div className="flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-1.5 hover:border-blue-300 transition-colors cursor-pointer" onClick={() => inputRef.current?.showPicker?.()}>
          <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <input
            ref={inputRef}
            type="date"
            value={selectedDate}
            max={today}
            onChange={(e) => e.target.value && onChange(e.target.value)}
            className="text-xs font-medium text-slate-700 bg-transparent outline-none cursor-pointer w-28"
          />
        </div>

        {/* Context label */}
        <div className="flex items-center gap-2 ml-1">
          {isHistorical ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-amber-600 bg-amber-50 border border-amber-100 px-2.5 py-1 rounded-full">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Historical view — {formatShort(selectedDate)}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-100 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
              Live — today
            </span>
          )}
        </div>
        <ExportSurveyButton />
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function HRDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab]     = useState("overview");
  const [search, setSearch]           = useState("");
  const [loading, setLoading]         = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [showUserMenu, setShowUserMenu] = useState(false);

  // Data state
  const [employees, setEmployees] = useState([]);
  const [streaks, setStreaks]     = useState([]);
  const [trend, setTrend]         = useState([]);
  const [dist, setDist]           = useState(null);

  const fetchAll = useCallback(async (date) => {
    setLoading(true);
    const [emps, stks, trnd] = await Promise.all([
      fetchSurveyForDate(date),
      fetchStreaksAsOf(date),
      fetchTrendForWeek(date),
    ]);
    setEmployees(emps);
    setStreaks(stks);
    setTrend(trnd);
    setDist(computeDistribution(emps));
    setLoading(false);
    setLastRefresh(new Date());
  }, []);

  useEffect(() => { fetchAll(selectedDate); }, [fetchAll, selectedDate]);

  // Realtime — only subscribe for today
  useEffect(() => {
    if (selectedDate !== todayISO()) return;
    const channel = supabase
      .channel("employee_survey_changes")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "employee_survey" }, () => fetchAll(selectedDate))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [fetchAll, selectedDate]);

  const handleDateChange = (date) => {
    setSelectedDate(date);
    setSearch("");
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  // Derived
  const streakMap = Object.fromEntries(streaks.map((s) => [s.employee_id, s]));
  const enriched  = employees.map((e) => ({
    ...e,
    streak:      streakMap[e.employee_id] ?? { burnout_streak: 0, exhausted_streak: 0, hr_alert: false },
    avatarColor: avatarColor(e.employee_id),
    initials:    avatarInitials(e.full_name),
  }));

  const hrAlerts = enriched.filter((e) => e.streak.hr_alert);
  const tlAlerts = enriched.filter((e) => e.tl_trigger && !e.streak.hr_alert);
  const avgEwi   = dist ? parseFloat(dist.avg_ewi ?? 0) : 0;
  const total    = dist ? parseInt(dist.total_respondents ?? 0) : 0;

  const filtered = enriched.filter(
    (e) =>
      e.full_name?.toLowerCase().includes(search.toLowerCase()) ||
      e.employee_id?.toLowerCase().includes(search.toLowerCase()) ||
      e.lob?.toLowerCase().includes(search.toLowerCase()) ||
      e.account_name?.toLowerCase().includes(search.toLowerCase())
  );

  const isHistorical = selectedDate !== todayISO();

  const weekLabel = (() => {
    const s = weekStart(selectedDate);
    const en = weekEnd(selectedDate);
    const fmt = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${fmt(s)} – ${fmt(en)}`;
  })();

  const tabs = [
    { key: "overview",  label: "Overview" },
    { key: "employees", label: "Employees" },
    { key: "alerts",    label: `Alerts${hrAlerts.length + tlAlerts.length > 0 ? ` (${hrAlerts.length + tlAlerts.length})` : ""}` },
    { key: "scoring",   label: "Scoring Guide" },
  ];

  return (
    <div className="min-h-screen bg-slate-100 font-sans">

      {/* ── Topbar ── */}
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800 leading-tight">Wellness Check</p>
              <p className="text-xs text-slate-400 leading-tight">HR Dashboard</p>
            </div>
            <span className="ml-2 text-xs font-semibold bg-blue-600 text-white px-2.5 py-0.5 rounded-full">HR</span>
          </div>
          <div className="flex items-center gap-3">
            {lastRefresh && (
              <span className="text-xs text-slate-400 hidden md:block">
                {isHistorical ? "Loaded" : "Refreshed"} {lastRefresh.toLocaleTimeString()}
              </span>
            )}
            {!isHistorical && (
              <button
                onClick={() => fetchAll(selectedDate)}
                className="flex items-center gap-1.5 text-xs font-medium border border-slate-200 rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-50 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
            )}
            {hrAlerts.length > 0 && (
              <span className="flex items-center gap-1 text-xs font-semibold bg-red-100 text-red-700 px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block" />
                {hrAlerts.length} HR Alert{hrAlerts.length > 1 ? "s" : ""}
              </span>
            )}
            {/* User Menu */}
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-2 text-xs font-medium border border-slate-200 rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-50 transition-colors"
                title={user?.full_name}
              >
                <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-semibold">
                  {user?.full_name?.split(" ").map(w => w[0]).join("") || "?"}
                </div>
                <span className="hidden sm:inline max-w-20 truncate">{user?.full_name?.split(" ")[0] || "User"}</span>
              </button>
              {showUserMenu && (
                <div className="absolute right-0 mt-1 w-60 bg-white border border-slate-200 rounded-lg shadow-lg z-50">
                  <div className="px-4 py-3 border-b border-slate-100">
                    <p className="text-sm font-semibold text-slate-800">{user?.full_name || "User"}</p>
                    <p className="text-xs text-slate-500">{user?.email || ""}</p>
                  </div>
                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      handleLogout();
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <div className="max-w-7xl mx-auto px-6 flex gap-1 border-t border-slate-100">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === t.key
                  ? "border-blue-600 text-blue-600"
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
          <div className="max-w-7xl mx-auto px-6 py-2 flex items-center gap-2 text-xs text-amber-700">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            You are viewing a <strong className="font-semibold mx-1">historical snapshot</strong> for{" "}
            <strong className="font-semibold mx-1">{formatDisplay(selectedDate)}</strong>.
            Realtime updates are paused. Streak alerts reflect consecutive days up to and including this date.
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {loading ? <Spinner /> : (
          <>
            {/* ══════════════ OVERVIEW ══════════════ */}
            {activeTab === "overview" && (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <StatCard label="Total respondents" value={total} sub={`submitted on ${formatShort(selectedDate)}`} icon="👥" />
                  <StatCard
                    label="Workforce EWI"
                    value={total > 0 ? avgEwi.toFixed(2) : "—"}
                    sub={total > 0 ? getWellnessCategory(Math.round(avgEwi)).status : "No data"}
                    icon="📊"
                    accent="text-teal-600"
                  />
                  <StatCard label={isHistorical ? "TL notifications" : "TL notifications"} value={tlAlerts.length} sub="triggered that day" icon="🔔" accent="text-orange-500" />
                  <StatCard label="HR alerts" value={hrAlerts.length} sub="consecutive-day triggers" icon="🚨" accent="text-red-600" pulse={hrAlerts.length > 0 && !isHistorical} />
                </div>

                {total === 0 ? (
                  <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                    <p className="text-4xl mb-3">📭</p>
                    <p className="text-sm font-medium text-slate-600">No survey submissions found for {formatDisplay(selectedDate)}.</p>
                    <p className="text-xs text-slate-400 mt-1">Try selecting a different date.</p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* Mood distribution */}
                      <div className="bg-white rounded-2xl border border-slate-200 p-5">
                        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
                          Workforce Mood — {formatShort(selectedDate)}
                        </p>
                        <h2 className="text-base font-semibold text-slate-800 mb-4">Emotional level distribution</h2>
                        <div className="space-y-3">
                          {[5,4,3,2,1,0].map((lvl) => {
                            const keys = ["excited","happy","motivated","concerned","stressed","burnedout"];
                            const key  = keys[5 - lvl];
                            return (
                              <DistBar
                                key={lvl}
                                icon={EMOTION_ICONS[lvl]}
                                label={EMOTION_LABELS[lvl]}
                                count={parseInt(dist?.[`${key}_count`] ?? 0)}
                                total={total}
                                colorClass={MOOD_COLORS[lvl]}
                              />
                            );
                          })}
                        </div>
                      </div>

                      {/* Energy distribution */}
                      <div className="bg-white rounded-2xl border border-slate-200 p-5">
                        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
                          Employee Energy — {formatShort(selectedDate)}
                        </p>
                        <h2 className="text-base font-semibold text-slate-800 mb-4">Energy level distribution</h2>
                        <div className="space-y-3">
                          {[5,4,3,2,1].map((lvl) => {
                            const keys = ["highly_energized","energized","normal","low_energy","exhausted"];
                            const key  = keys[5 - lvl];
                            return (
                              <DistBar
                                key={lvl}
                                icon={ENERGY_ICONS[lvl]}
                                label={ENERGY_LABELS[lvl]}
                                count={parseInt(dist?.[`${key}_count`] ?? 0)}
                                total={total}
                                colorClass={ENERGY_COLORS[lvl]}
                              />
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* EWI Gauge */}
                      <div className="bg-white rounded-2xl border border-slate-200 p-5">
                        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">Workforce Wellness Score</p>
                        <h2 className="text-base font-semibold text-slate-800 mb-4">
                          Employee Wellness Index — {formatShort(selectedDate)}
                        </h2>
                        <EWIGauge score={avgEwi} />
                        <div className="mt-5 pt-4 border-t border-slate-100">
                          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Wellness categories</p>
                          <div className="space-y-1.5">
                            {WELLNESS_CATEGORIES.map((c) => (
                              <div key={c.status} className="flex items-center gap-2 text-xs">
                                <span className={`w-1.5 h-1.5 rounded-full ${c.bar} flex-shrink-0`} />
                                <span className="text-slate-500 w-12">{c.min}–{c.max}</span>
                                <span className={`font-semibold px-2 py-0.5 rounded-full ${c.bg} ${c.color}`}>{c.status}</span>
                                <span className="text-slate-400">{c.action}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Trend chart */}
                      <div className="bg-white rounded-2xl border border-slate-200 p-5">
                        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
                          Daily Trend — week of {weekLabel}
                        </p>
                        <h2 className="text-base font-semibold text-slate-800 mb-1">Weekly wellness score</h2>
                        <p className="text-xs text-slate-400 mb-4">
                          {isHistorical
                            ? `Showing the week containing ${formatShort(selectedDate)}. Selected day is highlighted.`
                            : "Identify burnout patterns throughout the week."}
                        </p>
                        <TrendChart data={trend} selectedDate={selectedDate} />
                        {trend.length > 0 && (
                          <div className={`mt-4 pt-3 border-t border-slate-100 grid gap-1`} style={{ gridTemplateColumns: `repeat(${trend.length}, 1fr)` }}>
                            {trend.map((d) => {
                              const s   = parseFloat(d.avg_ewi);
                              const cat = getWellnessCategory(Math.round(s));
                              const sel = d.survey_date === selectedDate;
                              return (
                                <button
                                  key={d.survey_date}
                                  onClick={() => handleDateChange(d.survey_date)}
                                  title={`View ${formatDisplay(d.survey_date)}`}
                                  className={`text-center rounded-lg py-1.5 px-1 transition-colors cursor-pointer ${
                                    sel ? "bg-blue-50 ring-1 ring-blue-200" : "hover:bg-slate-50"
                                  }`}
                                >
                                  <p className={`text-xs ${sel ? "text-blue-600 font-semibold" : "text-slate-400"}`}>{d.day_label}</p>
                                  <p className={`text-sm font-semibold ${sel ? "text-blue-700" : "text-slate-700"}`}>{s.toFixed(1)}</p>
                                  <span className={`text-[10px] font-semibold px-1 py-0.5 rounded-full ${cat.bg} ${cat.color}`}>{cat.status}</span>
                                  <p className="text-[10px] text-slate-400 mt-0.5">{d.respondent_count} resp.</p>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

            {/* ══════════════ EMPLOYEES ══════════════ */}
            {activeTab === "employees" && (
              <div className="bg-white rounded-2xl border border-slate-200">
                <div className="p-5 border-b border-slate-100 flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-0.5">Employee roster</p>
                    <h2 className="text-base font-semibold text-slate-800">
                      Wellness index for {formatDisplay(selectedDate)} — {total} respondents
                    </h2>
                  </div>
                  <input
                    type="text"
                    placeholder="Search name, ID, LOB, account…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="text-sm border border-slate-200 rounded-lg px-3 py-2 w-64 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                </div>
                {filtered.length === 0
                  ? <EmptyState message={total === 0 ? `No submissions on ${formatDisplay(selectedDate)}.` : "No employees match your search."} />
                  : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs text-slate-400 uppercase tracking-wider border-b border-slate-100">
                            <th className="text-left px-5 py-3 font-medium">Employee</th>
                            <th className="text-left px-4 py-3 font-medium">LOB / Account</th>
                            <th className="text-left px-4 py-3 font-medium">Energy</th>
                            <th className="text-left px-4 py-3 font-medium">Emotion</th>
                            <th className="text-center px-4 py-3 font-medium">EWI</th>
                            <th className="text-center px-4 py-3 font-medium">Status</th>
                            <th className="text-center px-4 py-3 font-medium">Trigger</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {filtered.map((e) => {
                            const isHR = e.streak.hr_alert;
                            const isTL = e.tl_trigger && !isHR;
                            return (
                              <tr key={e.id} className={`hover:bg-slate-50 transition-colors ${isHR ? "bg-red-50" : ""}`}>
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
                                <td className="px-4 py-3">
                                  <p className="text-xs text-slate-700 font-medium">{e.lob}</p>
                                  <p className="text-xs text-slate-400">{e.account_name}</p>
                                </td>
                                <td className="px-4 py-3">
                                  <span className="text-base mr-1">{ENERGY_ICONS[e.energy_level]}</span>
                                  <span className="text-xs text-slate-600">{ENERGY_LABELS[e.energy_level]}</span>
                                  <span className="text-xs text-slate-400 ml-1">({e.energy_level})</span>
                                </td>
                                <td className="px-4 py-3">
                                  <span className="text-base mr-1">{EMOTION_ICONS[e.emotion_level]}</span>
                                  <span className="text-xs text-slate-600">{EMOTION_LABELS[e.emotion_level]}</span>
                                  <span className="text-xs text-slate-400 ml-1">({e.emotion_level})</span>
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <span className="font-semibold text-slate-800">{e.ewi_score}</span>
                                  <span className="text-slate-400 text-xs">/10</span>
                                </td>
                                <td className="px-4 py-3 text-center"><WellnessBadge score={e.ewi_score} /></td>
                                <td className="px-4 py-3 text-center">
                                  {isHR && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">🚨 HR Alert</span>}
                                  {isTL && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">🔔 TL Notified</span>}
                                  {!isHR && !isTL && <span className="text-xs text-slate-300">—</span>}
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
                    Showing alerts as they were on <strong className="mx-1">{formatDisplay(selectedDate)}</strong>.
                    Streaks are calculated against consecutive days up to and including this date.
                  </div>
                )}

                {/* HR Alerts */}
                <div className="bg-white rounded-2xl border border-red-200">
                  <div className="p-5 border-b border-red-100 flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full bg-red-500 flex-shrink-0 ${!isHistorical ? "animate-pulse" : ""}`} />
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-widest text-red-400 mb-0.5">HR Alert</p>
                      <h2 className="text-base font-semibold text-slate-800">Consecutive-day triggers — Immediate action required</h2>
                      <p className="text-xs text-slate-400 mt-0.5">Burned Out or Exhausted for 3+ consecutive days ending {formatShort(selectedDate)}</p>
                    </div>
                  </div>
                  {hrAlerts.length === 0
                    ? <EmptyState message="No HR alerts for this date. 🎉" />
                    : hrAlerts.map((e) => (
                      <div key={e.id} className="flex items-center gap-4 px-5 py-4 border-b border-slate-50 last:border-0">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold ${e.avatarColor}`}>{e.initials}</div>
                        <div className="flex-1">
                          <p className="font-medium text-slate-800">{e.full_name} <span className="text-xs text-slate-400 font-normal">· {e.employee_id}</span></p>
                          <p className="text-xs text-slate-400">{e.lob} · {e.account_name}</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {EMOTION_ICONS[e.emotion_level]} {EMOTION_LABELS[e.emotion_level]}&nbsp;·&nbsp;
                            {ENERGY_ICONS[e.energy_level]} {ENERGY_LABELS[e.energy_level]}
                          </p>
                          {e.streak.burnout_streak >= 3 && (
                            <p className="text-xs text-red-600 mt-0.5">🔴 Burned Out for {e.streak.burnout_streak} consecutive days</p>
                          )}
                          {e.streak.exhausted_streak >= 3 && (
                            <p className="text-xs text-red-600 mt-0.5">😴 Exhausted for {e.streak.exhausted_streak} consecutive days</p>
                          )}
                        </div>
                        <div className="text-right">
                          <WellnessBadge score={e.ewi_score} />
                          <p className="text-xs text-slate-400 mt-1">EWI: {e.ewi_score}/10</p>
                        </div>
                        <div className="text-xs text-red-600 font-semibold bg-red-50 border border-red-100 rounded-xl px-3 py-2 text-center flex-shrink-0">
                          <p className="text-xl">🚨</p>
                          <p>Immediate</p>
                          <p>Intervention</p>
                        </div>
                      </div>
                    ))}
                </div>

                {/* TL Notifications */}
                <div className="bg-white rounded-2xl border border-orange-200">
                  <div className="p-5 border-b border-orange-100 flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-orange-400 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-widest text-orange-400 mb-0.5">Team Leader Notification</p>
                      <h2 className="text-base font-semibold text-slate-800">Auto-triggered alerts sent to team leaders</h2>
                      <p className="text-xs text-slate-400 mt-0.5">Low Energy, Exhausted, Stressed, or Burned Out on {formatShort(selectedDate)}</p>
                    </div>
                  </div>
                  {tlAlerts.length === 0
                    ? <EmptyState message="No TL notifications for this date." />
                    : tlAlerts.map((e) => (
                      <div key={e.id} className="flex items-center gap-4 px-5 py-4 border-b border-slate-50 last:border-0">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold ${e.avatarColor}`}>{e.initials}</div>
                        <div className="flex-1">
                          <p className="font-medium text-slate-800">{e.full_name} <span className="text-xs text-slate-400 font-normal">· {e.employee_id}</span></p>
                          <p className="text-xs text-slate-400">{e.lob} · {e.account_name}</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {EMOTION_ICONS[e.emotion_level]} {EMOTION_LABELS[e.emotion_level]}&nbsp;·&nbsp;
                            {ENERGY_ICONS[e.energy_level]} {ENERGY_LABELS[e.energy_level]}
                          </p>
                        </div>
                        <div className="text-right">
                          <WellnessBadge score={e.ewi_score} />
                          <p className="text-xs text-slate-400 mt-1">EWI: {e.ewi_score}/10</p>
                        </div>
                        <div className="text-xs text-orange-600 font-semibold bg-orange-50 border border-orange-100 rounded-xl px-3 py-2 text-center flex-shrink-0">
                          <p className="text-xl">🔔</p>
                          <p>TL</p>
                          <p>Notified</p>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* ══════════════ SCORING GUIDE ══════════════ */}
            {activeTab === "scoring" && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-white rounded-2xl border border-slate-200 p-5">
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Energy score</p>
                  <table className="w-full text-sm">
                    <thead><tr className="text-xs text-slate-400 border-b border-slate-100"><th className="text-left py-2 font-medium">Response</th><th className="py-2">Icon</th><th className="text-right py-2 font-medium">Points</th></tr></thead>
                    <tbody className="divide-y divide-slate-50">
                      {[5,4,3,2,1].map((lvl) => (
                        <tr key={lvl}><td className="py-2.5 text-slate-700">{ENERGY_LABELS[lvl]}</td><td className="py-2.5 text-center">{ENERGY_ICONS[lvl]}</td><td className="py-2.5 text-right font-semibold text-slate-800">{lvl}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 p-5">
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Emotion score</p>
                  <table className="w-full text-sm">
                    <thead><tr className="text-xs text-slate-400 border-b border-slate-100"><th className="text-left py-2 font-medium">Emotion</th><th className="py-2">Icon</th><th className="text-right py-2 font-medium">Points</th></tr></thead>
                    <tbody className="divide-y divide-slate-50">
                      {[5,4,3,2,1,0].map((lvl) => (
                        <tr key={lvl}><td className="py-2.5 text-slate-700">{EMOTION_LABELS[lvl]}</td><td className="py-2.5 text-center">{EMOTION_ICONS[lvl]}</td><td className="py-2.5 text-right font-semibold text-slate-800">{lvl}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 p-5 lg:col-span-2">
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Employee Wellness Index (EWI)</p>
                  <div className="bg-slate-50 rounded-xl px-5 py-4 mb-5 font-mono text-sm text-slate-700">
                    <p>EWI = energy_level + emotion_level &nbsp; (max 10)</p>
                    <div className="mt-3 pt-3 border-t border-slate-200 text-xs">
                      <p><span className="text-slate-400">e.g.</span> energy_level=4 + emotion_level=4 → <span className="font-semibold text-blue-600">EWI = 8 / 10 → Healthy</span></p>
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead><tr className="text-xs text-slate-400 border-b border-slate-100"><th className="text-left py-2 font-medium">Score</th><th className="text-left py-2 font-medium">Status</th><th className="text-left py-2 font-medium">Required action</th></tr></thead>
                    <tbody className="divide-y divide-slate-50">
                      {WELLNESS_CATEGORIES.map((c) => (
                        <tr key={c.status}>
                          <td className="py-2.5 font-semibold text-slate-700">{c.min}–{c.max}</td>
                          <td className="py-2.5"><span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${c.bg} ${c.color}`}>{c.status}</span></td>
                          <td className="py-2.5 text-slate-500">{c.action}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 p-5 lg:col-span-2">
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Automated risk triggers</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="bg-orange-50 border border-orange-100 rounded-xl p-4">
                      <p className="text-xs font-semibold text-orange-600 mb-2">🔔 Team Leader notification</p>
                      <ul className="text-xs text-slate-700 space-y-1">
                        {["energy_level ≤ 2 (Low Energy / Exhausted)", "emotion_level ≤ 1 (Stressed / Burned Out)"].map((t) => (
                          <li key={t} className="flex items-start gap-2"><span className="w-1.5 h-1.5 rounded-full bg-orange-400 flex-shrink-0 mt-1" />{t}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="bg-red-50 border border-red-100 rounded-xl p-4">
                      <p className="text-xs font-semibold text-red-600 mb-2">🚨 HR Alert — streak-based</p>
                      <ul className="text-xs text-slate-700 space-y-1">
                        {["Burned Out (emotion_level=0) for 3 consecutive days", "Exhausted (energy_level=1) for 3 consecutive days"].map((t) => (
                          <li key={t} className="flex items-start gap-2"><span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0 mt-1" />{t}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}