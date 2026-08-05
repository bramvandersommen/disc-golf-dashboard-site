// Orchestration: load → state → render.
// Two modes. A: evaluation period (coached, default). B: custom date range
// (uncoached — monthly-bucketed sections are dropped, not faked).

import { loadAll, periodName } from './data.js?v=202608041419';
import * as R from './render.js?v=202608041419';

const $ = sel => document.querySelector(sel);

const state = {
  periods: [], evalByPeriod: new Map(), bench: [], metaRows: [],
  selected: null, prev: null,
  layout: 'all',
  mode: 'period',        // 'period' | 'range'
  rangeStart: null, rangeEnd: null,
};

const PERIOD_SECTIONS = ['#overview', '#coaching', '#rating', '#putting', '#scoring', '#activity', '#benchmarks'];
const RANGE_SECTIONS = ['#range'];

function selectPeriod(label) {
  const i = state.periods.findIndex(p => p.period_label === label);
  state.selected = state.periods[i];
  // Compare like with like: a month against the previous month, a check-in
  // against the previous check-in. Comparing August to a check-in that sits
  // inside it would report a zero delta from overlapping data.
  state.prev = state.periods
    .slice(i + 1)
    .find(p => p.period_type === state.selected.period_type) || null;
}

function renderAll() {
  if (state.mode === 'range') { R.renderRange(state); R.renderFooter(state); observeReveals(); return; }
  R.renderProfile(state);
  R.renderPeriodContext(state);
  R.renderKpis(state);
  R.renderCoachStrip(state);
  R.renderEval(state);
  R.renderRating(state);
  R.renderPutting(state);
  R.renderScoring(state);
  R.renderActivity(state);
  R.renderBenchmarks(state);
  R.renderFooter(state);
  observeReveals();
}

function renderLayoutDependent() {
  R.renderRating(state);
  R.renderScoring(state);
  R.renderBenchmarks(state);
  observeReveals();
}

function applyMode() {
  const range = state.mode === 'range';
  for (const sel of PERIOD_SECTIONS) { const n = document.querySelector(sel); if (n) n.hidden = range; }
  for (const sel of RANGE_SECTIONS) { const n = document.querySelector(sel); if (n) n.hidden = !range; }
  $('#mode-period').classList.toggle('active', !range);
  $('#mode-range').classList.toggle('active', range);
  $('#ctl-period').hidden = range;
  $('#ctl-layout').hidden = range;  // layout filter only drives period-mode sections
  $('#ctl-from').hidden = !range;
  $('#ctl-to').hidden = !range;
  document.querySelectorAll('.navpill').forEach(p => { p.hidden = range; });
}

// ── reveal-on-scroll ──────────────────────────────────────────────────
let revealObserver;
function observeReveals() {
  revealObserver ??= new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); revealObserver.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.reveal:not(.in)').forEach(n => {
    if (n.getBoundingClientRect().top < window.innerHeight) {
      n.style.transition = 'none';
      n.classList.add('in');
      requestAnimationFrame(() => n.style.transition = '');
    } else revealObserver.observe(n);
  });
}

function initNavHighlight() {
  const pills = [...document.querySelectorAll('.navpill')];
  const byId = Object.fromEntries(pills.map(p => [p.getAttribute('href').slice(1), p]));
  const obs = new IntersectionObserver(entries => {
    const visible = entries.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    pills.forEach(p => p.classList.remove('active'));
    byId[visible.target.id]?.classList.add('active');
  }, { rootMargin: '-30% 0px -55% 0px' });
  document.querySelectorAll('section[id]').forEach(s => obs.observe(s));
}

// ── controls ──────────────────────────────────────────────────────────
function initControls() {
  // Grouped by type: months are the spine, check-ins are coached periods too
  // and interleave by period_end (already the sort key).
  const pp = $('#period-picker');
  const esc = s => String(s).replace(/"/g, '&quot;');
  // No "latest" suffix — it truncates in a narrow native select, and the
  // period-context banner already states the window and its type.
  const group = (label, list) => list.length
    ? `<optgroup label="${label}">${list.map(p =>
        `<option value="${esc(p.period_label)}">${esc(periodName(p))}</option>`).join('')}</optgroup>`
    : '';
  pp.innerHTML =
    group('Check-ins', state.periods.filter(p => p.period_type === 'checkin')) +
    group('Months', state.periods.filter(p => p.period_type === 'month')) +
    group('Custom', state.periods.filter(p => p.period_type === 'custom'));
  pp.addEventListener('change', () => { selectPeriod(pp.value); crossFade(renderAll); });

  const layouts = new Set();
  for (const p of state.periods) Object.keys(p.par_or_better_pct_by_layout).forEach(l => layouts.add(l));
  const lp = $('#layout-picker');
  lp.innerHTML = `<option value="all">All layouts</option>` +
    [...layouts].map(l => `<option value="${l}">${l}</option>`).join('');
  lp.addEventListener('change', () => {
    state.layout = lp.value;
    crossFade(renderLayoutDependent, '#rating, #scoring, #benchmarks');
  });

  // Range defaults to the full span of recorded round history.
  const hist = state.selected.rating_history;
  const first = hist[0]?.date ?? state.selected.computed_at?.slice(0, 10);
  const last = hist.at(-1)?.date ?? state.selected.computed_at?.slice(0, 10);
  const from = $('#range-from'), to = $('#range-to');
  from.min = to.min = first; from.max = to.max = last;
  from.value = state.rangeStart = first;
  to.value = state.rangeEnd = last;

  const clampAndRender = changed => {
    // keep the range coherent rather than letting it invert into an empty set
    if (from.value > to.value) {
      if (changed === 'from') to.value = from.value; else from.value = to.value;
    }
    state.rangeStart = from.value;
    state.rangeEnd = to.value;
    crossFade(() => R.renderRange(state), '#range');
  };
  from.addEventListener('change', () => clampAndRender('from'));
  to.addEventListener('change', () => clampAndRender('to'));

  $('#mode-period').addEventListener('click', () => setMode('period'));
  $('#mode-range').addEventListener('click', () => setMode('range'));
}

function setMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  applyMode();
  window.scrollTo({ top: 0, behavior: 'instant' });
  crossFade(renderAll);
}

function crossFade(rerender, scope) {
  const targets = scope ? document.querySelectorAll(scope) : [document.getElementById('dash')];
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { rerender(); return; }
  targets.forEach(t => t.classList.add('fade-swap', 'out'));
  setTimeout(() => {
    rerender();
    targets.forEach(t => t.classList.remove('out'));
    setTimeout(() => targets.forEach(t => t.classList.remove('fade-swap')), 260);
  }, 200);
}

let resizeT;
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { if (state.selected) renderAll(); }, 220);
});

// ── boot ──────────────────────────────────────────────────────────────
async function boot() {
  $('#load-state').hidden = false;
  $('#error-state').hidden = true;
  try {
    const data = await loadAll();
    Object.assign(state, data);
    if (!state.periods.length) throw new Error('stats tab returned no period rows');

    const params = new URLSearchParams(location.search);
    selectPeriod(state.periods.find(p => p.period_label === params.get('period'))?.period_label
      ?? state.periods[0].period_label);

    initControls();
    $('#period-picker').value = state.selected.period_label;

    const urlLayout = params.get('layout');
    if (urlLayout && [...$('#layout-picker').options].some(o => o.value === urlLayout)) {
      state.layout = urlLayout;
      $('#layout-picker').value = urlLayout;
    }
    if (params.get('mode') === 'range') state.mode = 'range';
    applyMode();

    $('#load-state').hidden = true;
    $('#dash').hidden = false;
    renderAll();
    initNavHighlight();
  } catch (err) {
    console.error(err);
    $('#load-state').hidden = true;
    $('#dash').hidden = true;
    $('#error-state').hidden = false;
    $('#error-detail').textContent =
      `${err.message}. The Sheet publishes as CSV with a few minutes of cache lag — if this persists, check the published-to-web setting or the network tab.`;
  }
}

$('#retry-btn').addEventListener('click', boot);
boot();
