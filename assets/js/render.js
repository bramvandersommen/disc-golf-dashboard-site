// Section renderers. Every function renders FROM STORED DATA ONLY —
// no coaching conclusions are derived here (hard rule, see CLAUDE.md).
// All distances are metric; the putts tab's distance_ft is never read.

import { monthName, periodName, periodRange, fmtDate, nextUploadDue, aggregateRange, activityCalendar, MODE_B_EXCLUDES } from './data.js?v=202608041419';
import { lineChart, barChart, groupedBars, contributionGraph, countUp, showTip, hideTip, ttHtml, COLORS } from './charts.js?v=202608041419';

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function md(src) {
  if (!src) return '';
  const html = window.marked.parse(src, { mangle: false, headerIds: false });
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  tpl.content.querySelectorAll('script, iframe, object, embed').forEach(n => n.remove());
  tpl.content.querySelectorAll('*').forEach(n => {
    for (const a of [...n.attributes]) if (/^on/i.test(a.name) || (a.name === 'href' && /^\s*javascript:/i.test(a.value))) n.removeAttribute(a.name);
  });
  const div = document.createElement('div');
  div.appendChild(tpl.content);
  return div.innerHTML;
}

const deltaBadge = (delta, { unit = '', decimals = 0, goodWhenUp = true } = {}) => {
  if (delta === null || delta === undefined || !isFinite(delta)) return '';
  const r = +delta.toFixed(decimals);
  if (r === 0) return `<span class="delta flat">–</span>`;
  const up = r > 0;
  return `<span class="delta ${up === goodWhenUp ? '' : 'down'}">${up ? '↑' : '↓'} ${Math.abs(r)}${unit}</span>`;
};

// Layouts are fully data-derived: new venues appear as Bram travels and must
// absorb with no code change. Anchors match `even_par_rating_<x>` benchmark
// metrics to layout names at runtime. No layout list is hardcoded.
function anchorFor(layoutName, bench) {
  if (!layoutName || layoutName === 'all') return null;
  const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const layout = norm(layoutName);
  return bench.filter(b => b.category === 'layout_rating_anchor').find(b => {
    const token = norm(b.metric.replace(/^even_par_rating_/, ''));
    return token && (layout === token || layout.startsWith(token) || token.startsWith(layout));
  }) || null;
}

const MIN_SOLID = 5;        // rounds — below this a per-layout figure is muted
const MIN_TREND = 3;        // rounds — below this no per-layout trend
const MIN_PUTT_ATTEMPTS = 50; // attempts — below this a distance bucket is muted

const layoutCount = (state, name) => state.selected.rounds_by_layout?.[name] ?? null;

function sampleTag(n, noun = 'round') {
  if (n === null || n === undefined) return '';
  const thin = n < MIN_SOLID;
  return `<span class="n-tag${thin ? ' thin' : ''}" title="${n} ${noun}${n === 1 ? '' : 's'}">n=${n}</span>`;
}

const metres = key => parseFloat(String(key).replace('m', ''));

// ── KPI row ───────────────────────────────────────────────────────────
export function renderKpis(state) {
  const { selected, prev } = state;
  const trend = selected.monthly_trend;
  const lastM = trend.at(-1) || {};
  const el = $('#kpi-row');

  const everyday = selected.udisc_everyday_rating;
  const ratingDelta = (everyday != null && prev?.udisc_everyday_rating != null)
    ? everyday - prev.udisc_everyday_rating : null;

  const ratingKpi = everyday != null
    ? `<div class="kpi kpi-accent reveal">
        <div class="kpi-label">UDisc rating · Everyday</div>
        <div class="kpi-value"><span data-count></span>${deltaBadge(ratingDelta)}</div>
        <div class="kpi-sub">${esc(selected.udisc_everyday_basis || 'best 8 of last 20')}<br>Est. PDGA <b>${selected.pdga_everyday_estimate ?? '—'}</b> · model estimate, not official</div>
      </div>`
    : `<div class="kpi kpi-accent reveal">
        <div class="kpi-label">Estimated PDGA</div>
        <div class="kpi-value"><span data-count></span></div>
        <div class="kpi-sub">Model estimate, not an official rating.</div>
      </div>`;

  // Putting sits next to the rating: it is the largest measured gap in the
  // dataset, so it gets top-level billing rather than living below the fold.
  const p = selected.putting_summary;
  const c1 = p?.c1;
  const puttKpi = c1?.pct != null
    ? `<div class="kpi kpi-putt reveal">
        <div class="kpi-label">C1 putting · inside 10m</div>
        <div class="kpi-value"><span data-count></span><span class="unit">%</span></div>
        <div class="kpi-sub">Target <b>${c1.target_pct}%</b> · gap <b class="gap">${(c1.target_pct - c1.pct).toFixed(1)} pts</b><br>${c1.made} of ${c1.attempts} across ${c1.sessions} sessions</div>
      </div>`
    : `<div class="kpi reveal">
        <div class="kpi-label">C1 putting</div>
        <div class="kpi-value kpi-value-empty">No putting data<span class="kpi-empty-sub">this period</span></div>
        <div class="kpi-sub">Log a Putt Maister session to populate this</div>
      </div>`;

  // Within-window figures. The scalar columns are cumulative as-of period_end,
  // so anything that should describe *this window only* is aggregated from the
  // date-carrying grains instead.
  const win = aggregateRange(selected, selected.period_start, selected.period_end);

  el.innerHTML = `
    ${ratingKpi}
    ${puttKpi}
    <div class="kpi reveal">
      <div class="kpi-label">Practice streak</div>
      <div class="kpi-value"><span data-count></span><span class="unit">days</span></div>
      <div class="kpi-sub">“Kept at it” streak — gaps ≤ 2 days count as continuous, not consecutive days</div>
    </div>
    <div class="kpi reveal">
      <div class="kpi-label">In this window</div>
      <div class="kpi-value" style="font-size:32px">${win.rounds_count}<span class="unit">round${win.rounds_count === 1 ? '' : 's'}</span></div>
      <div class="kpi-sub">${win.active_days} active day${win.active_days === 1 ? '' : 's'} · ${win.activity_hours} h tracked<br>Data through ${fmtDate(selected.computed_at)}</div>
    </div>`;

  const c = el.querySelectorAll('[data-count]');
  countUp(c[0], everyday ?? selected.pdga_everyday_estimate);
  if (c1?.pct != null) {
    countUp(c[1], c1.pct, { decimals: 1 });
    countUp(c[2], selected.practice_streak_days);
  } else {
    countUp(c[1], selected.practice_streak_days);
  }
}

// ── Period context banner ─────────────────────────────────────────────
// States exactly which window is on screen and whether it is coached.
export function renderPeriodContext(state) {
  const p = state.selected;
  const host = $('#period-context');
  const coached = state.evalByPeriod.has(p.period_label);
  const typeLabel = { month: 'Monthly evaluation', checkin: 'On-demand check-in', custom: 'Custom period' }[p.period_type] || 'Period';
  const fmtD = iso => iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';

  host.innerHTML = `
    <div class="period-context reveal">
      <div>
        <span class="period-type ${esc(p.period_type)}">${esc(typeLabel)}</span>
        <span class="period-window">${fmtD(p.period_start)} → ${fmtD(p.period_end)}</span>
      </div>
      <span class="period-coached ${coached ? 'yes' : 'no'}">${coached ? '✓ Evaluated' : 'Not yet evaluated'}</span>
    </div>`;
}

// ── Coaching highlight strip ──────────────────────────────────────────
export function renderCoachStrip(state) {
  const host = $('#coach-strip');
  const row = state.evalByPeriod.get(state.selected.period_label);

  if (!row) {
    const latest = state.periods.find(p => state.evalByPeriod.has(p.period_label));
    host.innerHTML = `
      <div class="coach-strip coach-strip-empty reveal">
        <span class="coach-strip-tag">Coaching</span>
        <span class="coach-strip-note">No evaluation for this period yet.</span>
        ${latest ? `<button class="coach-strip-link" data-goto="${esc(latest.period_label)}">Latest evaluation · ${esc(periodName(latest))} →</button>` : ''}
      </div>`;
    host.querySelector('[data-goto]')?.addEventListener('click', e => {
      const picker = document.getElementById('period-picker');
      picker.value = e.target.dataset.goto;
      picker.dispatchEvent(new Event('change'));
    });
    return;
  }

  const prioChips = (row.priorities || []).map(p =>
    `<span class="coach-strip-prio"><b>${esc(p.rank)}</b>${esc(p.title)}</span>`).join('');
  host.innerHTML = `
    <a class="coach-strip reveal" href="#coaching">
      <div class="coach-strip-head">
        <span class="coach-strip-tag">Coaching focus · ${esc(periodName(state.selected))}</span>
        <span class="coach-strip-cta">Full evaluation ↓</span>
      </div>
      <div class="coach-strip-headline">${esc(row.headline)}</div>
      <div class="coach-strip-prios">${prioChips}</div>
    </a>`;
}

// ── Coaching evaluation panel ─────────────────────────────────────────
export function renderEval(state) {
  const row = state.evalByPeriod.get(state.selected.period_label);
  const host = $('#eval-panel');

  if (!row) {
    host.innerHTML = `
      <div class="eval-panel eval-empty reveal">
        <svg class="eval-empty-icon" viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <circle cx="24" cy="24" r="20" stroke="#8FB339" stroke-width="2.5"/>
          <circle cx="24" cy="24" r="6" fill="#8FB339"/>
          <path d="M24 4v8M24 36v8M4 24h8M36 24h8" stroke="#3A473D" stroke-width="2"/>
        </svg>
        <h3>No evaluation for this period yet</h3>
        <p>The coaching evaluation is written after each period closes and lands here automatically. Charts below still reflect this period’s stored stats.</p>
      </div>`;
    return;
  }

  const prios = (row.priorities || []).map(p => `
    <div class="prio-card">
      <div class="prio-rank">${esc(p.rank)}</div>
      <div>
        <h4 class="prio-title">${esc(p.title)}</h4>
        <p class="prio-why">${esc(p.why)}</p>
        <p class="prio-drill"><b>Drill</b> — ${esc(p.drill)}</p>
      </div>
    </div>`).join('');

  host.innerHTML = `
    <div class="eval-panel reveal">
      <div class="eval-tag">Coaching evaluation · ${esc(periodName(state.selected, { withRange: true }))}</div>
      <h3 class="eval-headline">${esc(row.headline)}</h3>
      <div class="eval-narrative">${md(row.narrative_md)}</div>
      ${prios ? `<div class="eval-priorities">${prios}</div>` : ''}
      ${row.changed_since_last ? `
        <div class="eval-changed">
          <div class="eval-changed-label">Changed since last evaluation</div>
          <div class="eval-changed-body">${md(row.changed_since_last)}</div>
        </div>` : ''}
      <div class="eval-meta">Generated ${fmtDate(row.generated_at, { time: true })} · from stats computed ${fmtDate(row.source_stats_computed_at, { time: true })}</div>
    </div>`;
}

// ── Rating trajectory ─────────────────────────────────────────────────
export function renderRating(state) {
  const host = $('#rating-section');
  const s = state.selected;
  const hasEveryday = s.monthly_trend.some(m => m.everyday_rating != null);
  const heroValue = s.udisc_everyday_rating
    ?? [...s.monthly_trend].reverse().find(m => m.everyday_rating != null)?.everyday_rating ?? null;
  const heroBasis = s.udisc_everyday_basis || 'best 8 of last 20 rated rounds';

  host.innerHTML = `
    <div class="grid2">
      <div class="card reveal">
        <div class="rating-hero">
          <div class="rating-hero-label">Current UDisc rating</div>
          <div class="rating-hero-value"><span data-hero></span></div>
          <div class="rating-hero-sub">${esc(heroBasis)} · Est. PDGA ${s.pdga_everyday_estimate ?? '—'}</div>
        </div>
        <div class="chart-box" data-chart="rating"></div>
        <div class="chart-caveat">⚠ Ratings are not comparable across layouts — even par is worth 202 on Pro, 138 on summer league</div>
      </div>
      <div class="card reveal">
        <h3>Rounds per month</h3>
        <p class="note">Volume behind each month’s numbers</p>
        <div class="chart-box" data-chart="rounds"></div>
      </div>
    </div>`;

  const trend = s.monthly_trend;
  const anchorRow = anchorFor(state.layout, state.bench);
  countUp(host.querySelector('[data-hero]'), heroValue);

  lineChart(host.querySelector('[data-chart="rating"]'), trend.map(m => ({
    x: monthName(m.month, { short: true, year: false }),
    y: hasEveryday ? m.everyday_rating : m.avg_rating,
    title: monthName(m.month),
    rows: [
      ...(hasEveryday ? [['Everyday rating', m.everyday_rating ?? '—']] : []),
      ['Month average', m.avg_rating ?? '—'],
      ['Est. PDGA', (hasEveryday ? m.everyday_pdga_est : m.pdga_est) ?? '—'],
      ['Rounds', m.rounds ?? 0],
    ],
  })), {
    unit: hasEveryday ? 'Everyday rating' : 'UDisc rating',
    anchor: anchorRow ? { value: anchorRow.benchmark_value, label: `even par · ${state.layout} (${anchorRow.benchmark_value})` } : null,
  });

  barChart(host.querySelector('[data-chart="rounds"]'), trend.map((m, i) => ({
    label: monthName(m.month, { short: true, year: false }),
    value: m.rounds,
    em: i === trend.length - 1,
    title: monthName(m.month),
    rows: [['Rounds', m.rounds ?? 0], ['Active days', m.active_days ?? '—']],
  })), { maxBarW: 38 });
}

// ── Putting ───────────────────────────────────────────────────────────
export function renderPutting(state) {
  const host = $('#putting-section');
  const s = state.selected;
  const p = s.putting_summary;
  const byDist = s.putting_by_distance;

  if (!p || !byDist) {
    host.innerHTML = `<div class="empty-card reveal"><h4>No putting data for this period</h4>
      <p>Putt Maister sessions populate this section.</p></div>`;
    return;
  }

  const buckets = Object.entries(byDist)
    .map(([k, v]) => ({ m: metres(k), key: k, ...v }))
    .filter(b => Number.isFinite(b.m))
    .sort((a, b) => a.m - b.m);

  const totalAttempts = buckets.reduce((t, b) => t + b.attempts, 0);
  const thin = buckets.filter(b => b.attempts < MIN_PUTT_ATTEMPTS);
  const top = [...buckets].sort((a, b) => b.attempts - a.attempts)[0];
  const concentration = top ? Math.round(top.attempts / totalAttempts * 100) : 0;

  // Freshness: stale putting data should nudge, not silently read as current.
  const daysSince = p.last_session
    ? Math.floor((Date.now() - new Date(`${p.last_session}T00:00:00Z`)) / 86400000) : null;

  host.innerHTML = `
    <div class="putt-headline card reveal">
      <div class="putt-gap">
        <div>
          <div class="kpi-label">C1 make rate · inside 10m</div>
          <div class="putt-big"><span data-putt></span><span class="unit">%</span></div>
          <div class="note" style="margin:0">${p.c1.made} of ${p.c1.attempts} putts · ${p.c1.sessions} sessions</div>
        </div>
        <div class="putt-target">
          <div class="putt-target-row"><span>Target</span><b>${p.c1.target_pct}%</b></div>
          <div class="putt-bar"><div class="putt-bar-fill" data-w="${(p.c1.pct / p.c1.target_pct) * 100}"></div>
            <div class="putt-bar-target" style="left:100%"></div></div>
          <div class="putt-gap-note">${(p.c1.target_pct - p.c1.pct).toFixed(1)} points to target</div>
        </div>
      </div>
      ${daysSince !== null && daysSince > 14 ? `<div class="chart-caveat">⚠ Last putting session ${daysSince} days ago (${fmtDate(p.last_session)}) — these numbers are not current</div>` : ''}
    </div>

    <div class="grid2" style="margin-top:14px">
      <div class="card reveal">
        <h3>Make rate by distance</h3>
        <p class="note">Per metre, all-time — muted bars have fewer than ${MIN_PUTT_ATTEMPTS} attempts</p>
        <div class="chart-box" data-chart="make"></div>
        ${thin.length ? `<div class="chart-caveat">⚠ ${thin.map(b => b.key).join(', ')} rest on ${thin.map(b => b.attempts).join('/')} attempts — differences at these distances are noise, not a cliff</div>` : ''}
      </div>

      <div class="card reveal">
        <h3>Where the reps go</h3>
        <p class="note">Attempts per distance — coverage, not volume, is the gap</p>
        <div class="chart-box" data-chart="dist"></div>
        ${top ? `<div class="chart-caveat neutral">${concentration}% of all attempts are at ${top.key}</div>` : ''}
      </div>
    </div>

    <div class="grid2" style="margin-top:14px">
      <div class="card reveal">
        <h3>Practice format</h3>
        <p class="note">Two different session types, side by side</p>
        <div class="chart-box" data-chart="fmt"></div>
        <div class="legend">
          ${Object.entries(p.by_session_type).map(([k, v], i) =>
            `<span class="legend-item"><span class="legend-swatch" style="background:${i ? COLORS.blue : COLORS.limeDeep}"></span>${esc(k)} · ${v.attempts} putts</span>`).join('')}
        </div>
      </div>
      <div class="card reveal">
        <h3>Circle coverage</h3>
        <p class="note">C1 is inside 10m · C2 is 10–20m</p>
        <div class="circle-rows">
          <div class="circle-row">
            <div><b>C1</b><span class="n-tag">${p.c1.attempts} putts</span></div>
            <div class="circle-pct">${p.c1.pct}%</div>
          </div>
          <div class="circle-row empty">
            <div><b>C2</b><span class="n-tag thin">0 putts</span></div>
            <div class="circle-pct muted">—</div>
          </div>
        </div>
        <p class="note" style="margin-top:12px">Every logged putt so far is inside C1. There is no C2 data to chart — not a gap in the dashboard, a gap in the practice log.</p>
      </div>
    </div>`;

  countUp(host.querySelector('[data-putt]'), p.c1.pct, { decimals: 1 });
  requestAnimationFrame(() => requestAnimationFrame(() =>
    host.querySelectorAll('[data-w]').forEach(b => b.style.width = `${Math.min(100, b.dataset.w)}%`)));

  barChart(host.querySelector('[data-chart="make"]'), buckets.map(b => ({
    label: b.key,
    value: b.pct,
    em: b.attempts >= MIN_PUTT_ATTEMPTS,
    dim: b.attempts < MIN_PUTT_ATTEMPTS,
    title: `${b.key} · ${b.attempts} attempts`,
    rows: [['Make rate', `${b.pct}%`], ['Made', `${b.made} / ${b.attempts}`]],
  })), {
    max: 100, yFmt: v => `${v}%`,
    target: { value: p.c1.target_pct, label: `target ${p.c1.target_pct}%` },
  });

  barChart(host.querySelector('[data-chart="dist"]'), buckets.map(b => ({
    label: b.key,
    value: b.attempts,
    em: b === top,
    title: `${b.key}`,
    rows: [['Attempts', b.attempts], ['Share', `${Math.round(b.attempts / totalAttempts * 100)}%`]],
  })), { yFmt: v => v });

  // One measure, one axis: make rate only. Session and attempt counts are
  // different units and belong in the labels, not as bars on a % scale.
  const types = Object.entries(p.by_session_type);
  barChart(host.querySelector('[data-chart="fmt"]'), types.map(([name, v], i) => ({
    label: name,
    value: v.pct,
    em: true,
    color: i ? COLORS.blue : COLORS.limeDeep,
    title: name,
    rows: [['Make rate', `${v.pct}%`], ['Putts', `${v.made} / ${v.attempts}`], ['Sessions', v.sessions]],
  })), { max: 100, yFmt: v => `${v}%`, height: 200, maxBarW: 64 });
}

// ── Scoring: patterns first, holes as drill-down ──────────────────────
export function renderScoring(state) {
  const host = $('#scoring-section');
  const s = state.selected;
  const byPar = s.scoring_by_par;
  const leakLayouts = Object.keys(s.hole_leak_table);
  const leakLayout = leakLayouts.includes(state.layout) ? state.layout
    : (leakLayouts.includes('Pro') ? 'Pro' : leakLayouts[0]);

  const parRows = byPar ? Object.entries(byPar).map(([k, v]) => ({ key: k, label: k.replace('par', 'Par '), ...v })) : [];

  host.innerHTML = `
    ${byPar ? `
    <div class="card reveal">
      <h3>Scoring by par</h3>
      <p class="note">Strokes over par is the fair comparison — birdie rate is structurally easier on longer holes</p>
      <div class="chart-box" data-chart="par"></div>
      <table class="data-table" style="margin-top:14px">
        <thead><tr><th>Par</th><th class="num">Avg over</th><th class="num">Par or better</th><th class="num">Birdie</th><th class="num">Double+</th><th class="num">Holes</th></tr></thead>
        <tbody>${parRows.map(p => `
          <tr>
            <td style="font-family:var(--font-display); font-weight:600">${esc(p.label)}</td>
            <td class="num${p.avg_over <= 0 ? ' good' : ''}">${p.avg_over > 0 ? '+' : ''}${p.avg_over}</td>
            <td class="num">${p.par_or_better_pct}%</td>
            <td class="num">${p.birdie_pct}%</td>
            <td class="num${p.double_pct >= 7 ? ' hot' : ''}">${p.double_pct}%</td>
            <td class="num muted">${p.holes}</td>
          </tr>`).join('')}</tbody>
      </table>
    </div>` : ''}

    <div class="grid2" style="margin-top:14px">
      <div class="card reveal">
        <h3>Par-or-better trend</h3>
        <p class="note">Share of holes played at par or better, per month</p>
        <div class="chart-box" data-chart="pob"></div>
        <div class="chart-caveat">⚠ Mixes layouts — softer venues lift later months</div>
      </div>

      <div class="card reveal">
        <h3>Par-or-better by layout</h3>
        <p class="note">All-time, per layout — soft and hard venues differ widely</p>
        <div data-list="layouts"></div>
        <div class="chart-caveat" data-caveat="sample"></div>
      </div>
    </div>

    <div class="grid2" style="margin-top:14px">
      <div class="card reveal">
        <h3>Pressure split</h3>
        <p class="note">Saturday rounds = competitive (heuristic), rest = practice</p>
        <div class="chart-box" data-chart="pressure"></div>
        <div class="legend">
          <span class="legend-item"><span class="legend-swatch" style="background:${COLORS.limeDeep}"></span>Competitive</span>
          <span class="legend-item"><span class="legend-swatch" style="background:${COLORS.blue}"></span>Practice</span>
        </div>
      </div>

      <details class="card reveal drill">
        <summary><h3 style="display:inline">Problem holes · ${esc(leakLayout)}</h3>${sampleTag(layoutCount(state, leakLayout))}
          <span class="drill-hint">course-specific detail — expand</span></summary>
        <p class="note" style="margin-top:10px">Five costliest holes on this layout, worst first. Switch layout in the header.</p>
        <table class="data-table">
          <thead><tr><th>Hole</th><th style="width:44%">Avg over par</th><th class="num">Double+ %</th></tr></thead>
          <tbody data-list="leaks"></tbody>
        </table>
      </details>
    </div>`;

  // by-par chart — avg_over leads, per the fair-comparison rule
  if (byPar) {
    barChart(host.querySelector('[data-chart="par"]'), parRows.map(p => ({
      label: p.label,
      value: p.avg_over,
      em: true,
      dim: p.holes < 60,
      title: `${p.label} · ${p.holes} holes`,
      rows: [
        ['Avg over par', p.avg_over],
        ['Par or better', `${p.par_or_better_pct}%`],
        ['Birdie', `${p.birdie_pct}%`],
        ['Double+', `${p.double_pct}%`],
      ],
    })), { yFmt: v => v.toFixed(2), height: 190 });
  }

  const trend = s.monthly_trend;
  barChart(host.querySelector('[data-chart="pob"]'), trend.map((m, i) => ({
    label: monthName(m.month, { short: true, year: false }),
    value: m.par_or_better_pct,
    em: i === trend.length - 1,
    title: monthName(m.month),
    rows: [
      ['All layouts', `${m.par_or_better_pct ?? '—'}%`],
      ['Pro layout', m.pro_par_or_better_pct != null ? `${m.pro_par_or_better_pct}%` : 'no Pro rounds'],
      ['Double+', `${m.double_pct ?? '—'}%`],
    ],
  })), { max: 100, yFmt: v => `${v}%` });

  // layouts
  const listHost = host.querySelector('[data-list="layouts"]');
  const counts = s.rounds_by_layout;
  const entries = Object.entries(s.par_or_better_pct_by_layout).sort((a, b) => b[1] - a[1]);
  listHost.innerHTML = entries.map(([name, pct]) => {
    const active = name === state.layout;
    const n = layoutCount(state, name);
    const isThin = n !== null && n < MIN_SOLID;
    return `
    <div class="layout-row${isThin ? ' thin' : ''}">
      <div>
        <div class="layout-name${active ? ' active' : ''}">${esc(name)}${sampleTag(n)}</div>
        <div class="layout-track"><div class="layout-fill${active ? ' active' : ''}" style="width:0%" data-w="${pct}"></div></div>
      </div>
      <div class="layout-pct${active ? ' active' : ''}">${pct}%</div>
    </div>`;
  }).join('');

  const caveat = host.querySelector('[data-caveat="sample"]');
  if (!counts) caveat.innerHTML = '⚠ Round counts per layout not published yet — treat these as unequal evidence';
  else if (entries.some(([n]) => (layoutCount(state, n) ?? 99) < MIN_SOLID))
    caveat.innerHTML = `⚠ Muted rows have fewer than ${MIN_SOLID} rounds — directional only`;
  else caveat.remove();

  // leaks
  const leaks = s.hole_leak_table[leakLayout] || [];
  const maxOver = Math.max(...leaks.map(l => l.avgOver), 0.01);
  host.querySelector('[data-list="leaks"]').innerHTML = leaks.length ? leaks.map(l => `
    <tr>
      <td style="font-family:var(--font-display); font-weight:600">${esc(l.hole)}</td>
      <td><span class="leak-bar" style="width:${Math.round((l.avgOver / maxOver) * 100)}px"></span>
          <span style="margin-left:8px; font-variant-numeric:tabular-nums">+${Number(l.avgOver).toFixed(2)}</span></td>
      <td class="num ${l.doublePct >= 15 ? 'hot' : ''}">${Number(l.doublePct).toFixed(1)}%</td>
    </tr>`).join('') : `<tr><td colspan="3" style="color:var(--faint)">No leak data for this layout</td></tr>`;

  // pressure
  const ps = s.pressure_split;
  if (ps) {
    groupedBars(host.querySelector('[data-chart="pressure"]'), [
      { label: 'Birdie %', a: ps.competitive?.birdiePct ?? null, b: ps.practice?.birdiePct ?? null },
      { label: 'Par-or-better %', a: ps.competitive?.parOrBetterPct ?? null, b: ps.practice?.parOrBetterPct ?? null },
      { label: 'Double+ %', a: ps.competitive?.doublePct ?? null, b: ps.practice?.doublePct ?? null },
    ], { seriesA: 'Competitive', seriesB: 'Practice' });
  } else {
    host.querySelector('[data-chart="pressure"]').innerHTML = '<p class="note">No pressure data for this period.</p>';
  }

  requestAnimationFrame(() => requestAnimationFrame(() =>
    listHost.querySelectorAll('[data-w]').forEach(b => b.style.width = `${b.dataset.w}%`)));
}

// ── Activity & health ─────────────────────────────────────────────────
export function renderActivity(state) {
  const s = state.selected;
  const host = $('#activity-section');
  // Within-window, not the cumulative-as-of scalars — a check-in over 16 days
  // must not report the same hours as the month that contains it.
  const win = aggregateRange(s, s.period_start, s.period_end);
  const cal = activityCalendar(s);
  const trackedFrom = s.activity_sessions[0]?.date;

  host.innerHTML = `
    <div class="card reveal">
      <h3>Days played &amp; practised</h3>
      <p class="note">Every round and tracked session${trackedFrom ? ` · Apple Watch tracking begins ${fmtDate(trackedFrom)}` : ''}</p>
      <div class="contrib-wrap" data-chart="contrib"></div>
      <div class="legend">
        <span class="legend-item"><span class="legend-swatch contrib-key tracked"></span>Tracked session — shade by duration</span>
        <span class="legend-item"><span class="legend-swatch contrib-key round-only"></span>Round played, no watch data</span>
      </div>
    </div>

    <div class="grid3" style="margin-top:14px">
      <div class="kpi reveal">
        <div class="kpi-label">Active days · this window</div>
        <div class="kpi-value"><span data-count></span></div>
        <div class="kpi-sub">${win.session_count} tracked session${win.session_count === 1 ? '' : 's'} · ${win.rounds_count} round${win.rounds_count === 1 ? '' : 's'}</div>
      </div>
      <div class="kpi reveal">
        <div class="kpi-label">Hours · this window</div>
        <div class="kpi-value"><span data-count></span><span class="unit">h</span></div>
        <div class="kpi-sub">All-time ${s.weekly_activity_hours_total ?? '—'} h (cumulative)</div>
      </div>
      <div class="kpi reveal">
        <div class="kpi-label">Energy · this window</div>
        <div class="kpi-value"><span data-count></span><span class="unit">kcal</span></div>
        <div class="kpi-sub">All-time ${s.total_calories?.toLocaleString('en-GB') ?? '—'} kcal (cumulative)</div>
      </div>
    </div>

    <div class="card reveal" style="margin-top:14px">
      <h3>Heart rate</h3>
      <p class="note">Per month, from tracked disc golf sessions</p>
      <div class="chart-box" data-chart="hr"></div>
    </div>`;

  contributionGraph(host.querySelector('[data-chart="contrib"]'), cal);

  const c = host.querySelectorAll('[data-count]');
  countUp(c[0], win.active_days);
  countUp(c[1], win.activity_hours, { decimals: 1 });
  countUp(c[2], win.activity_calories);

  const hrMonths = s.monthly_trend.filter(x => x.avg_hr != null);
  if (hrMonths.length >= 2) {
    lineChart(host.querySelector('[data-chart="hr"]'), hrMonths.map(x => ({
      x: monthName(x.month, { short: true, year: false }),
      y: x.avg_hr,
      title: monthName(x.month),
      rows: [['Average', `${x.avg_hr} bpm`], ['Max', `${x.max_hr ?? '—'} bpm`], ['Min', `${x.min_hr ?? '—'} bpm`]],
    })), { unit: 'bpm', height: 190 });
  } else {
    host.querySelector('[data-chart="hr"]').innerHTML =
      `<p class="note">${hrMonths.length === 1
        ? `Only one month of tracked heart-rate data so far (${monthName(hrMonths[0].month)}: ${hrMonths[0].avg_hr} bpm average, ${hrMonths[0].max_hr} max). A trend needs two.`
        : 'No tracked heart-rate data yet.'}</p>`;
  }
}

// ── Benchmarks ────────────────────────────────────────────────────────
export function renderBenchmarks(state) {
  const host = $('#benchmarks-section');
  const current = state.selected.pdga_everyday_estimate;
  const targets = state.bench.filter(b => b.category === 'rating_target');
  const players = state.bench.filter(b => b.category === 'player_comparison');
  const anchors = state.bench.filter(b => b.category === 'layout_rating_anchor');

  const targetRows = targets.map(t => {
    const max = Math.max(t.benchmark_value, current) * 1.1;
    const gap = t.benchmark_value - current;
    return `
      <div class="bench-row">
        <div class="bench-name">${esc(t.notes || t.metric)}<small>${esc(t.unit)}</small></div>
        <div class="bench-track">
          <div class="bench-fill" style="width:0%" data-w="${Math.min(100, (current / max) * 100)}"></div>
          <div class="bench-marker" style="left:${(t.benchmark_value / max) * 100}%" data-label="${t.benchmark_value}"></div>
        </div>
        <div class="bench-gap" style="color:${gap > 0 ? 'var(--warn)' : 'var(--lime)'}">${gap > 0 ? `−${gap}` : `+${Math.abs(gap)}`}<small>${gap > 0 ? 'to target' : 'past target'}</small></div>
      </div>`;
  }).join('');

  const playerRows = players.map(p => `
      <div class="bench-row">
        <div class="bench-name">${esc(p.notes || p.metric)}<small>${esc(p.unit)}</small></div>
        <div style="font-size:12.5px; color:var(--muted)">Stroke gap on rated layouts — closes as scoring tightens</div>
        <div class="bench-gap" style="color:var(--warn)">${p.benchmark_value}<small>${esc(p.unit)}</small></div>
      </div>`).join('');

  host.innerHTML = `
    <div class="card reveal">
      <h3>Targets &amp; player gaps</h3>
      <p class="note">Static reference set · current estimate <b style="color:var(--lime)">${current}</b> est. PDGA</p>
      ${targetRows}${playerRows}
      <div class="anchor-chips">
        ${anchors.map(a => {
          const active = anchorFor(state.layout, state.bench)?.metric === a.metric;
          return `<span class="anchor-chip ${active ? 'active' : ''}">${esc(a.metric.replace(/^even_par_rating_/, '').replace(/_/g, ' '))} even par ≈ <b>${a.benchmark_value}</b></span>`;
        }).join('')}
      </div>
      <p class="note" style="margin:12px 0 0">Even-par anchors show how much rating a venue is “worth” — a 64-point spread between Pro and summer league.</p>
    </div>`;

  requestAnimationFrame(() => requestAnimationFrame(() =>
    host.querySelectorAll('[data-w]').forEach(b => b.style.width = `${b.dataset.w}%`)));
}

// ── Mode B: custom date range ─────────────────────────────────────────
export function renderRange(state) {
  const host = $('#range-section');
  const s = state.selected;
  const a = aggregateRange(s, state.rangeStart, state.rangeEnd);
  const cal = activityCalendar({
    rating_history: a.rounds,
    activity_sessions: a.sessions,
  });

  const fmtR = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

  host.innerHTML = `
    <div class="range-banner reveal">
      <div>
        <div class="range-title">${fmtR(a.start)} → ${fmtR(a.end)}</div>
        <div class="range-sub">Raw progression · no coaching evaluation for custom ranges</div>
      </div>
      <div class="range-count">${a.rounds_count} round${a.rounds_count === 1 ? '' : 's'} · ${a.active_days} active day${a.active_days === 1 ? '' : 's'}</div>
    </div>

    <div class="kpis" style="margin-top:14px">
      <div class="kpi kpi-accent reveal">
        <div class="kpi-label">Best rating in range</div>
        <div class="kpi-value"><span data-count></span></div>
        <div class="kpi-sub">Average ${a.avg_rating ?? '—'} · latest ${a.latest_rating ?? '—'}</div>
      </div>
      <div class="kpi reveal">
        <div class="kpi-label">C1 putting in range</div>
        <div class="kpi-value">${a.putt_pct != null ? `<span data-count></span><span class="unit">%</span>` : '<span class="kpi-value-empty">No sessions</span>'}</div>
        <div class="kpi-sub">${a.putt_attempts ? `${a.putt_made} of ${a.putt_attempts} · ${a.putt_session_count} sessions` : 'No putting logged in this range'}</div>
      </div>
      <div class="kpi reveal">
        <div class="kpi-label">Hours</div>
        <div class="kpi-value"><span data-count></span><span class="unit">h</span></div>
        <div class="kpi-sub">${a.activity_calories.toLocaleString('en-GB')} kcal · ${a.session_count} sessions</div>
      </div>
      <div class="kpi reveal">
        <div class="kpi-label">Heart rate</div>
        <div class="kpi-value" style="font-size:30px">${a.avg_hr ?? '—'}<span class="unit">avg bpm</span></div>
        <div class="kpi-sub">${a.max_hr ? `Peak ${a.max_hr} bpm` : 'No tracked sessions in range'}</div>
      </div>
    </div>

    <div class="card reveal" style="margin-top:14px">
      <h3>Rating progression</h3>
      <p class="note">Per round in range — ratings are not comparable across layouts, so hover for the venue</p>
      <div class="chart-box" data-chart="range-rating"></div>
    </div>

    <div class="card reveal" style="margin-top:14px">
      <h3>Days played &amp; practised</h3>
      <p class="note">Within the selected range</p>
      <div class="contrib-wrap" data-chart="range-contrib"></div>
    </div>

    <div class="excluded-note reveal">
      <b>Not shown for custom ranges</b>
      <p>These are computed per calendar month, so they cannot be scoped to an arbitrary range without misrepresenting them:</p>
      <ul>${MODE_B_EXCLUDES.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      <p class="excluded-cta">Switch to an evaluation period to see them, with the coaching analysis.</p>
    </div>`;

  const c = host.querySelectorAll('[data-count]');
  let i = 0;
  countUp(c[i++], a.best_rating);
  if (a.putt_pct != null) countUp(c[i++], a.putt_pct, { decimals: 1 });
  countUp(c[i++], a.activity_hours, { decimals: 1 });

  if (a.rounds.length >= 2) {
    lineChart(host.querySelector('[data-chart="range-rating"]'), a.rounds.map(r => ({
      x: new Date(`${r.date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
      y: r.rating,
      title: fmtR(r.date),
      rows: [['Rating', r.rating], ['Layout', r.layout], ['Course', r.course]],
    })), { unit: 'rating' });
  } else {
    host.querySelector('[data-chart="range-rating"]').innerHTML =
      `<p class="note">${a.rounds.length === 1 ? 'One round in this range — a trend needs at least two.' : 'No rounds in this range.'}</p>`;
  }

  contributionGraph(host.querySelector('[data-chart="range-contrib"]'), cal, { start: a.start, end: a.end });
}

// ── Footer ────────────────────────────────────────────────────────────
export function renderFooter(state) {
  const { metaRows } = state;
  const latest = metaRows.map(r => r.processed_at).sort().at(-1);
  const runRows = metaRows.filter(r => latest && r.processed_at?.slice(0, 16) === latest.slice(0, 16));
  const due = nextUploadDue(metaRows);
  $('#footer').innerHTML = `
    <span>Last pipeline run <b>${fmtDate(latest, { time: true })}</b></span>
    <span>Files processed <b>${runRows.length}</b></span>
    <span>Next scheduled run <b>${due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</b></span>
    <span>Source <b>published Sheet CSV · no backend</b></span>`;
}
