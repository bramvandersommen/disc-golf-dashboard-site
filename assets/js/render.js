// Section renderers. Every function renders FROM STORED DATA ONLY —
// no coaching conclusions are derived here (hard rule, see CLAUDE.md).

import { monthName, fmtDate, nextUploadDue } from './data.js';
import { lineChart, barChart, groupedBars, gauge, countUp, showTip, hideTip, ttHtml, COLORS, reducedMotion } from './charts.js';

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
  const good = up === goodWhenUp;
  return `<span class="delta ${good ? '' : 'down'}">${up ? '↑' : '↓'} ${Math.abs(r)}${unit}</span>`;
};

// Layouts are fully data-derived: new venues appear in the Sheet as Bram travels
// and must absorb with no code change. Anchors are matched by comparing the
// benchmark metric's trailing token against the layout name, so a new
// `even_par_rating_<x>` row wires itself up. No layout list is hardcoded.
function anchorFor(layoutName, bench) {
  if (!layoutName || layoutName === 'all') return null;
  const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const layout = norm(layoutName);
  const anchors = bench.filter(b => b.category === 'layout_rating_anchor');
  return anchors.find(b => {
    const token = norm(b.metric.replace(/^even_par_rating_/, ''));
    return token && (layout === token || layout.startsWith(token) || token.startsWith(layout));
  }) || null;
}

// Sample-size thresholds. Below MIN_SOLID a per-layout figure is shown but
// visually de-emphasised; below MIN_TREND no per-layout trend is drawn.
const MIN_SOLID = 5;
const MIN_TREND = 3;

const layoutCount = (state, name) => state.selected.rounds_by_layout?.[name] ?? null;

// Renders "n=N rounds" when counts exist; states plainly that they don't when
// they're absent. Never guesses a sample size.
function sampleTag(n) {
  if (n === null) return '';
  const thin = n < MIN_SOLID;
  return `<span class="n-tag${thin ? ' thin' : ''}" title="${n} round${n === 1 ? '' : 's'} on this layout">n=${n}</span>`;
}

// ── KPI row ───────────────────────────────────────────────────────────
export function renderKpis(state) {
  const { selected, prev } = state;
  const trend = selected.monthly_trend;
  const lastM = trend.at(-1) || {};
  const prevM = trend.at(-2) || {};
  const el = $('#kpi-row');

  const pdgaDelta = prev ? selected.pdga_everyday_estimate - prev.pdga_everyday_estimate : null;
  const proDelta = (lastM.pro_par_or_better_pct != null && prevM.pro_par_or_better_pct != null)
    ? lastM.pro_par_or_better_pct - prevM.pro_par_or_better_pct : null;

  // A month with no Pro-layout rounds is normal (travel, one-round months), not
  // a failure. Say so, and fall back to the most recent month that has one.
  const lastPro = [...trend].reverse().find(m => m.pro_par_or_better_pct != null);
  const proKpi = lastM.pro_par_or_better_pct != null
    ? `<div class="kpi reveal">
        <div class="kpi-label">Par-or-better · Pro layout</div>
        <div class="kpi-value"><span data-count></span><span class="unit">%</span>${deltaBadge(proDelta, { unit: ' pp', decimals: 1 })}</div>
        <div class="kpi-sub">${monthName(lastM.month)} · same layout every month — the clean signal</div>
      </div>`
    : `<div class="kpi kpi-stale reveal">
        <div class="kpi-label">Par-or-better · Pro layout</div>
        <div class="kpi-value kpi-value-empty">No Pro rounds<span class="kpi-empty-sub">this period</span></div>
        <div class="kpi-sub">${lastPro
          ? `Last recorded <b>${lastPro.pro_par_or_better_pct}%</b> in ${monthName(lastPro.month)}`
          : 'No Pro-layout rounds recorded yet'}</div>
      </div>`;

  el.innerHTML = `
    <div class="kpi kpi-accent reveal">
      <div class="kpi-label">Estimated PDGA · last 10 rounds</div>
      <div class="kpi-value"><span data-count></span>${deltaBadge(pdgaDelta, { unit: '', goodWhenUp: true })}</div>
      <div class="kpi-sub">Model estimate, not an official rating.<br>UDisc avg last 10: <b>${selected.udisc_avg_recent_10 ?? '—'}</b> · best-round est. ${selected.pdga_best_estimate ?? '—'}</div>
    </div>
    ${proKpi}
    <div class="kpi reveal">
      <div class="kpi-label">Practice streak</div>
      <div class="kpi-value"><span data-count></span><span class="unit">days</span></div>
      <div class="kpi-sub">“Kept at it” streak — gaps ≤ 2 days count as continuous</div>
    </div>
    <div class="kpi reveal">
      <div class="kpi-label">Data through</div>
      <div class="kpi-value" style="font-size:26px; padding-top:7px">${fmtDate(selected.computed_at)}</div>
      <div class="kpi-sub">${selected.rounds_count ?? '—'} rounds by Bram in the dataset</div>
    </div>`;

  const counts = el.querySelectorAll('[data-count]');
  countUp(counts[0], selected.pdga_everyday_estimate);
  if (lastM.pro_par_or_better_pct != null) {
    countUp(counts[1], lastM.pro_par_or_better_pct, { decimals: 1 });
    countUp(counts[2], selected.practice_streak_days);
  } else {
    countUp(counts[1], selected.practice_streak_days);
  }
}

// ── Coaching highlight strip (under the KPI row) ──────────────────────
// Renders the STORED headline + priority titles as a prominent pointer to
// the full panel. No coaching text is generated here.
export function renderCoachStrip(state) {
  const host = $('#coach-strip');
  const row = state.evalByPeriod.get(state.selected.period_label);

  if (!row) {
    // most recent period that has an evaluation, for one-tap navigation
    const latest = state.periods.find(p => state.evalByPeriod.has(p.period_label));
    host.innerHTML = `
      <div class="coach-strip coach-strip-empty reveal">
        <span class="coach-strip-tag">Coaching</span>
        <span class="coach-strip-note">No evaluation for this period yet.</span>
        ${latest ? `<button class="coach-strip-link" data-goto="${latest.period_label}">Latest evaluation · ${monthName(latest.period_label)} →</button>` : ''}
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
        <span class="coach-strip-tag">Coaching focus · ${esc(state.selected.period_label)}</span>
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
      <div class="eval-tag">Coaching evaluation · ${esc(state.selected.period_label)}</div>
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
  host.innerHTML = `
    <div class="grid2">
      <div class="card reveal">
        <h3>Rating trajectory</h3>
        <p class="note">Monthly average UDisc rating · Est. PDGA equivalent on hover</p>
        <div class="chart-box" data-chart="rating"></div>
        <div class="chart-caveat" title="Rating asymmetry across layouts is large — even par is worth 202 on Pro but 138 on summer league.">
          ⚠ Mixes layouts — venue changes can read as rating swings
        </div>
      </div>
      <div class="card reveal">
        <h3>Rounds per month</h3>
        <p class="note">Volume behind each month’s numbers</p>
        <div class="chart-box" data-chart="rounds"></div>
      </div>
    </div>`;

  const trend = state.selected.monthly_trend;
  const anchorRow = anchorFor(state.layout, state.bench);

  lineChart(host.querySelector('[data-chart="rating"]'), trend.map(m => ({
    x: monthName(m.month, { short: true, year: false }),
    y: m.avg_rating,
    title: monthName(m.month),
    rows: [
      ['Avg UDisc rating', m.avg_rating],
      ['Est. PDGA', m.pdga_est],
      ['Rounds', m.rounds],
    ],
  })), {
    unit: 'UDisc rating',
    anchor: anchorRow ? { value: anchorRow.benchmark_value, label: `even par · ${state.layout} (${anchorRow.benchmark_value})` } : null,
  });

  barChart(host.querySelector('[data-chart="rounds"]'), trend.map((m, i) => ({
    label: monthName(m.month, { short: true, year: false }),
    value: m.rounds,
    em: i === trend.length - 1,
    title: monthName(m.month),
    rows: [['Rounds', m.rounds]],
  })), { yAxis: true, maxBarW: 38 });
}

// ── Scoring & problem holes ───────────────────────────────────────────
export function renderScoring(state) {
  const host = $('#scoring-section');
  const mode = state.scoringMode || 'pro';
  const layouts = Object.keys(state.selected.par_or_better_pct_by_layout);
  const leakLayouts = Object.keys(state.selected.hole_leak_table);
  const leakLayout = leakLayouts.includes(state.layout) ? state.layout : (leakLayouts.includes('Pro') ? 'Pro' : leakLayouts[0]);

  host.innerHTML = `
    <div class="grid2">
      <div class="card reveal">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap">
          <div><h3>Par-or-better trend</h3><p class="note">Share of holes played at par or better</p></div>
          <div class="seg-toggle">
            <button data-mode="pro" class="${mode === 'pro' ? 'active' : ''}">Pro layout</button>
            <button data-mode="all" class="${mode === 'all' ? 'active' : ''}">All layouts</button>
          </div>
        </div>
        <div class="chart-box" data-chart="pob"></div>
        ${mode === 'all' ? `<div class="chart-caveat">⚠ Mixed layouts — softer venues inflate later months</div>` : ''}
      </div>

      <div class="card reveal">
        <h3>Par-or-better by layout</h3>
        <p class="note">All-time, per layout — soft and hard venues differ widely</p>
        <div data-list="layouts"></div>
        <div class="chart-caveat" data-caveat="sample"></div>
      </div>

      <div class="card reveal">
        <h3>Problem holes · ${esc(leakLayout)}${sampleTag(layoutCount(state, leakLayout))}</h3>
        <p class="note">Five costliest holes, worst first${leakLayouts.length > 1 ? ' — switch layout in the header' : ''}</p>
        <table class="data-table">
          <thead><tr><th>Hole</th><th style="width:44%">Avg over par</th><th class="num">Double+ %</th></tr></thead>
          <tbody data-list="leaks"></tbody>
        </table>
      </div>

      <div class="card reveal">
        <h3>Pressure split</h3>
        <p class="note">Saturday rounds = competitive (heuristic), rest = practice</p>
        <div class="chart-box" data-chart="pressure"></div>
        <div class="legend">
          <span class="legend-item"><span class="legend-swatch" style="background:${COLORS.limeDeep}"></span>Competitive</span>
          <span class="legend-item"><span class="legend-swatch" style="background:${COLORS.blue}"></span>Practice</span>
        </div>
      </div>
    </div>`;

  host.querySelectorAll('.seg-toggle button').forEach(btn =>
    btn.addEventListener('click', () => { state.scoringMode = btn.dataset.mode; renderScoring(state); }));

  // par-or-better trend
  const trend = state.selected.monthly_trend;
  barChart(host.querySelector('[data-chart="pob"]'), trend.map((m, i) => ({
    label: monthName(m.month, { short: true, year: false }),
    value: mode === 'pro' ? m.pro_par_or_better_pct : m.par_or_better_pct,
    em: i === trend.length - 1,
    dim: mode === 'all',
    title: monthName(m.month),
    rows: [
      ['Pro layout', m.pro_par_or_better_pct != null ? `${m.pro_par_or_better_pct}%` : 'no Pro rounds'],
      ['All layouts', `${m.par_or_better_pct}%`],
      ['Birdie % (mixed)', `${m.birdie_pct}%`],
      ['Double+ %', `${m.double_pct}%`],
    ],
  })), { max: 100, yFmt: v => `${v}%` });

  // layout list (HTML bars — long names need room)
  const listHost = host.querySelector('[data-list="layouts"]');
  const counts = state.selected.rounds_by_layout;
  const entries = Object.entries(state.selected.par_or_better_pct_by_layout).sort((a, b) => b[1] - a[1]);
  listHost.innerHTML = entries.map(([name, pct]) => {
    const active = name === state.layout;
    const n = layoutCount(state, name);
    // Thin samples stay visible but must not read as solid as a 17-round layout.
    const thin = n !== null && n < MIN_SOLID;
    return `
    <div class="layout-row${thin ? ' thin' : ''}">
      <div>
        <div class="layout-name${active ? ' active' : ''}">${esc(name)}${sampleTag(n)}</div>
        <div class="layout-track">
          <div class="layout-fill${active ? ' active' : ''}" style="width:0%" data-w="${pct}"></div>
        </div>
      </div>
      <div class="layout-pct${active ? ' active' : ''}">${pct}%</div>
    </div>`;
  }).join('');

  const caveat = host.querySelector('[data-caveat="sample"]');
  if (!counts) {
    caveat.innerHTML = '⚠ Sample sizes vary — round counts per layout not published yet, so treat these as unequal evidence';
  } else if (entries.some(([name]) => (layoutCount(state, name) ?? 99) < MIN_SOLID)) {
    caveat.innerHTML = `⚠ Muted rows have fewer than ${MIN_SOLID} rounds — directional only`;
  } else {
    caveat.remove();
  }
  requestAnimationFrame(() => requestAnimationFrame(() =>
    listHost.querySelectorAll('[data-w]').forEach(b => b.style.width = `${b.dataset.w}%`)));

  // hole leaks
  const leaks = state.selected.hole_leak_table[leakLayout] || [];
  const maxOver = Math.max(...leaks.map(l => l.avgOver), 0.01);
  const leakN = layoutCount(state, leakLayout);
  if (leakN !== null && leakN < MIN_TREND) {
    const note = document.createElement('div');
    note.className = 'chart-caveat';
    note.textContent = `⚠ Only ${leakN} round${leakN === 1 ? '' : 's'} here — single-round holes show as 0% or 100%`;
    host.querySelector('[data-list="leaks"]').closest('.card').appendChild(note);
  }
  host.querySelector('[data-list="leaks"]').innerHTML = leaks.length ? leaks.map(l => `
    <tr>
      <td style="font-family:var(--font-display); font-weight:600">${esc(l.hole)}</td>
      <td><span class="leak-bar" style="width:${Math.round((l.avgOver / maxOver) * 100)}px"></span>
          <span style="margin-left:8px; font-variant-numeric:tabular-nums">+${Number(l.avgOver).toFixed(2)}</span></td>
      <td class="num ${l.doublePct >= 15 ? 'hot' : ''}">${Number(l.doublePct).toFixed(1)}%</td>
    </tr>`).join('')
    : `<tr><td colspan="3" style="color:var(--faint)">No leak data for this layout</td></tr>`;

  // pressure split
  const ps = state.selected.pressure_split;
  if (ps) {
    groupedBars(host.querySelector('[data-chart="pressure"]'), [
      { label: 'Birdie %', a: ps.competitive?.birdiePct ?? null, b: ps.practice?.birdiePct ?? null },
      { label: 'Par-or-better %', a: ps.competitive?.parOrBetterPct ?? null, b: ps.practice?.parOrBetterPct ?? null },
      { label: 'Double+ %', a: ps.competitive?.doublePct ?? null, b: ps.practice?.doublePct ?? null },
    ], { seriesA: 'Competitive', seriesB: 'Practice' });
  } else {
    host.querySelector('[data-chart="pressure"]').innerHTML = '<p class="note">No pressure data for this period.</p>';
  }
}

// ── Driving (no backend data yet) ─────────────────────────────────────
export function renderDriving() {
  $('#driving-section').innerHTML = `
    <div class="empty-card reveal">
      <svg class="empty-icon" viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <ellipse cx="20" cy="20" rx="16" ry="9" stroke="currentColor" stroke-width="2"/>
        <path d="M4 20c10-3 22-3 32 0" stroke="currentColor" stroke-width="1.5"/>
      </svg>
      <h4>TechDisc data isn’t in the pipeline yet</h4>
      <p>Throw speed, spin, nose angle and the disc engagement window will render here once the backend ingests TechDisc exports.</p>
      <span class="req-chip">Requested from backend · _contract/requests/</span>
    </div>`;
}

// ── Putting ───────────────────────────────────────────────────────────
export function renderPutting(state) {
  const host = $('#putting-section');
  host.innerHTML = `
    <div class="card reveal">
      <h3>Make % by distance</h3>
      <p class="note">All-time, 5 ft buckets · Putt Maister sessions</p>
      <div class="chart-box" data-chart="putting"></div>
    </div>`;

  const buckets = Object.entries(state.selected.putting_pct_by_distance)
    .map(([k, v]) => ({ ft: parseInt(k), pct: v }))
    .filter(b => Number.isFinite(b.ft))
    .sort((a, b) => a.ft - b.ft);

  const target = state.bench.find(b => b.metric === 'c1_putting_target_pct');

  barChart(host.querySelector('[data-chart="putting"]'), buckets.map(b => ({
    label: `${b.ft} ft`,
    value: b.pct,
    em: true,
    title: `${b.ft} ft`,
    rows: [['Make rate', `${b.pct}%`]],
  })), {
    max: 100, yFmt: v => `${v}%`,
    target: target ? { value: target.benchmark_value, label: `C1 target ${target.benchmark_value}%` } : null,
  });
}

// ── Activity & health ─────────────────────────────────────────────────
export function renderActivity(state) {
  const s = state.selected;
  const host = $('#activity-section');
  host.innerHTML = `
    <div class="grid3">
      <div class="kpi reveal">
        <div class="kpi-label">Practice streak</div>
        <div class="kpi-value"><span data-count></span><span class="unit">days</span></div>
        <div class="kpi-sub">Gaps ≤ 2 days count as continuous — a “kept at it” measure, not consecutive days</div>
      </div>
      <div class="kpi reveal">
        <div class="kpi-label">Activity hours · all-time</div>
        <div class="kpi-value"><span data-count></span><span class="unit">h</span></div>
        <div class="kpi-sub">Cumulative disc golf activity from Apple Watch</div>
      </div>
      <div class="kpi reveal">
        <div class="kpi-label">Energy burned · all-time</div>
        <div class="kpi-value"><span data-count></span><span class="unit">kcal</span></div>
        <div class="kpi-sub">Disc golf workouts only</div>
      </div>
    </div>
    <div class="empty-card reveal" style="margin-top:14px">
      <h4>Heart-rate trend isn’t published yet</h4>
      <p>Monthly HR and hours series need a backend aggregate — requested; renders here when it lands.</p>
      <span class="req-chip">Requested from backend · _contract/requests/</span>
    </div>`;

  const counts = host.querySelectorAll('[data-count]');
  countUp(counts[0], s.practice_streak_days);
  countUp(counts[1], s.weekly_activity_hours_total, { decimals: 1 });
  countUp(counts[2], s.total_calories);
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
    const fillPct = Math.min(100, (current / max) * 100);
    const markPct = (t.benchmark_value / max) * 100;
    const gap = t.benchmark_value - current;
    return `
      <div class="bench-row">
        <div class="bench-name">${esc(t.notes || t.metric)}<small>${esc(t.unit)}</small></div>
        <div class="bench-track">
          <div class="bench-fill" style="width:0%" data-w="${fillPct}"></div>
          <div class="bench-marker" style="left:${markPct}%" data-label="${t.benchmark_value}"></div>
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
          const label = a.metric.replace(/^even_par_rating_/, '').replace(/_/g, ' ');
          return `<span class="anchor-chip ${active ? 'active' : ''}">${esc(label)} even par ≈ <b>${a.benchmark_value}</b></span>`;
        }).join('')}
      </div>
      <p class="note" style="margin:12px 0 0">Even-par anchors show how much rating a venue is “worth” — a 64-point spread between Pro and summer league. That is why the rating chart carries a layout caveat.</p>
    </div>`;

  requestAnimationFrame(() => requestAnimationFrame(() =>
    host.querySelectorAll('[data-w]').forEach(b => b.style.width = `${b.dataset.w}%`)));
}

// ── Bag ───────────────────────────────────────────────────────────────
export function renderBag() {
  $('#bag-section').innerHTML = `
    <div class="empty-card reveal">
      <svg class="empty-icon" viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <path d="M12 14h16l-2 20H14l-2-20Z" stroke="currentColor" stroke-width="2"/>
        <path d="M15 14a5 5 0 0 1 10 0" stroke="currentColor" stroke-width="2"/>
      </svg>
      <h4>Bag not documented yet</h4>
      <p>This section renders manually curated gear from <code>disc_collection.md</code>. Add the file to the repo and the bag appears here.</p>
      <span class="req-chip">Manual source · disc_collection.md</span>
    </div>`;
}

// ── Footer ────────────────────────────────────────────────────────────
export function renderFooter(state) {
  const { metaRows } = state;
  const latest = metaRows.map(r => r.processed_at).sort().at(-1);
  const runRows = metaRows.filter(r => r.processed_at && latest && r.processed_at.slice(0, 16) === latest.slice(0, 16));
  const due = nextUploadDue(metaRows);
  $('#footer').innerHTML = `
    <span>Last pipeline run <b>${fmtDate(latest, { time: true })}</b></span>
    <span>Files processed that run <b>${runRows.length}</b></span>
    <span>Next scheduled run <b>${due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</b></span>
    <span>Source <b>published Sheet CSV · no backend</b></span>`;
}
