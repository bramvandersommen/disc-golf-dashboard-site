// Orchestration: load → state → render; period/layout changes re-render.

import { loadAll, monthName } from './data.js?v=202608022253';
import * as R from './render.js?v=202608022253';

const $ = sel => document.querySelector(sel);

const state = {
  periods: [],
  evalByPeriod: new Map(),
  bench: [],
  metaRows: [],
  selected: null,
  prev: null,
  layout: 'all',
  ratingUnit: 'udisc',
  scoringMode: 'pro',
};

function selectPeriod(label) {
  const i = state.periods.findIndex(p => p.period_label === label);
  state.selected = state.periods[i];
  state.prev = state.periods[i + 1] || null; // periods sorted newest-first
}

function renderAll() {
  R.renderKpis(state);
  R.renderCoachStrip(state);
  R.renderEval(state);
  R.renderRating(state);
  R.renderScoring(state);
  // Driving + Bag sections hidden for now (no TechDisc data / not relevant)
  R.renderPutting(state);
  R.renderActivity(state);
  R.renderBenchmarks(state);
  R.renderFooter(state);
  observeReveals();
}

// Sections that depend on the layout filter only
function renderLayoutDependent() {
  R.renderRating(state);
  R.renderScoring(state);
  R.renderBenchmarks(state);
  observeReveals();
}

// ── reveal-on-scroll ──────────────────────────────────────────────────
let revealObserver;
function observeReveals() {
  revealObserver ??= new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); revealObserver.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.reveal:not(.in)').forEach(n => {
    const r = n.getBoundingClientRect();
    if (r.top < window.innerHeight) {
      // already visible: appear instantly, no fade-up jump
      n.style.transition = 'none';
      n.classList.add('in');
      requestAnimationFrame(() => n.style.transition = '');
    } else revealObserver.observe(n);
  });
}

// ── nav pill highlighting ─────────────────────────────────────────────
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

// ── pickers ───────────────────────────────────────────────────────────
function initPickers() {
  const pp = $('#period-picker');
  pp.innerHTML = state.periods.map((p, i) =>
    `<option value="${p.period_label}">${monthName(p.period_label)}${i === 0 ? ' · current' : ''}</option>`).join('');
  pp.addEventListener('change', () => {
    selectPeriod(pp.value);
    crossFade(() => renderAll());
  });

  const layouts = new Set();
  for (const p of state.periods) Object.keys(p.par_or_better_pct_by_layout).forEach(l => layouts.add(l));
  const lp = $('#layout-picker');
  lp.innerHTML = `<option value="all">All layouts</option>` +
    [...layouts].map(l => `<option value="${l}">${l}</option>`).join('');
  lp.addEventListener('change', () => {
    state.layout = lp.value === 'all' ? 'all' : lp.value;
    crossFade(() => renderLayoutDependent(), '#rating, #scoring, #benchmarks');
  });
}

function crossFade(rerender, scope) {
  const targets = scope ? document.querySelectorAll(scope) : [document.getElementById('dash')];
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) { rerender(); return; }
  targets.forEach(t => { t.classList.add('fade-swap'); t.classList.add('out'); });
  setTimeout(() => {
    rerender();
    targets.forEach(t => t.classList.remove('out'));
    setTimeout(() => targets.forEach(t => t.classList.remove('fade-swap')), 260);
  }, 200);
}

// ── resize: re-render charts at new width ─────────────────────────────
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
    const startPeriod = state.periods.find(p => p.period_label === params.get('period'))?.period_label
      ?? state.periods[0].period_label;
    selectPeriod(startPeriod);
    initPickers();
    $('#period-picker').value = startPeriod;
    const urlLayout = params.get('layout');
    if (urlLayout && [...$('#layout-picker').options].some(o => o.value === urlLayout)) {
      state.layout = urlLayout;
      $('#layout-picker').value = urlLayout;
    }
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
