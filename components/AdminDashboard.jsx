import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../src/supabaseClient";
import { useAuth } from "../src/useAuth";

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

const ROLES = ["Team Leader", "HR", "Admin"];

// ─── Date helpers ─────────────────────────────────────────────────────────────
const toISO = (d) => {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dy}`;
};
const todayISO = () => toISO(new Date());

function weekStart(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toISO(d);
}
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

// ─── Supabase queries ─────────────────────────────────────────────────────────
async function fetchSurveyForDate(dateStr) {
  const { data, error } = await supabase
    .from("employee_survey")
    .select("*")
    .gte("created_at", `${dateStr}T00:00:00`)
    .lte("created_at", `${dateStr}T23:59:59`)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
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
  const byEmpDate = {};
  for (const row of data) {
    const d = row.created_at.split("T")[0];
    const key = `${row.employee_id}__${d}`;
    if (!byEmpDate[key]) byEmpDate[key] = row;
  }
  const byEmp = {};
  for (const row of Object.values(byEmpDate)) {
    if (!byEmp[row.employee_id]) byEmp[row.employee_id] = { employee_id: row.employee_id, full_name: row.full_name, days: [] };
    byEmp[row.employee_id].days.push({ date: row.created_at.split("T")[0], energy: row.energy_level, emotion: row.emotion_level });
  }
  return Object.values(byEmp).map((emp) => {
    const sorted = emp.days.sort((a, b) => b.date.localeCompare(a.date));
    let burnoutStreak = 0, exhaustedStreak = 0, prev = dateStr;
    for (const day of sorted) {
      if (day.date !== prev) break;
      if (day.emotion === 0) burnoutStreak++; else burnoutStreak = 0;
      const d2 = new Date(prev + "T00:00:00"); d2.setDate(d2.getDate() - 1); prev = toISO(d2);
    }
    prev = dateStr;
    for (const day of sorted) {
      if (day.date !== prev) break;
      if (day.energy === 1) exhaustedStreak++; else exhaustedStreak = 0;
      const d2 = new Date(prev + "T00:00:00"); d2.setDate(d2.getDate() - 1); prev = toISO(d2);
    }
    return { employee_id: emp.employee_id, full_name: emp.full_name, burnout_streak: burnoutStreak, exhausted_streak: exhaustedStreak, hr_alert: burnoutStreak >= 3 || exhaustedStreak >= 3 };
  });
}

async function fetchTrendForWeek(dateStr) {
  const start = weekStart(dateStr), end = weekEnd(dateStr);
  const { data, error } = await supabase
    .from("employee_survey")
    .select("employee_id, energy_level, emotion_level, created_at")
    .gte("created_at", `${start}T00:00:00`)
    .lte("created_at", `${end}T23:59:59`)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  const byEmpDate = {};
  for (const row of data) {
    const d = row.created_at.split("T")[0];
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
  const emotionKeys = ["burnedout","stressed","concerned","motivated","happy","excited"];
  const energyKeys  = ["exhausted","low_energy","normal","energized","highly_energized"];
  let totalEwi = 0;
  for (const e of employees) {
    dist[`${emotionKeys[e.emotion_level]}_count`]++;
    dist[`${energyKeys[e.energy_level - 1]}_count`]++;
    totalEwi += e.ewi_score;
  }
  dist.avg_ewi = total > 0 ? (totalEwi / total).toFixed(2) : "0.00";
  return dist;
}

// ─── Fetch all users (admin) ──────────────────────────────────────────────────
async function fetchAllUsers() {
  const { data, error } = await supabase
    .from("system_users")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return { data: null, error };
  return { data, error: null };
}

// ─── Shared UI Components ─────────────────────────────────────────────────────
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
  const yesterday = () => { const d = new Date(today + "T00:00:00"); d.setDate(d.getDate() - 1); return toISO(d); };
  const shiftDay = (n) => { const d = new Date(selectedDate + "T00:00:00"); d.setDate(d.getDate() + n); const s = toISO(d); if (s <= today) onChange(s); };
  const isHistorical = selectedDate !== today;
  return (
    <div className="bg-white border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-6 py-2.5 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <button onClick={() => onChange(today)} className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${selectedDate === today ? "bg-blue-600 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>Today</button>
          <button onClick={() => onChange(yesterday())} className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${selectedDate === yesterday() ? "bg-blue-600 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>Yesterday</button>
        </div>
        <div className="w-px h-5 bg-slate-200" />
        <div className="flex items-center gap-1">
          <button onClick={() => shiftDay(-1)} className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 text-sm">‹</button>
          <button onClick={() => shiftDay(1)} disabled={selectedDate >= today} className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 text-sm disabled:opacity-30 disabled:cursor-not-allowed">›</button>
        </div>
        <div className="flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-1.5 hover:border-blue-300 cursor-pointer" onClick={() => inputRef.current?.showPicker?.()}>
          <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          <input ref={inputRef} type="date" value={selectedDate} max={today} onChange={(e) => e.target.value && onChange(e.target.value)} className="text-xs font-medium text-slate-700 bg-transparent outline-none cursor-pointer w-28" />
        </div>
        <div className="flex items-center gap-2 ml-1">
          {isHistorical ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-amber-600 bg-amber-50 border border-amber-100 px-2.5 py-1 rounded-full">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              Historical view — {formatShort(selectedDate)}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-100 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
              Live — today
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── User Modal ───────────────────────────────────────────────────────────────
const EMPTY_USER = { full_name: "", email: "", password: "", role: "Team Leader" };

function UserModal({ mode, user, onClose, onSave }) {
  const [form, setForm] = useState(mode === "add" ? EMPTY_USER : { ...user });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.full_name.trim() || !form.email.trim()) {
      setError("Full Name and Email are required.");
      return;
    }
    if (mode === "add" && !form.password.trim()) {
      setError("Password is required for new users.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(form, mode);
      onClose();
    } catch (e) {
      setError(e.message || "Failed to save user.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              {mode === "add" ? "New User" : "Delete User"}
            </p>
            <h3 className="text-base font-semibold text-slate-800 mt-0.5">
              {mode === "add" ? "Add a new user" : `Remove ${user?.full_name}?`}
            </h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors text-lg">×</button>
        </div>

        {mode === "delete" ? (
          <div className="px-6 py-6">
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-5">
              <p className="text-sm text-red-700">This action permanently removes <strong>{user?.full_name}</strong> from the system. Their data cannot be recovered.</p>
            </div>
            {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50">
                {saving ? "Removing…" : "Remove user"}
              </button>
            </div>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-4">
            <div>
              <label className="text-xs font-medium text-slate-500 block mb-1">Full Name *</label>
              <input 
                value={form.full_name} 
                onChange={(e) => set("full_name", e.target.value)} 
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200" 
                placeholder="John Smith" 
              />
            </div>

            <div>
              <label className="text-xs font-medium text-slate-500 block mb-1">Email Address *</label>
              <input 
                type="email" 
                value={form.email} 
                onChange={(e) => set("email", e.target.value)} 
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200" 
                placeholder="john@company.com" 
              />
            </div>

            <div>
              <label className="text-xs font-medium text-slate-500 block mb-1">Password *</label>
              <div className="relative">
                <input 
                  type={showPassword ? "text" : "password"}
                  value={form.password} 
                  onChange={(e) => set("password", e.target.value)} 
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200 pr-10" 
                  placeholder="••••••••" 
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-500 block mb-1">Role *</label>
              <select 
                value={form.role} 
                onChange={(e) => set("role", e.target.value)} 
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white"
              >
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
            
            <div className="flex gap-2 justify-end pt-1 border-t border-slate-100">
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50">
                {saving ? "Creating…" : "Create user"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── User Management Page ─────────────────────────────────────────────────────
function UserManagementPage() {
  const [users, setUsers]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState("");
  const [roleFilter, setRoleFilter] = useState("All");
  const [modal, setModal]         = useState(null); // { mode, user }
  const [toast, setToast]         = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = async () => {
    setLoading(true);
    const { data, error } = await fetchAllUsers();
    if (!error && data) setUsers(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSave = async (form, mode) => {
    if (mode === "add") {
      try {
        // Step 1: Create Supabase Auth user
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
          email: form.email,
          password: form.password,
          email_confirm: true,
        });

        if (authError) {
          throw new Error(`Auth error: ${authError.message}`);
        }

        // Step 2: Create system_users entry
        const { error: dbError } = await supabase.from("system_users").insert([{
          email: form.email,
          full_name: form.full_name,
          role: form.role,
          lob: null,
          account_name: null,
          is_active: true,
        }]);

        if (dbError) {
          throw new Error(`Database error: ${dbError.message}`);
        }

        showToast(`${form.full_name} created successfully.`);
      } catch (err) {
        throw new Error(err.message || "Failed to create user");
      }
    } else if (mode === "delete") {
      try {
        // Delete from system_users first
        const { error: dbError } = await supabase.from("system_users").delete().eq("id", form.id);
        if (dbError) throw new Error(`Database error: ${dbError.message}`);

        // Delete Supabase Auth user (if available through Admin API)
        // Note: This may require admin privileges
        showToast(`${form.full_name} removed.`, "error");
      } catch (err) {
        throw new Error(err.message || "Failed to delete user");
      }
    }
    await load();
  };

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    const matchQ = u.full_name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q);
    const matchR = roleFilter === "All" || u.role === roleFilter.toLowerCase();
    return matchQ && matchR;
  });

  const roleCounts = ROLES.reduce((acc, r) => { 
    acc[r] = users.filter((u) => u.role === r.toLowerCase()).length; 
    return acc; 
  }, {});

  const ROLE_BADGE = {
    "team leader": "bg-indigo-100 text-indigo-700",
    hr:            "bg-blue-100 text-blue-700",
    admin:         "bg-slate-100 text-slate-700",
  };

  return (
    <div className="space-y-5">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all ${toast.type === "error" ? "bg-red-600 text-white" : "bg-green-600 text-white"}`}>
          <span>{toast.type === "error" ? "🗑" : "✓"}</span>
          {toast.msg}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total users" value={users.length} sub="registered in the system" icon="👥" />
        <StatCard label="Team Leaders" value={roleCounts["Team Leader"] ?? 0} sub="assigned to teams" icon="👥" accent="text-indigo-600" />
        <StatCard label="HR Managers" value={roleCounts["HR"] ?? 0} sub="wellness oversight" icon="🛡️" accent="text-blue-600" />
        <StatCard label="Admins" value={roleCounts["Admin"] ?? 0} sub="system administrators" icon="⚙️" accent="text-slate-600" />
      </div>

      {/* Table card */}
      <div className="bg-white rounded-2xl border border-slate-200">
        <div className="p-5 border-b border-slate-100 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-0.5">User Management</p>
            <h2 className="text-base font-semibold text-slate-800">All employees & staff accounts</h2>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Role filter pills */}
            <div className="flex items-center gap-1">
              {["All", ...ROLES].map((r) => (
                <button key={r} onClick={() => setRoleFilter(r)} className={`text-xs font-medium px-2.5 py-1 rounded-lg transition-colors ${roleFilter === r ? "bg-blue-600 text-white" : "border border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
                  {r}{r !== "All" && ` (${roleCounts[r] ?? 0})`}
                </button>
              ))}
            </div>
            <input type="text" placeholder="Search name, email…" value={search} onChange={(e) => setSearch(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-2 w-52 focus:outline-none focus:ring-2 focus:ring-blue-200" />
            <button onClick={() => setModal({ mode: "add", user: null })} className="flex items-center gap-1.5 text-sm font-medium bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Add user
            </button>
          </div>
        </div>

        {loading ? <Spinner /> : filtered.length === 0 ? (
          <EmptyState message={users.length === 0 ? "No users found. Add your first user." : "No users match your search."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-400 uppercase tracking-wider border-b border-slate-100">
                  <th className="text-left px-5 py-3 font-medium">User</th>
                  <th className="text-left px-4 py-3 font-medium">Email</th>
                  <th className="text-center px-4 py-3 font-medium">Role</th>
                  <th className="text-center px-4 py-3 font-medium">Joined</th>
                  <th className="text-center px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((u) => {
                  const color = avatarColor(u.id);
                  return (
                    <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${color}`}>
                            {avatarInitials(u.full_name)}
                          </div>
                          <p className="font-medium text-slate-800">{u.full_name}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{u.email || <span className="text-slate-300">—</span>}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${u.role === "admin" ? "bg-slate-100 text-slate-700" : u.role === "hr" ? "bg-blue-100 text-blue-700" : "bg-indigo-100 text-indigo-700"}`}>
                          {u.role === "tl" ? "Team Leader" : u.role.charAt(0).toUpperCase() + u.role.slice(1)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-slate-400">
                        {u.created_at ? new Date(u.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => setModal({ mode: "delete", user: u })} className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors" title="Remove">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer count */}
        {!loading && users.length > 0 && (
          <div className="px-5 py-3 border-t border-slate-100 text-xs text-slate-400">
            Showing {filtered.length} of {users.length} users{roleFilter !== "All" ? ` · filtered by ${roleFilter}` : ""}
          </div>
        )}
      </div>

      {modal && (
        <UserModal
          mode={modal.mode}
          user={modal.user}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

// ─── System Settings Page ──────────────────────────────────────────────────────
function SystemSettingsPage() {
  const [saved, setSaved] = useState(false);
  const [settings, setSettings] = useState({
    tl_energy_threshold: 2,
    tl_emotion_threshold: 1,
    hr_streak_days: 3,
    survey_window_start: "08:00",
    survey_window_end: "09:00",
    allow_multiple_submissions: false,
    notify_tl_email: true,
    notify_hr_email: true,
  });
  const set = (k, v) => setSettings((s) => ({ ...s, [k]: v }));

  return (
    <div className="space-y-4 max-w-2xl">
      {saved && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700 flex items-center gap-2">
          <span>✓</span> Settings saved successfully.
        </div>
      )}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">Alert thresholds</p>
        <h3 className="text-base font-semibold text-slate-800 mb-4">Trigger configuration</h3>
        <div className="space-y-4">
          {[
            { label: "TL notification — energy threshold (≤)", key: "tl_energy_threshold", min: 1, max: 4, hint: "Employees at or below this energy level trigger a TL notification." },
            { label: "TL notification — emotion threshold (≤)", key: "tl_emotion_threshold", min: 0, max: 3, hint: "Employees at or below this emotion level trigger a TL notification." },
            { label: "HR alert — consecutive days", key: "hr_streak_days", min: 2, max: 7, hint: "Days of consecutive burnout/exhaustion before an HR alert fires." },
          ].map(({ label, key, min, max, hint }) => (
            <div key={key}>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-slate-700">{label}</label>
                <span className="text-sm font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg">{settings[key]}</span>
              </div>
              <input type="range" min={min} max={max} value={settings[key]} onChange={(e) => set(key, parseInt(e.target.value))} className="w-full accent-blue-600" />
              <p className="text-xs text-slate-400 mt-1">{hint}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">Survey window</p>
        <h3 className="text-base font-semibold text-slate-800 mb-4">Submission time gate</h3>
        <div className="grid grid-cols-2 gap-3">
          {[["Opens at", "survey_window_start"], ["Closes at", "survey_window_end"]].map(([label, key]) => (
            <div key={key}>
              <label className="text-xs font-medium text-slate-500 block mb-1">{label}</label>
              <input type="time" value={settings[key]} onChange={(e) => set(key, e.target.value)} className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200" />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-4">
          <button onClick={() => set("allow_multiple_submissions", !settings.allow_multiple_submissions)} className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${settings.allow_multiple_submissions ? "bg-blue-600" : "bg-slate-200"}`}>
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${settings.allow_multiple_submissions ? "translate-x-5" : ""}`} />
          </button>
          <span className="text-sm text-slate-700">Allow multiple submissions per day</span>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">Notifications</p>
        <h3 className="text-base font-semibold text-slate-800 mb-4">Email alert routing</h3>
        {[["notify_tl_email", "Send email to Team Leader on TL trigger"], ["notify_hr_email", "Send email to HR on HR streak alert"]].map(([key, label]) => (
          <div key={key} className="flex items-center gap-2 mb-3">
            <button onClick={() => set(key, !settings[key])} className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${settings[key] ? "bg-blue-600" : "bg-slate-200"}`}>
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${settings[key] ? "translate-x-5" : ""}`} />
            </button>
            <span className="text-sm text-slate-700">{label}</span>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <button onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 3000); }} className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
          Save settings
        </button>
      </div>
    </div>
  );
}

// ─── Audit Log Page ───────────────────────────────────────────────────────────
function AuditLogPage() {
  // Simulated audit log — in production, pull from a `audit_logs` table
  const logs = [
    { id: 1, action: "User created", target: "EMP-0042 · Maria Santos", actor: "admin@co.com", ts: "2025-06-14 09:12", type: "create" },
    { id: 2, action: "Role changed → HR", target: "EMP-0018 · Jose Reyes", actor: "admin@co.com", ts: "2025-06-13 14:03", type: "edit" },
    { id: 3, action: "User deactivated", target: "EMP-0031 · Carla Cruz", actor: "admin@co.com", ts: "2025-06-12 11:55", type: "delete" },
    { id: 4, action: "Settings updated", target: "HR streak threshold → 3 days", actor: "admin@co.com", ts: "2025-06-11 08:30", type: "settings" },
    { id: 5, action: "User deleted", target: "EMP-0007 · Ramon Bautista", actor: "admin@co.com", ts: "2025-06-10 16:47", type: "delete" },
    { id: 6, action: "User created", target: "EMP-0043 · Ana Villanueva", actor: "admin@co.com", ts: "2025-06-09 10:21", type: "create" },
  ];
  const TYPE_STYLE = { create: "bg-green-100 text-green-700", edit: "bg-blue-100 text-blue-700", delete: "bg-red-100 text-red-700", settings: "bg-purple-100 text-purple-700" };
  const TYPE_ICON  = { create: "➕", edit: "✏️", delete: "🗑", settings: "⚙️" };

  return (
    <div className="bg-white rounded-2xl border border-slate-200">
      <div className="p-5 border-b border-slate-100">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-0.5">Audit Log</p>
        <h2 className="text-base font-semibold text-slate-800">Admin activity history</h2>
        <p className="text-xs text-slate-400 mt-0.5">All system changes made by administrators. Simulated — wire to your audit_logs table in production.</p>
      </div>
      <div className="divide-y divide-slate-50">
        {logs.map((l) => (
          <div key={l.id} className="flex items-center gap-4 px-5 py-4">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0 ${TYPE_STYLE[l.type]}`}>{TYPE_ICON[l.type]}</div>
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-800">{l.action}</p>
              <p className="text-xs text-slate-400">{l.target}</p>
            </div>
            <div className="text-right text-xs text-slate-400">
              <p>{l.actor}</p>
              <p className="text-slate-300">{l.ts}</p>
            </div>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TYPE_STYLE[l.type]} flex-shrink-0`}>{l.type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Admin Dashboard ─────────────────────────────────────────────────────
export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [activePage, setActivePage] = useState("overview");
  const [activeTab, setActiveTab]   = useState("overview");
  const [search, setSearch]         = useState("");
  const [loading, setLoading]       = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [showUserMenu, setShowUserMenu] = useState(false);

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

  useEffect(() => {
    if (selectedDate !== todayISO()) return;
    const channel = supabase
      .channel("employee_survey_changes_admin")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "employee_survey" }, () => fetchAll(selectedDate))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [fetchAll, selectedDate]);

  const handleDateChange = (date) => { setSelectedDate(date); setSearch(""); };

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

  const filtered = enriched.filter((e) =>
    e.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    e.employee_id?.toLowerCase().includes(search.toLowerCase()) ||
    e.lob?.toLowerCase().includes(search.toLowerCase()) ||
    e.account_name?.toLowerCase().includes(search.toLowerCase())
  );

  const isHistorical = selectedDate !== todayISO();

  const weekLabel = (() => {
    const s = weekStart(selectedDate), en = weekEnd(selectedDate);
    const fmt = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${fmt(s)} – ${fmt(en)}`;
  })();

  // Nav pages
  const NAV = [
    { key: "overview",  label: "Dashboard",      icon: "📊" },
    { key: "users",     label: "User Management", icon: "👤" },
    { key: "audit",     label: "Audit Log",       icon: "📋" },
    { key: "settings",  label: "System Settings", icon: "⚙️" },
  ];

  // HR Dashboard tabs (only shown on overview page)
  const HR_TABS = [
    { key: "overview",  label: "Overview" },
    { key: "employees", label: "Employees" },
    { key: "alerts",    label: `Alerts${hrAlerts.length + tlAlerts.length > 0 ? ` (${hrAlerts.length + tlAlerts.length})` : ""}` },
    { key: "scoring",   label: "Scoring Guide" },
  ];

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-100 font-sans flex">

      {/* ── Sidebar ── */}
      <aside className="w-56 bg-white border-r border-slate-200 flex flex-col sticky top-0 h-screen z-20">
        {/* Logo */}
        <div className="px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-violet-100 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800 leading-tight">Wellness Check</p>
              <p className="text-xs text-slate-400 leading-tight">Admin Portal</p>
            </div>
          </div>
          <span className="mt-2 inline-block text-xs font-semibold bg-violet-600 text-white px-2 py-0.5 rounded-full">ADMIN</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV.map((n) => (
            <button
              key={n.key}
              onClick={() => setActivePage(n.key)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left ${
                activePage === n.key
                  ? "bg-violet-50 text-violet-700"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              }`}
            >
              <span className="text-base">{n.icon}</span>
              {n.label}
              {n.key === "overview" && hrAlerts.length > 0 && (
                <span className="ml-auto text-xs font-semibold bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">
                  {hrAlerts.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Admin chip */}
        <div className="px-3 py-4 border-t border-slate-100">
          <button onClick={() => setShowUserMenu(!showUserMenu)} className="w-full flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 rounded-xl transition-colors relative">
            <div className="w-7 h-7 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center text-xs font-semibold flex-shrink-0">
              {user?.full_name?.split(" ").map(w => w[0]).join("") || "A"}
            </div>
            <div className="min-w-0 text-left flex-1">
              <p className="text-xs font-semibold text-slate-700 truncate">{user?.full_name?.split(" ")[0] || "Admin"}</p>
              <p className="text-[10px] text-slate-400 truncate">Full access</p>
            </div>
            {showUserMenu && (
              <div className="absolute bottom-full mb-2 w-55 bg-white border border-slate-200 rounded-lg shadow-lg z-50">
                <div className="px-4 py-3 border-b border-slate-100">
                  <p className="text-sm font-semibold text-slate-800">{user?.full_name || "Admin"}</p>
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
          </button>
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Top bar */}
        <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
          <div className="px-6 h-14 flex items-center justify-between">
            <div>
              <h1 className="text-sm font-semibold text-slate-800">
                {NAV.find((n) => n.key === activePage)?.label}
              </h1>
              {activePage === "overview" && (
                <p className="text-xs text-slate-400">
                  {isHistorical ? `Historical — ${formatShort(selectedDate)}` : "Live view · auto-refreshing"}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              {lastRefresh && activePage === "overview" && (
                <span className="text-xs text-slate-400 hidden md:block">
                  {isHistorical ? "Loaded" : "Refreshed"} {lastRefresh.toLocaleTimeString()}
                </span>
              )}
              {activePage === "overview" && !isHistorical && (
                <button onClick={() => fetchAll(selectedDate)} className="flex items-center gap-1.5 text-xs font-medium border border-slate-200 rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-50 transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  Refresh
                </button>
              )}
              {hrAlerts.length > 0 && activePage === "overview" && (
                <span className="flex items-center gap-1 text-xs font-semibold bg-red-100 text-red-700 px-2.5 py-1 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block" />
                  {hrAlerts.length} HR Alert{hrAlerts.length > 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>

          {/* Tabs only on overview page */}
          {activePage === "overview" && (
            <div className="px-6 flex gap-1 border-t border-slate-100">
              {HR_TABS.map((t) => (
                <button key={t.key} onClick={() => setActiveTab(t.key)} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === t.key ? "border-violet-600 text-violet-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </header>

        {/* Date bar — only on dashboard */}
        {activePage === "overview" && (
          <DateFilterBar selectedDate={selectedDate} onChange={handleDateChange} />
        )}

        {/* Historical banner */}
        {activePage === "overview" && isHistorical && (
          <div className="bg-amber-50 border-b border-amber-100">
            <div className="px-6 py-2 flex items-center gap-2 text-xs text-amber-700">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              Historical snapshot for <strong className="font-semibold mx-1">{formatDisplay(selectedDate)}</strong>. Realtime paused. Streak alerts reflect consecutive days up to this date.
            </div>
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 px-6 py-6 space-y-5 overflow-auto">

          {/* ── USER MANAGEMENT ── */}
          {activePage === "users" && <UserManagementPage />}

          {/* ── AUDIT LOG ── */}
          {activePage === "audit" && <AuditLogPage />}

          {/* ── SYSTEM SETTINGS ── */}
          {activePage === "settings" && <SystemSettingsPage />}

          {/* ── HR DASHBOARD (overview page) ── */}
          {activePage === "overview" && (
            loading ? <Spinner /> : (
              <>
                {/* OVERVIEW TAB */}
                {activeTab === "overview" && (
                  <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                      <StatCard label="Total respondents" value={total} sub={`submitted on ${formatShort(selectedDate)}`} icon="👥" />
                      <StatCard label="Workforce EWI" value={total > 0 ? avgEwi.toFixed(2) : "—"} sub={total > 0 ? getWellnessCategory(Math.round(avgEwi)).status : "No data"} icon="📊" accent="text-teal-600" />
                      <StatCard label="TL notifications" value={tlAlerts.length} sub="triggered that day" icon="🔔" accent="text-orange-500" />
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
                          <div className="bg-white rounded-2xl border border-slate-200 p-5">
                            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">Workforce Mood — {formatShort(selectedDate)}</p>
                            <h2 className="text-base font-semibold text-slate-800 mb-4">Emotional level distribution</h2>
                            <div className="space-y-3">
                              {[5,4,3,2,1,0].map((lvl) => {
                                const keys = ["excited","happy","motivated","concerned","stressed","burnedout"];
                                return <DistBar key={lvl} icon={EMOTION_ICONS[lvl]} label={EMOTION_LABELS[lvl]} count={parseInt(dist?.[`${keys[5-lvl]}_count`] ?? 0)} total={total} colorClass={MOOD_COLORS[lvl]} />;
                              })}
                            </div>
                          </div>
                          <div className="bg-white rounded-2xl border border-slate-200 p-5">
                            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">Employee Energy — {formatShort(selectedDate)}</p>
                            <h2 className="text-base font-semibold text-slate-800 mb-4">Energy level distribution</h2>
                            <div className="space-y-3">
                              {[5,4,3,2,1].map((lvl) => {
                                const keys = ["highly_energized","energized","normal","low_energy","exhausted"];
                                return <DistBar key={lvl} icon={ENERGY_ICONS[lvl]} label={ENERGY_LABELS[lvl]} count={parseInt(dist?.[`${keys[5-lvl]}_count`] ?? 0)} total={total} colorClass={ENERGY_COLORS[lvl]} />;
                              })}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          <div className="bg-white rounded-2xl border border-slate-200 p-5">
                            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">Workforce Wellness Score</p>
                            <h2 className="text-base font-semibold text-slate-800 mb-4">Employee Wellness Index — {formatShort(selectedDate)}</h2>
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
                          <div className="bg-white rounded-2xl border border-slate-200 p-5">
                            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">Daily Trend — week of {weekLabel}</p>
                            <h2 className="text-base font-semibold text-slate-800 mb-1">Weekly wellness score</h2>
                            <p className="text-xs text-slate-400 mb-4">{isHistorical ? `Showing the week containing ${formatShort(selectedDate)}.` : "Identify burnout patterns throughout the week."}</p>
                            <TrendChart data={trend} selectedDate={selectedDate} />
                            {trend.length > 0 && (
                              <div className="mt-4 pt-3 border-t border-slate-100 grid gap-1" style={{ gridTemplateColumns: `repeat(${trend.length}, 1fr)` }}>
                                {trend.map((d) => {
                                  const s = parseFloat(d.avg_ewi), cat = getWellnessCategory(Math.round(s)), sel = d.survey_date === selectedDate;
                                  return (
                                    <button key={d.survey_date} onClick={() => handleDateChange(d.survey_date)} className={`text-center rounded-lg py-1.5 px-1 transition-colors cursor-pointer ${sel ? "bg-blue-50 ring-1 ring-blue-200" : "hover:bg-slate-50"}`}>
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

                {/* EMPLOYEES TAB */}
                {activeTab === "employees" && (
                  <div className="bg-white rounded-2xl border border-slate-200">
                    <div className="p-5 border-b border-slate-100 flex items-center justify-between gap-4 flex-wrap">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-0.5">Employee roster</p>
                        <h2 className="text-base font-semibold text-slate-800">Wellness index for {formatDisplay(selectedDate)} — {total} respondents</h2>
                      </div>
                      <input type="text" placeholder="Search name, ID, LOB, account…" value={search} onChange={(e) => setSearch(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-2 w-64 focus:outline-none focus:ring-2 focus:ring-blue-200" />
                    </div>
                    {filtered.length === 0 ? <EmptyState message={total === 0 ? `No submissions on ${formatDisplay(selectedDate)}.` : "No employees match your search."} /> : (
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
                              const isHR = e.streak.hr_alert, isTL = e.tl_trigger && !isHR;
                              return (
                                <tr key={e.id} className={`hover:bg-slate-50 transition-colors ${isHR ? "bg-red-50" : ""}`}>
                                  <td className="px-5 py-3">
                                    <div className="flex items-center gap-3">
                                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${e.avatarColor}`}>{e.initials}</div>
                                      <div><p className="font-medium text-slate-800">{e.full_name}</p><p className="text-xs text-slate-400">{e.employee_id}</p></div>
                                    </div>
                                  </td>
                                  <td className="px-4 py-3"><p className="text-xs text-slate-700 font-medium">{e.lob}</p><p className="text-xs text-slate-400">{e.account_name}</p></td>
                                  <td className="px-4 py-3"><span className="text-base mr-1">{ENERGY_ICONS[e.energy_level]}</span><span className="text-xs text-slate-600">{ENERGY_LABELS[e.energy_level]}</span><span className="text-xs text-slate-400 ml-1">({e.energy_level})</span></td>
                                  <td className="px-4 py-3"><span className="text-base mr-1">{EMOTION_ICONS[e.emotion_level]}</span><span className="text-xs text-slate-600">{EMOTION_LABELS[e.emotion_level]}</span><span className="text-xs text-slate-400 ml-1">({e.emotion_level})</span></td>
                                  <td className="px-4 py-3 text-center"><span className="font-semibold text-slate-800">{e.ewi_score}</span><span className="text-slate-400 text-xs">/10</span></td>
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

                {/* ALERTS TAB */}
                {activeTab === "alerts" && (
                  <div className="space-y-4">
                    {isHistorical && (
                      <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        Showing alerts as of <strong className="mx-1">{formatDisplay(selectedDate)}</strong>.
                      </div>
                    )}
                    <div className="bg-white rounded-2xl border border-red-200">
                      <div className="p-5 border-b border-red-100 flex items-center gap-3">
                        <span className={`w-2 h-2 rounded-full bg-red-500 flex-shrink-0 ${!isHistorical ? "animate-pulse" : ""}`} />
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-widest text-red-400 mb-0.5">HR Alert</p>
                          <h2 className="text-base font-semibold text-slate-800">Consecutive-day triggers — Immediate action required</h2>
                          <p className="text-xs text-slate-400 mt-0.5">Burned Out or Exhausted 3+ days ending {formatShort(selectedDate)}</p>
                        </div>
                      </div>
                      {hrAlerts.length === 0 ? <EmptyState message="No HR alerts for this date. 🎉" /> : hrAlerts.map((e) => (
                        <div key={e.id} className="flex items-center gap-4 px-5 py-4 border-b border-slate-50 last:border-0">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold ${e.avatarColor}`}>{e.initials}</div>
                          <div className="flex-1">
                            <p className="font-medium text-slate-800">{e.full_name} <span className="text-xs text-slate-400 font-normal">· {e.employee_id}</span></p>
                            <p className="text-xs text-slate-400">{e.lob} · {e.account_name}</p>
                            <p className="text-xs text-slate-500 mt-0.5">{EMOTION_ICONS[e.emotion_level]} {EMOTION_LABELS[e.emotion_level]} · {ENERGY_ICONS[e.energy_level]} {ENERGY_LABELS[e.energy_level]}</p>
                            {e.streak.burnout_streak >= 3 && <p className="text-xs text-red-600 mt-0.5">🔴 Burned Out {e.streak.burnout_streak} consecutive days</p>}
                            {e.streak.exhausted_streak >= 3 && <p className="text-xs text-red-600 mt-0.5">😴 Exhausted {e.streak.exhausted_streak} consecutive days</p>}
                          </div>
                          <div className="text-right"><WellnessBadge score={e.ewi_score} /><p className="text-xs text-slate-400 mt-1">EWI: {e.ewi_score}/10</p></div>
                          <div className="text-xs text-red-600 font-semibold bg-red-50 border border-red-100 rounded-xl px-3 py-2 text-center flex-shrink-0"><p className="text-xl">🚨</p><p>Immediate</p><p>Intervention</p></div>
                        </div>
                      ))}
                    </div>
                    <div className="bg-white rounded-2xl border border-orange-200">
                      <div className="p-5 border-b border-orange-100 flex items-center gap-3">
                        <span className="w-2 h-2 rounded-full bg-orange-400 flex-shrink-0" />
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-widest text-orange-400 mb-0.5">Team Leader Notification</p>
                          <h2 className="text-base font-semibold text-slate-800">Auto-triggered alerts sent to team leaders</h2>
                          <p className="text-xs text-slate-400 mt-0.5">Low Energy / Exhausted / Stressed / Burned Out on {formatShort(selectedDate)}</p>
                        </div>
                      </div>
                      {tlAlerts.length === 0 ? <EmptyState message="No TL notifications for this date." /> : tlAlerts.map((e) => (
                        <div key={e.id} className="flex items-center gap-4 px-5 py-4 border-b border-slate-50 last:border-0">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold ${e.avatarColor}`}>{e.initials}</div>
                          <div className="flex-1">
                            <p className="font-medium text-slate-800">{e.full_name} <span className="text-xs text-slate-400 font-normal">· {e.employee_id}</span></p>
                            <p className="text-xs text-slate-400">{e.lob} · {e.account_name}</p>
                            <p className="text-xs text-slate-500 mt-0.5">{EMOTION_ICONS[e.emotion_level]} {EMOTION_LABELS[e.emotion_level]} · {ENERGY_ICONS[e.energy_level]} {ENERGY_LABELS[e.energy_level]}</p>
                          </div>
                          <div className="text-right"><WellnessBadge score={e.ewi_score} /><p className="text-xs text-slate-400 mt-1">EWI: {e.ewi_score}/10</p></div>
                          <div className="text-xs text-orange-600 font-semibold bg-orange-50 border border-orange-100 rounded-xl px-3 py-2 text-center flex-shrink-0"><p className="text-xl">🔔</p><p>TL</p><p>Notified</p></div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* SCORING GUIDE TAB */}
                {activeTab === "scoring" && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="bg-white rounded-2xl border border-slate-200 p-5">
                      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Energy score</p>
                      <table className="w-full text-sm">
                        <thead><tr className="text-xs text-slate-400 border-b border-slate-100"><th className="text-left py-2 font-medium">Response</th><th className="py-2">Icon</th><th className="text-right py-2 font-medium">Points</th></tr></thead>
                        <tbody className="divide-y divide-slate-50">{[5,4,3,2,1].map((lvl) => (<tr key={lvl}><td className="py-2.5 text-slate-700">{ENERGY_LABELS[lvl]}</td><td className="py-2.5 text-center">{ENERGY_ICONS[lvl]}</td><td className="py-2.5 text-right font-semibold text-slate-800">{lvl}</td></tr>))}</tbody>
                      </table>
                    </div>
                    <div className="bg-white rounded-2xl border border-slate-200 p-5">
                      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Emotion score</p>
                      <table className="w-full text-sm">
                        <thead><tr className="text-xs text-slate-400 border-b border-slate-100"><th className="text-left py-2 font-medium">Emotion</th><th className="py-2">Icon</th><th className="text-right py-2 font-medium">Points</th></tr></thead>
                        <tbody className="divide-y divide-slate-50">{[5,4,3,2,1,0].map((lvl) => (<tr key={lvl}><td className="py-2.5 text-slate-700">{EMOTION_LABELS[lvl]}</td><td className="py-2.5 text-center">{EMOTION_ICONS[lvl]}</td><td className="py-2.5 text-right font-semibold text-slate-800">{lvl}</td></tr>))}</tbody>
                      </table>
                    </div>
                    <div className="bg-white rounded-2xl border border-slate-200 p-5 lg:col-span-2">
                      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Employee Wellness Index (EWI)</p>
                      <div className="bg-slate-50 rounded-xl px-5 py-4 mb-5 font-mono text-sm text-slate-700">
                        <p>EWI = energy_level + emotion_level &nbsp; (max 10)</p>
                        <div className="mt-3 pt-3 border-t border-slate-200 text-xs"><p><span className="text-slate-400">e.g.</span> energy_level=4 + emotion_level=4 → <span className="font-semibold text-blue-600">EWI = 8 / 10 → Healthy</span></p></div>
                      </div>
                      <table className="w-full text-sm">
                        <thead><tr className="text-xs text-slate-400 border-b border-slate-100"><th className="text-left py-2 font-medium">Score</th><th className="text-left py-2 font-medium">Status</th><th className="text-left py-2 font-medium">Required action</th></tr></thead>
                        <tbody className="divide-y divide-slate-50">{WELLNESS_CATEGORIES.map((c) => (<tr key={c.status}><td className="py-2.5 font-semibold text-slate-700">{c.min}–{c.max}</td><td className="py-2.5"><span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${c.bg} ${c.color}`}>{c.status}</span></td><td className="py-2.5 text-slate-500">{c.action}</td></tr>))}</tbody>
                      </table>
                    </div>
                    <div className="bg-white rounded-2xl border border-slate-200 p-5 lg:col-span-2">
                      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Automated risk triggers</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="bg-orange-50 border border-orange-100 rounded-xl p-4">
                          <p className="text-xs font-semibold text-orange-600 mb-2">🔔 Team Leader notification</p>
                          <ul className="text-xs text-slate-700 space-y-1">{["energy_level ≤ 2 (Low Energy / Exhausted)", "emotion_level ≤ 1 (Stressed / Burned Out)"].map((t) => (<li key={t} className="flex items-start gap-2"><span className="w-1.5 h-1.5 rounded-full bg-orange-400 flex-shrink-0 mt-1" />{t}</li>))}</ul>
                        </div>
                        <div className="bg-red-50 border border-red-100 rounded-xl p-4">
                          <p className="text-xs font-semibold text-red-600 mb-2">🚨 HR Alert — streak-based</p>
                          <ul className="text-xs text-slate-700 space-y-1">{["Burned Out (emotion_level=0) for 3 consecutive days", "Exhausted (energy_level=1) for 3 consecutive days"].map((t) => (<li key={t} className="flex items-start gap-2"><span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0 mt-1" />{t}</li>))}</ul>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )
          )}
        </main>
      </div>
    </div>
  );
}