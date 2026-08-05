// Data layer — fetch the published Sheet tabs, parse, coerce, dedup.
// Contract: docs/PIPELINE-AND-CONTRACT.md. gid mapping verified 2026-08-02.

const PUB = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR6XT0_x4_4sjLO8aluMHmwljEvLuVWjtaNiexWssiEfxScCx7_cRWvMfhypJ0qpU7WWA3XE1UgYT17/pub';

const TABS = {
  stats:        '2062431600',
  analyses:     '1983968726',
  benchmarks:   '1081989232',
  contract_log: '1674078242',
  meta:         '1909773820',
};

// Cache-buster: `cache: 'no-store'` only governs the browser cache, not Google's
// CDN edge. A unique query param is what actually defeats an intermediary.
const csvUrl = gid => `${PUB}?gid=${gid}&single=true&output=csv&_=${Date.now()}`;

function parseCsv(text) {
  const { data, errors } = Papa.parse(text, { header: true, skipEmptyLines: 'greedy' });
  if (errors.length > 3) console.warn('CSV parse errors', errors.slice(0, 5));
  return data;
}

async function fetchTab(name) {
  const res = await fetch(csvUrl(TABS[name]), { cache: 'no-store' });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return parseCsv(await res.text());
}

export const num = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

export const json = v => {
  if (!v || typeof v !== 'string') return null;
  try { return JSON.parse(v); } catch { return null; }
};

function coerceStatsRow(r) {
  return {
    // period_label is an OPAQUE identifier — "2026-07" but also
    // "checkin 2026-08-04". Never parse it as a date; use period_start /
    // period_end for anything temporal, including sorting.
    period_label: r.period_label,
    period_type: r.period_type || 'month',
    period_start: r.period_start || null,
    period_end: r.period_end || null,
    pdga_everyday_estimate: num(r.pdga_everyday_estimate),
    pdga_best_estimate: num(r.pdga_best_estimate),
    // UDisc Everyday rating: best 8 of last 20 (or top 40% under 20 rated
    // rounds). This is THE rating to show. `udisc_avg_recent_10` is deprecated
    // — not a UDisc metric, kept only so old rows still parse.
    udisc_everyday_rating: num(r.udisc_everyday_rating),
    udisc_everyday_basis: r.udisc_everyday_basis || null,
    udisc_avg_recent_10: num(r.udisc_avg_recent_10),
    udisc_best_round: num(r.udisc_best_round),
    par_or_better_pct_by_layout: json(r.par_or_better_pct_by_layout) || {},
    rounds_by_layout: json(r.rounds_by_layout) || null,
    hole_leak_table: json(r.hole_leak_table) || {},

    // ── Putting (metric only — every distance is metres; the raw putts tab's
    // distance_ft column is deliberately never read) ──────────────────────
    putting_summary: json(r.putting_summary) || null,
    putting_by_distance: json(r.putting_by_distance) || null,
    putting_sessions: (json(r.putting_sessions) || [])
      .filter(s => s.date)
      .sort((a, b) => a.date.localeCompare(b.date)),

    // ── Session/round grain — what makes custom date ranges possible ──────
    rating_history: (json(r.rating_history) || [])
      .filter(h => h.date)
      .sort((a, b) => a.date.localeCompare(b.date)),
    activity_sessions: (json(r.activity_sessions) || [])
      .filter(s => s.date)
      .sort((a, b) => a.date.localeCompare(b.date)),

    scoring_by_par: json(r.scoring_by_par) || null,
    pressure_split: json(r.pressure_split),
    putting_pct_by_distance: json(r.putting_pct_by_distance) || {},
    practice_streak_days: num(r.practice_streak_days),
    weekly_activity_hours_total: num(r.weekly_activity_hours_total), // misnomer: cumulative total
    total_calories: num(r.total_calories),
    rounds_count: num(r.rounds_count),
    monthly_trend: (json(r.monthly_trend) || [])
      .map(m => ({
        month: m.month,
        rounds: num(m.rounds),
        avg_rating: num(m.avg_rating),
        pdga_est: num(m.pdga_est),
        par_or_better_pct: num(m.par_or_better_pct),
        birdie_pct: num(m.birdie_pct),
        double_pct: num(m.double_pct),
        pro_par_or_better_pct: num(m.pro_par_or_better_pct),
        // Rolling Everyday rating as it stood at month end — what UDisc's own
        // rating-history graph plots, and the honest "rating over time".
        everyday_rating: num(m.everyday_rating),
        everyday_pdga_est: num(m.everyday_pdga_est),
        by_layout: m.by_layout || null,
        by_par: m.by_par || null,
        putting: m.putting || null,
        activity_hours: num(m.activity_hours),
        activity_calories: num(m.activity_calories),
        sessions: num(m.sessions),
        active_days: num(m.active_days),
        avg_hr: num(m.avg_hr),
        max_hr: num(m.max_hr),
        min_hr: num(m.min_hr),
      }))
      .sort((a, b) => a.month.localeCompare(b.month)), // never trust row order
    benchmark_deltas: json(r.benchmark_deltas) || [],
    computed_at: r.computed_at || null,
  };
}

export async function loadAll() {
  const [stats, analyses, benchmarks, contractLog, meta] = await Promise.all([
    fetchTab('stats'), fetchTab('analyses'), fetchTab('benchmarks'),
    fetchTab('contract_log'), fetchTab('meta'),
  ]);

  // stats: drop the blank row, coerce, sort newest-first BY period_end —
  // sorting by label would put "checkin 2026-08-04" in the wrong place.
  const periods = stats
    .filter(r => r.period_label)
    .map(coerceStatsRow)
    .sort((a, b) => (b.period_end || '').localeCompare(a.period_end || ''));

  // analyses: append-only, possibly multiple rows per period — keep latest generated_at
  const evalByPeriod = new Map();
  for (const row of analyses.filter(r => r.period_label && r.generated_at)) {
    const prev = evalByPeriod.get(row.period_label);
    if (!prev || row.generated_at > prev.generated_at) evalByPeriod.set(row.period_label, row);
  }
  for (const row of evalByPeriod.values()) {
    row.priorities = json(row.priorities_json) || [];
  }

  const bench = benchmarks.filter(r => r.metric).map(r => ({
    metric: r.metric,
    category: r.category,
    benchmark_value: num(r.benchmark_value),
    unit: r.unit,
    notes: r.notes,
  }));

  const metaRows = meta.filter(r => r.filename && r.processed_at);

  return { periods, evalByPeriod, bench, contractLog, metaRows };
}

// Presentational helpers ------------------------------------------------

// Presentation for a period. Never derived from period_label — that string is
// opaque. Months read as "July 2026"; check-ins carry their window.
export function periodName(p, opts = {}) {
  if (!p) return '—';
  const d = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB',
    { day: 'numeric', month: 'short', timeZone: 'UTC', ...(opts.year === false ? {} : { year: 'numeric' }) });
  if (p.period_type === 'month' && p.period_start) {
    return new Date(`${p.period_start}T00:00:00Z`).toLocaleDateString('en-GB',
      { month: opts.short ? 'short' : 'long', year: 'numeric', timeZone: 'UTC' });
  }
  if (p.period_type === 'checkin') {
    return opts.withRange && p.period_start
      ? `Check-in · ${d(p.period_start)} → ${d(p.period_end)}`
      : `Check-in · ${d(p.period_end)}`;
  }
  return p.period_start ? `${d(p.period_start)} → ${d(p.period_end)}` : p.period_label;
}

export const periodRange = p =>
  p?.period_start && p?.period_end ? `${p.period_start} → ${p.period_end}` : '';

export function monthName(ym, opts = {}) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString('en-GB', { month: opts.short ? 'short' : 'long', year: opts.year === false ? undefined : 'numeric', timeZone: 'UTC' });
}

export function fmtDate(iso, opts = {}) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', ...(opts.time ? { hour: '2-digit', minute: '2-digit' } : {}) });
}

// ── Custom date range (Mode B) ────────────────────────────────────────
// Summing per-day/per-session records the backend already computed is
// presentational aggregation, not analysis — it derives no conclusion the
// stored data doesn't already state. Anything monthly-bucketed
// (par-or-better, leaks, pressure, by_par, by_layout) is deliberately
// excluded: see MODE_B_EXCLUDES.

export const MODE_B_EXCLUDES = [
  'Par-or-better % and layout splits',
  'Problem-hole leak table',
  'Pressure split (competitive vs practice)',
  'Scoring by par',
];

const inRange = (d, start, end) => d >= start && d <= end;

export function aggregateRange(period, start, end) {
  const rounds = period.rating_history.filter(r => inRange(r.date, start, end));
  const sessions = period.activity_sessions.filter(s => inRange(s.date, start, end));
  const putts = period.putting_sessions.filter(p => inRange(p.date, start, end));

  const sum = (arr, k) => arr.reduce((t, x) => t + (Number(x[k]) || 0), 0);
  const avg = (arr, k) => {
    const vals = arr.map(x => Number(x[k])).filter(Number.isFinite);
    return vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null;
  };

  const puttAttempts = sum(putts, 'attempts');
  const puttMade = sum(putts, 'made');

  // Distance buckets re-summed from session grain where available; falls back
  // to null so the chart says "not available for this range" rather than
  // silently showing the all-time curve.
  return {
    start, end,
    rounds,
    sessions,
    putting_sessions: putts,
    rounds_count: rounds.length,
    best_rating: rounds.length ? Math.max(...rounds.map(r => r.rating)) : null,
    avg_rating: rounds.length ? Math.round(rounds.reduce((t, r) => t + r.rating, 0) / rounds.length) : null,
    latest_rating: rounds.length ? rounds.at(-1).rating : null,
    activity_hours: +(sum(sessions, 'minutes') / 60).toFixed(1),
    activity_calories: sum(sessions, 'calories'),
    session_count: sessions.length,
    // A day counts as active if ANYTHING happened on it — a tracked workout
    // OR a round played. Counting only tracked sessions silently drops every
    // round played without the watch (3 such days in July alone).
    active_days: new Set([...sessions.map(s => s.date), ...rounds.map(r => r.date)]).size,
    tracked_days: new Set(sessions.map(s => s.date)).size,
    round_days: new Set(rounds.map(r => r.date)).size,
    avg_hr: avg(sessions, 'hr_avg'),
    max_hr: sessions.length ? Math.max(...sessions.map(s => Number(s.hr_max) || 0)) || null : null,
    min_hr: sessions.length ? Math.min(...sessions.map(s => Number(s.hr_min) || Infinity)) : null,
    putt_attempts: puttAttempts,
    putt_made: puttMade,
    putt_pct: puttAttempts ? +(puttMade / puttAttempts * 100).toFixed(1) : null,
    putt_session_count: putts.length,
  };
}

// Union of every day Bram played or practised, from BOTH series.
// activity_sessions only covers 2026-07-10 onward; rating_history goes back to
// February. Using either alone misrepresents the history, so they are merged
// and kept visually distinct.
export function activityCalendar(period) {
  const days = new Map();
  for (const r of period.rating_history) {
    const d = days.get(r.date) || { date: r.date, rounds: 0, minutes: 0, tracked: false };
    d.rounds += 1;
    days.set(r.date, d);
  }
  for (const s of period.activity_sessions) {
    const d = days.get(s.date) || { date: s.date, rounds: 0, minutes: 0, tracked: false };
    d.minutes += Number(s.minutes) || 0;
    d.tracked = true;
    days.set(s.date, d);
  }
  return days;
}

// Streak facts over the activity calendar. Counting distinct days and the
// gaps between them is arithmetic over dates the backend already published —
// it states what the calendar shows, it does not judge the training.
export function streakStats(days) {
  const dates = [...days.keys()].sort();
  if (!dates.length) return { total: 0, current: 0, longest: 0, thisWeek: 0, last30: 0, first: null, last: null };

  const DAY = 86400000;
  const t = iso => new Date(`${iso}T00:00:00Z`).getTime();

  let longest = 1, run = 1;
  for (let i = 1; i < dates.length; i++) {
    run = (t(dates[i]) - t(dates[i - 1]) === DAY) ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  // Current streak runs backwards from the most recent active day, and only
  // counts if that day is today or yesterday — otherwise the streak is broken.
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const lastDay = t(dates.at(-1));
  let current = 0;
  if ((today.getTime() - lastDay) <= DAY) {
    current = 1;
    for (let i = dates.length - 1; i > 0; i--) {
      if (t(dates[i]) - t(dates[i - 1]) === DAY) current++; else break;
    }
  }

  const since = n => dates.filter(d => (today.getTime() - t(d)) < n * DAY).length;
  return {
    total: dates.length,
    current, longest,
    thisWeek: since(7),
    last30: since(30),
    first: dates[0], last: dates.at(-1),
  };
}

export function nextUploadDue(metaRows) {
  // pipeline cron: 07:00 on the 1st, monthly
  const latest = metaRows.map(r => r.processed_at).sort().at(-1);
  const base = latest ? new Date(latest) : new Date();
  const next = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1, 7, 0, 0));
  return next;
}
