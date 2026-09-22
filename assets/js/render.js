// Section renderers. Every function renders FROM STORED DATA ONLY —
// no coaching conclusions are derived here (hard rule, see CLAUDE.md).
// All distances are metric; the putts tab's distance_ft is never read.

import { monthName, periodName, periodRange, fmtDate, nextUploadDue, aggregateRange, activityCalendar, streakStats, matchRoundStats, MODE_B_EXCLUDES } from './data.js?v=202609221257';
import { lineChart, barChart, groupedBars, contributionGraph, countUp, showTip, hideTip, ttHtml, COLORS } from './charts.js?v=202609221257';
import { renderFlightSvg, distanceM, flightOf } from './flight.js?v=202609221257';

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

// ── Profile + streak hero ─────────────────────────────────────────────
const PROFILE = {
  name: 'Bram van der Sommen',
  udisc: 'https://app.udisc.com/applink/community/profile?profileId=b67xb9URBB',
  pdga: 'https://www.pdga.com/player/331394',
  pdgaNo: '331394',
};

export function renderProfile(state) {
  const s = state.selected;
  const cal = activityCalendar(s);
  const st = streakStats(cal);
  const host = $('#profile-section');

  host.innerHTML = `
    <div class="profile reveal">
      <div class="profile-id">
        <img class="profile-avatar" src="assets/img/avatar.jpg" alt="" width="72" height="72" loading="lazy">
        <div class="profile-meta">
          <h2 class="profile-name">${esc(PROFILE.name)}</h2>
          <div class="profile-links">
            <a class="profile-link" href="${PROFILE.udisc}" target="_blank" rel="noopener noreferrer">
              <span class="profile-link-mark">UDisc</span>Profile
              <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2h6v6M10 2L2.5 9.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
            </a>
            <a class="profile-link" href="${PROFILE.pdga}" target="_blank" rel="noopener noreferrer">
              <span class="profile-link-mark">PDGA</span>#${esc(PROFILE.pdgaNo)}
              <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2h6v6M10 2L2.5 9.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
            </a>
          </div>
        </div>
      </div>

      <div class="streak-block">
        <div class="streak-stats">
          <div class="streak-stat"><b data-s></b><span>days out</span></div>
          <div class="streak-stat"><b data-s></b><span>longest run</span></div>
          <div class="streak-stat"><b data-s></b><span>last 30 days</span></div>
        </div>
        <div class="contrib-wrap streak-graph" data-chart="streak"></div>
        <div class="streak-foot">
          <span class="streak-hint">Every day played or practised${st.first ? ` · since ${fmtDate(st.first)}` : ''}</span>
          <span class="streak-key">
            <i class="contrib-key round-only"></i>round
            <i class="contrib-key tracked"></i>tracked
          </span>
        </div>
      </div>
    </div>`;

  const b = host.querySelectorAll('[data-s]');
  countUp(b[0], st.total);
  countUp(b[1], st.longest);
  countUp(b[2], st.last30);
  contributionGraph(host.querySelector('[data-chart="streak"]'), cal, { compact: true });
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
  // The strip is the shortcut to the full read — jumping there while the
  // panel is still collapsed would look like a dead link, so open it too.
  setTimeout(() => host.querySelector('.coach-strip')?.addEventListener('click', () => {
    const d = document.getElementById('eval-details');
    if (d) d.open = true;
  }), 0);
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

  // Collapsed by default: the headline is the summary, the rest is opt-in so
  // the stats below stay reachable without scrolling past ~3,000 characters.
  const prioCount = (row.priorities || []).length;
  host.innerHTML = `
    <details class="eval-panel reveal" id="eval-details">
      <summary class="eval-summary">
        <div class="eval-tag">Coaching evaluation · ${esc(periodName(state.selected, { withRange: true }))}</div>
        <h3 class="eval-headline">${esc(row.headline)}</h3>
        <span class="eval-toggle">
          <span class="eval-toggle-open">Read full evaluation${prioCount ? ` · ${prioCount} priorit${prioCount === 1 ? 'y' : 'ies'}` : ''}</span>
          <span class="eval-toggle-close">Collapse</span>
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4.5L6 8.5L10 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
      </summary>
      <div class="eval-body">
        <div class="eval-narrative">${md(row.narrative_md)}</div>
        ${prios ? `<div class="eval-priorities">${prios}</div>` : ''}
        ${row.changed_since_last ? `
          <div class="eval-changed">
            <div class="eval-changed-label">Changed since last evaluation</div>
            <div class="eval-changed-body">${md(row.changed_since_last)}</div>
          </div>` : ''}
        <div class="eval-meta">Generated ${fmtDate(row.generated_at, { time: true })} · from stats computed ${fmtDate(row.source_stats_computed_at, { time: true })}</div>
      </div>
    </details>`;
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

  // Progression, same treatment as the rating trajectory. Months with no
  // logged session carry `putting: null` and are dropped rather than plotted
  // as 0% — an unpractised month is absent data, not a miss.
  const puttTrend = s.monthly_trend.filter(m => m.putting?.c1_pct != null);

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

    ${puttTrend.length >= 2 ? `
    <div class="card reveal" style="margin-top:14px">
      <h3>Putting accuracy over time</h3>
      <p class="note">C1 make rate per month, against the ${p.c1.target_pct}% target</p>
      <div class="chart-box" data-chart="putt-trend"></div>
      <div class="chart-caveat neutral">Months without a logged session are skipped, not drawn as zero</div>
    </div>` : ''}`;

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

  if (puttTrend.length >= 2) {
    lineChart(host.querySelector('[data-chart="putt-trend"]'), puttTrend.map(m => ({
      x: monthName(m.month, { short: true, year: false }),
      y: m.putting.c1_pct,
      title: monthName(m.month),
      rows: [
        ['C1 make rate', `${m.putting.c1_pct}%`],
        ['Putts', `${m.putting.c1_attempts}`],
        ['Sessions', m.putting.sessions],
      ],
    })), {
      unit: 'C1 make rate',
      yFmt: v => `${v}%`,
      anchor: { value: p.c1.target_pct, label: `target ${p.c1.target_pct}%` },
    });
  }
}

// ── Scoring: patterns first, holes as drill-down ──────────────────────
export function renderScoring(state) {
  const host = $('#scoring-section');
  const s = state.selected;
  const byPar = s.scoring_by_par;

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

    <div style="margin-top:14px">
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

// ── Advanced round stats (UDisc Pro, optional + sparse) ───────────────
// Renders only on an unambiguous course+layout+date match. Absent values
// print as "—", never 0 — a blank scramble_pct means no scramble arose.
export function renderRoundStats(state) {
  const section = document.getElementById('roundstats');
  const host = $('#roundstats-section');
  const { matched, ambiguous } = matchRoundStats(state.selected, state.roundStatRows);

  // Only rounds inside the selected window
  const inWindow = matched.filter(m =>
    m.date >= state.selected.period_start && m.date <= state.selected.period_end);

  if (!inWindow.length) { section.hidden = true; return; }
  section.hidden = false;

  const pct = v => v === null ? '<span class="stat-absent">—</span>' : `${v}<span class="stat-unit">%</span>`;
  const TRIPLET = [
    { k: 'c1x_pct', label: 'C1X putting', hint: 'inside 10m, excluding tap-ins' },
    { k: 'gir_c1_pct', label: 'GIR C1', hint: 'in the circle in regulation' },
    { k: 'fairway_pct', label: 'Driving accuracy', hint: 'fairway hit' },
  ];
  const SECONDARY = [
    { k: 'c2_pct', label: 'C2 putting' },
    { k: 'gir_c2_pct', label: 'GIR C2' },
    { k: 'parked_pct', label: 'Parked' },
    { k: 'scramble_pct', label: 'Scramble' },
    { k: 'birdie_pct', label: 'Birdie' },
  ];

  host.innerHTML = inWindow.map(m => `
    <div class="card reveal rs-card">
      <div class="rs-head">
        <div>
          <h3>${esc(m.course)} · ${esc(m.layout)}</h3>
          <p class="note">${fmtDate(m.date)}${m.round?.rating != null ? ` · round rated <b>${m.round.rating}</b>` : ''}</p>
        </div>
        <span class="rs-source">UDisc Pro</span>
      </div>

      <div class="rs-triplet">
        ${TRIPLET.map(t => `
          <div class="rs-stat">
            <div class="rs-stat-value">${pct(m[t.k])}</div>
            <div class="rs-stat-label">${t.label}</div>
            <div class="rs-stat-hint">${t.hint}</div>
          </div>`).join('')}
      </div>

      <div class="rs-secondary">
        ${SECONDARY.map(s => `
          <span class="rs-chip${m[s.k] === null ? ' absent' : ''}">
            ${s.label}<b>${m[s.k] === null ? 'not recorded' : `${m[s.k]}%`}</b>
          </span>`).join('')}
        ${m.penalties !== null ? `<span class="rs-chip">Penalties<b>${m.penalties}</b></span>` : ''}
      </div>

      ${m.notes ? `<p class="rs-notes">${esc(m.notes)}</p>` : ''}
    </div>`).join('')
    + (ambiguous.length ? `
      <div class="empty-card reveal" style="margin-top:14px">
        <h4>${ambiguous.length} round${ambiguous.length === 1 ? '' : 's'} not shown</h4>
        <p>Two rounds share that course, layout and date, so these stats can't be attributed to one of them without guessing.</p>
      </div>` : '');
}

// ── Coaching log (optional drill-down, verbatim) ──────────────────────
export function renderCoachingLog(state) {
  const section = document.getElementById('coachlog');
  const host = $('#coachlog-section');
  const notes = state.coachingNotes || [];
  if (!notes.length) { section.hidden = true; return; }
  section.hidden = false;

  host.innerHTML = `
    <details class="card reveal drill">
      <summary><h3 style="display:inline">Coaching notes</h3>
        <span class="n-tag">${notes.length}</span>
        <span class="drill-hint">qualitative context — expand</span>
      </summary>
      <p class="note" style="margin-top:10px">Written by the coaching layer. Context the numbers don't carry; no chart depends on it.</p>
      <div class="log-list">
        ${notes.map(n => `
          <div class="log-item">
            <div class="log-meta">
              <span class="log-type ${esc(n.type)}">${esc(n.type.replace(/_/g, ' '))}</span>
              <span class="log-date">${fmtDate(n.logged_at)}</span>
              ${n.course && !/^\(/.test(n.course) ? `<span class="log-where">${esc(n.course)}${n.layout && !/^\(/.test(n.layout) ? ` · ${esc(n.layout)}` : ''}</span>` : ''}
            </div>
            ${n.topic ? `<div class="log-topic">${esc(n.topic)}</div>` : ''}
            <p class="log-note">${esc(n.note)}</p>
          </div>`).join('')}
      </div>
    </details>`;
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

// ── Bag (Part 2) ──────────────────────────────────────────────────────
// Equipment view: grid of discs → click for a detail modal with that disc's
// flight path; a compare overlay for several at once. Reads state.discs (the
// Discs tab) — no hardcoded disc data. Period-independent, so built once.
const BAG_TYPES = ['ALL', 'DRIVER', 'FAIRWAY', 'MIDRANGE', 'PUTTER'];
const BAG_TLABEL = { ALL: 'All', DRIVER: 'Drivers', FAIRWAY: 'Fairway', MIDRANGE: 'Midrange', PUTTER: 'Putters' };
const BAG_SLIDERS = [['speed', 'Speed'], ['glide', 'Glide'], ['turn', 'Turn'], ['fade', 'Fade']];
const BAG_COLORS = ['#C8FF4D', '#6883D6', '#7A9F2C', '#E0B341', '#D97757', '#5FB3B3', '#C98BDB', '#E8778F'];
const bagStability = d => { const s = (d.turn ?? 0) + (d.fade ?? 0); return s < -1 ? 'understable' : s <= 1 ? 'neutral' : s <= 3 ? 'stable' : 'overstable'; };
const IMG = id => `discs/${id}.webp`;   // relative — served from the same Pages origin
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let bagBuilt = false;

export function renderBag(state) {
  const discs = state.discs || [];
  const host = $('#bag-section');
  if (!host) return;
  if (!discs.length) { host.innerHTML = `<div class="empty-card reveal"><h4>No bag data yet</h4><p class="note">The Discs tab returned no rows.</p></div>`; return; }
  if (bagBuilt) return;                  // equipment doesn't change per period
  bagBuilt = true;

  const byId = id => discs.find(d => d.id === id);
  const bounds = {}, range = {};
  for (const [k] of BAG_SLIDERS) { const vs = discs.map(d => d[k]).filter(Number.isFinite); bounds[k] = [Math.min(...vs), Math.max(...vs)]; range[k] = [...bounds[k]]; }
  let type = 'ALL', sort = 'speed-desc', ovType = 'DRIVER';
  let compare = discs.filter(d => d.type === 'DRIVER').sort((a, b) => b.speed - a.speed).slice(0, 3).map(d => d.id);

  host.innerHTML = `
    <div class="bag-toolbar" data-el="pills"></div>
    <div class="bag-filters" data-el="filters"></div>
    <div class="bag-filters-foot"><button class="bag-link" data-el="reset">Reset filters</button></div>
    <div class="bag-grid" data-el="grid"></div>
    <div class="bag-over card reveal" data-el="overcard" style="margin-top:22px">
      <div class="bag-over-grid">
        <div>
          <h3 style="font-family:var(--font-display);font-size:18px;margin:0 0 3px">Compare flight paths</h3>
          <p class="note">Add a few discs to one chart — the gap-spotting view. Filter by type, then tap to add. RHBH, normal power, metres.</p>
          <div class="bag-ovfilter" data-el="ovfilter"></div>
          <div class="bag-chips" data-el="chips"></div>
        </div>
        <div class="bag-bigchart" data-el="bigchart"></div>
      </div>
    </div>`;
  const q = sel => host.querySelector(`[data-el="${sel}"]`);

  // modal (singleton on body)
  let modal = document.querySelector('.bag-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'bag-modal'; modal.hidden = true;
    modal.innerHTML = `<div class="bag-backdrop"></div><div class="bag-sheet" role="dialog" aria-modal="true"><button class="bag-x" aria-label="Close">×</button><div class="bag-mbody"></div></div>`;
    document.body.appendChild(modal);
    const close = () => { modal.hidden = true; };
    modal.querySelector('.bag-x').onclick = close;
    modal.querySelector('.bag-backdrop').onclick = close;
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }
  const mbody = modal.querySelector('.bag-mbody');

  const FL_ABBR = { speed: 'Spd', glide: 'Gld', turn: 'Trn', fade: 'Fde' };
  const FL_FULL = { speed: 'Speed', glide: 'Glide', turn: 'Turn', fade: 'Fade' };
  const flPills = (d, big) => `<div class="bag-flnums">
    ${['speed', 'glide', 'turn', 'fade'].map(k => `<div class="bag-fl ${k}"><b>${d[k]}</b><span>${big ? FL_FULL[k] : FL_ABBR[k]}</span></div>`).join('')}</div>`;

  function paint(k) {
    const [mn, mx] = bounds[k], [a, b] = range[k], span = (mx - mn) || 1;
    const box = q('filters').querySelector(`[data-k="${k}"]`);
    box.querySelector('.bag-fill').style.left = ((a - mn) / span * 100) + '%';
    box.querySelector('.bag-fill').style.width = ((b - a) / span * 100) + '%';
    box.querySelector('.bag-val').textContent = a === b ? `${a}` : `${a} – ${b}`;
    box.querySelector('.lo').style.zIndex = (+box.querySelector('.lo').value >= mx) ? 5 : 3;
  }
  const filtered = () => discs.filter(d => (type === 'ALL' || d.type === type) && BAG_SLIDERS.every(([k]) => { const v = d[k]; return v == null || (v >= range[k][0] && v <= range[k][1]); }));
  function sortList(list) {
    const st = { understable: 0, neutral: 1, stable: 2, overstable: 3 };
    const c = {
      'speed-desc': (a, b) => b.speed - a.speed || a.name.localeCompare(b.name),
      'speed-asc': (a, b) => a.speed - b.speed || a.name.localeCompare(b.name),
      'stability': (a, b) => st[bagStability(a)] - st[bagStability(b)] || b.speed - a.speed,
      'name': (a, b) => a.name.localeCompare(b.name),
    };
    return [...list].sort(c[sort]);
  }

  function buildPills() {
    q('pills').innerHTML = BAG_TYPES.map(t => `<button class="bag-pill${t === 'ALL' ? ' active' : ''}" data-t="${t}">${BAG_TLABEL[t]}</button>`).join('')
      + `<span class="bag-spacer"></span><select class="bag-sort" data-el="sort">
          <option value="speed-desc">Speed ↓</option><option value="speed-asc">Speed ↑</option>
          <option value="stability">Stability</option><option value="name">Name</option></select>`;
    q('pills').querySelectorAll('.bag-pill').forEach(b => b.onclick = () => { type = b.dataset.t; q('pills').querySelectorAll('.bag-pill').forEach(p => p.classList.toggle('active', p === b)); applyGrid(); });
    q('sort').onchange = e => { sort = e.target.value; applyGrid(); };
  }
  function buildFilters() {
    q('filters').innerHTML = BAG_SLIDERS.map(([k, label]) => { const [mn, mx] = bounds[k];
      return `<div data-k="${k}"><div class="bag-rng-head"><span class="bag-lbl">${label}</span><span class="bag-val"></span></div>
        <div class="bag-rng"><div class="bag-track"></div><div class="bag-fill"></div>
          <input type="range" class="lo" min="${mn}" max="${mx}" step="1" value="${mn}">
          <input type="range" class="hi" min="${mn}" max="${mx}" step="1" value="${mx}"></div></div>`; }).join('');
    BAG_SLIDERS.forEach(([k]) => { const box = q('filters').querySelector(`[data-k="${k}"]`), lo = box.querySelector('.lo'), hi = box.querySelector('.hi');
      const upd = () => { range[k] = [Math.min(+lo.value, +hi.value), Math.max(+lo.value, +hi.value)]; paint(k); applyGrid(); };
      lo.oninput = upd; hi.oninput = upd; paint(k); });
    q('reset').onclick = () => { for (const [k] of BAG_SLIDERS) { range[k] = [...bounds[k]]; const box = q('filters').querySelector(`[data-k="${k}"]`); box.querySelector('.lo').value = bounds[k][0]; box.querySelector('.hi').value = bounds[k][1]; paint(k); } applyGrid(); };
  }

  function applyGrid() {
    const list = sortList(filtered());
    q('grid').innerHTML = list.length ? list.map(cardHtml).join('') : `<div class="bag-empty">No discs match these filters.</div>`;
    q('grid').querySelectorAll('.bag-disc').forEach(c => c.onclick = () => openDetail(c.dataset.id));
    revealBag();
  }
  function cardHtml(d) {
    const copies = d.copies > 1 ? ` ×${d.copies}` : '';
    return `<div class="bag-disc reveal" data-id="${esc(d.id)}" tabindex="0"><span class="bag-peek">View ↗</span>
      <div class="bag-disc-top"><span class="bag-thumb"><span class="bag-thumb-disc"><img class="bag-thumb-img" src="${IMG(d.id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"></span></span>
        <div><h4 class="bag-name">${esc(d.name)}${copies}</h4><div class="bag-meta">${[d.brand, d.plastic].filter(Boolean).map(esc).join(' · ')}</div><span class="bag-stab">${bagStability(d)}</span></div></div>
      ${flPills(d)}${d.role ? `<div class="bag-role">${esc(d.role)}</div>` : ''}</div>`;
  }

  function openDetail(id) {
    const d = byId(id); if (!d) return;
    const copies = d.copies > 1 ? ` ×${d.copies}` : '';
    const inC = compare.includes(id);
    const dist = Math.round(distanceM(flightOf(d)));
    mbody.innerHTML = `
      <div class="bag-md-top"><span class="bag-md-thumb"><span class="bag-md-disc"><img class="bag-md-img" src="${IMG(d.id)}" alt="" onerror="this.style.visibility='hidden'"></span></span>
        <div><h3 class="bag-md-name">${esc(d.name)}${copies}</h3><div class="bag-meta">${[d.brand, d.plastic, d.weight ? d.weight + 'g' : ''].filter(Boolean).map(esc).join(' · ')}</div><span class="bag-stab">${bagStability(d)}</span></div></div>
      ${flPills(d, true)}<div class="bag-md-chart" data-el="mdchart"></div>
      <div class="bag-md-dist">Estimated flight <b>~${dist} m</b> · RHBH, normal power</div>
      ${d.role ? `<div class="bag-md-role">${esc(d.role)}</div>` : ''}
      <button class="bag-btn${inC ? ' on' : ''}" data-el="mdcompare">${inC ? '✓ In comparison — remove' : '＋ Add to comparison'}</button>`;
    mbody.querySelector('[data-el="mdchart"]').innerHTML = renderFlightSvg(d, { width: 480, height: 400, strokeWidth: 4 });
    drawFlight(mbody.querySelector('[data-el="mdchart"]'), !reduced());
    mbody.querySelector('[data-el="mdcompare"]').onclick = () => {
      const i = compare.indexOf(id); if (i >= 0) compare.splice(i, 1); else compare.push(id);
      openDetail(id); renderOverlay(true);
    };
    modal.hidden = false;
  }

  function buildOvFilter() {
    q('ovfilter').innerHTML = BAG_TYPES.map(t => `<button class="bag-mini${t === ovType ? ' active' : ''}" data-t="${t}">${BAG_TLABEL[t]}</button>`).join('')
      + `<button class="bag-mini bag-clear" data-el="ovclear">Clear</button>`;
    q('ovfilter').querySelectorAll('.bag-mini[data-t]').forEach(b => b.onclick = () => { ovType = b.dataset.t; buildOvFilter(); renderOverlay(true); });
    q('ovclear').onclick = () => { compare = []; renderOverlay(true); };
  }
  function renderOverlay(animate) {
    const list = discs.filter(d => ovType === 'ALL' || d.type === ovType).sort((a, b) => b.speed - a.speed);
    q('chips').innerHTML = list.map(d => { const on = compare.includes(d.id), col = BAG_COLORS[compare.indexOf(d.id) % BAG_COLORS.length];
      return `<button class="bag-chip${on ? ' on' : ''}" data-id="${esc(d.id)}"><span class="bag-dot" style="background:${on ? col : 'var(--faint)'}"></span>${esc(d.name)}</button>`; }).join('');
    q('chips').querySelectorAll('.bag-chip').forEach(c => c.onclick = () => { const i = compare.indexOf(c.dataset.id); if (i >= 0) compare.splice(i, 1); else compare.push(c.dataset.id); renderOverlay(true); });
    const chosen = compare.map(byId).filter(Boolean).map((d, i) => ({ ...d, color: BAG_COLORS[i % BAG_COLORS.length] }));
    q('bigchart').innerHTML = chosen.length ? renderFlightSvg(chosen, { width: 440, height: 460, strokeWidth: 4 })
      : `<div class="bag-chart-empty">Tap discs to compare their flight paths</div>`;
    drawFlight(q('bigchart'), animate !== false && q('overcard').classList.contains('in'));
  }

  function drawFlight(hostEl, animate) {
    hostEl.querySelectorAll('path.fp-p').forEach((p, i) => { const len = p.getTotalLength();
      p.style.transition = 'none'; p.style.strokeDasharray = len; p.style.strokeDashoffset = (animate && !reduced()) ? len : 0;
      if (animate && !reduced()) { p.getBoundingClientRect(); p.style.transition = `stroke-dashoffset .6s var(--ease) ${i * 70}ms`; p.style.strokeDashoffset = '0'; } });
  }

  let bagObs;
  function revealBag() {
    bagObs ??= new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); if (e.target.matches('[data-el="overcard"]')) renderOverlay(true); bagObs.unobserve(e.target); } }), { rootMargin: '0px 0px -6% 0px' });
    host.querySelectorAll('.reveal:not(.in)').forEach(n => {
      if (n.getBoundingClientRect().top < window.innerHeight) { n.style.transition = 'none'; n.classList.add('in'); requestAnimationFrame(() => n.style.transition = ''); if (n.matches('[data-el="overcard"]')) renderOverlay(false); }
      else bagObs.observe(n);
    });
  }

  buildPills(); buildFilters(); buildOvFilter(); applyGrid(); renderOverlay(false); revealBag();
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
