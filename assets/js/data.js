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
    period_label: r.period_label,
    pdga_everyday_estimate: num(r.pdga_everyday_estimate),
    pdga_best_estimate: num(r.pdga_best_estimate),
    udisc_avg_recent_10: num(r.udisc_avg_recent_10),
    udisc_best_round: num(r.udisc_best_round),
    par_or_better_pct_by_layout: json(r.par_or_better_pct_by_layout) || {},
    // Not in the contract yet — requested 2026-08-02. Absent until the backend
    // ships it; the UI degrades to "sample size not published" rather than
    // implying every layout percentage rests on the same evidence.
    rounds_by_layout: json(r.rounds_by_layout) || null,
    hole_leak_table: json(r.hole_leak_table) || {},
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

  // stats: coerce, drop blank keys, sort newest-first for the picker
  const periods = stats
    .filter(r => r.period_label)
    .map(coerceStatsRow)
    .sort((a, b) => b.period_label.localeCompare(a.period_label));

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

export function nextUploadDue(metaRows) {
  // pipeline cron: 07:00 on the 1st, monthly
  const latest = metaRows.map(r => r.processed_at).sort().at(-1);
  const base = latest ? new Date(latest) : new Date();
  const next = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1, 7, 0, 0));
  return next;
}
