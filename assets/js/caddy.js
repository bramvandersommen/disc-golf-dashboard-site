// Caddy — shot-shape advisor. A rules engine over the live bag: shot shapes declare
// what they need (stability per wind, speed range, tags); the Discs tab supplies the
// disc data (effective_stability + tags + role + notes). NO disc is hardcoded.
import { loadDiscs } from './data.js?v=202609221257';
import { renderFlightSvg, distanceM, flightOf } from './flight.js?v=202609221257';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const reduce = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── stability (spec §1) ──
const CLASSES = ['understable', 'neutral', 'stable', 'overstable'];
const derived = d => { const s = (d.turn ?? 0) + (d.fade ?? 0); return s < -1 ? 'understable' : s <= 1 ? 'neutral' : s <= 3 ? 'stable' : 'overstable'; };
const shift = (cls, delta) => CLASSES[Math.max(0, Math.min(3, CLASSES.indexOf(cls) + delta))];
// Behavioral override from the tab wins over the printed numbers.
const effStab = d => (d.effective_stability && CLASSES.includes(d.effective_stability)) ? d.effective_stability : derived(d);
const tagsOf = d => d.tags || [];
const isPutter = d => /putt/i.test(d.role) || tagsOf(d).includes('putt') || (d.type === 'PUTTER' && d.speed <= 3);

// ── wind (spec §2). `shift` is the SELECTION shift — it COMPENSATES for how the
// wind makes discs behave: a headwind makes discs play understable, so you pick
// one class MORE overstable (+1). ──
// Arrow = the direction the wind TRAVELS relative to the thrower (bottom) → target
// (top): headwind comes at you (↓), tailwind blows out (↑), crosswinds ← / →.
const WIND = [
  { id: 'calm', label: 'Calm', shift: 0, arrow: '', height: 'normal', heightWhy: '',
    aim: 'at the target', aimWhy: '', note: 'Baseline stability.' },
  { id: 'head', label: 'Headwind', shift: 1, arrow: 'M8 3v9M4.5 8.5l3.5 3.5 3.5-3.5', height: 'lower',
    heightWhy: 'the headwind lifts the disc and it balloons', aim: 'left of the target',
    aimWhy: 'more airspeed makes discs play understable and stands hyzer banks up, so it flies right',
    note: 'Discs play understable — pick <b>one step more overstable</b>.' },
  { id: 'tail', label: 'Tailwind', shift: -1, arrow: 'M8 13V4M4.5 7.5l3.5-3.5 3.5 3.5', height: 'higher',
    heightWhy: 'the tailwind kills lift so the disc drops', aim: 'right of the target',
    aimWhy: 'less airspeed makes discs overstable — a harder, earlier fade left', note: 'Discs fade harder &amp; earlier — pick <b>one step more understable</b>.' },
  { id: 'ltr', label: 'Left→Right', shift: 1, arrow: 'M3 8h9M8.5 4.5l3.5 3.5-3.5 3.5', height: 'lower',
    heightWhy: 'a crosswind gives you less to work with up high', aim: 'left of the target',
    aimWhy: 'the wind pushes the disc right and lifts the left edge (plays understable)',
    note: 'Lifts the left edge (plays understable) — pick <b>more overstable</b>.' },
  { id: 'rtl', label: 'Right→Left', shift: -1, arrow: 'M13 8H4M8.5 4.5l-3.5 3.5 3.5 3.5', height: 'lower',
    heightWhy: 'a crosswind gives you less to work with up high', aim: 'right of the target',
    aimWhy: 'the wind pushes the disc left and steepens the bank (plays overstable) — on a hyzer, aim well right and let it carry back',
    note: 'Lifts the right edge (plays overstable) — pick <b>more understable</b>.' },
];
const windById = id => WIND.find(w => w.id === id);

// bank-sensitive wind copy (spec §2 hyzer-bank table + correction rule)
const BANK = {
  calm: 'Neutral air — throw the bank as intended.',
  head: 'Headwind stands the hyzer up (flattens it) — flies straighter and further right than aimed, shorter. Fix: aim further left and/or a more stable disc — not more hyzer.',
  tail: 'Downwind the bank never stands up — a wide hyzer dives left early into a spike. Fix is the angle: release flatter and higher, or accept the early left finish.',
  ltr: 'Left→right flattens the bank like a headwind — straighter, drifts right. Aim further left.',
  rtl: 'Right→left steepens the bank — dives left earlier, lands short-left.',
};

// ── shape catalog (spec §3). Each shape is a query, not a disc. ──
const S = (id, label, cat, desc, baseTarget, speed, o = {}) => ({ id, label, cat, desc, baseTarget, speed, glide: o.glide || null, reqTags: o.reqTags || [], excTags: o.excTags || [], bank: !!o.bank, height: o.height || null, putt: !!o.putt, shift: o.shift || 0, tol: o.tol || 0 });
const SHAPES = [
  S('max-distance', 'Max distance', 'Drive', 'Everything you have — your flippable bombers on a mini hyzer flip.', 'understable', null, { reqTags: ['distance'] }),
  S('wide-hyzer', 'Wide hyzer drive', 'Drive', 'Sweeping hyzer that holds its angle then finishes — a stable disc, or a softer touch on a neutral one.', 'stable', [7, 11], { bank: true, tol: 1 }),
  S('straight-control', 'Straight control drive', 'Drive', 'Dead-straight line off the tee — your straight-flying discs.', 'neutral', null, { reqTags: ['straight'] }),
  S('hyzer-flip', 'Hyzer-flip / S-curve', 'Drive', 'Flip up to flat, ride, then fade out.', 'understable', [9, 12], { bank: true }),
  S('turnover', 'Turnover — finishes right', 'Drive', 'Right-finishing line: flat-and-hard or anhyzer (RHBH).', 'understable', null, { reqTags: ['turnover'] }),
  S('roller', 'Roller', 'Drive', 'Lay it on edge and let it run.', 'understable', null, { reqTags: ['roller'] }),
  S('flex-line', 'Flex line', 'Drive', 'Big anhyzer that flexes hard back left — a storm-wind shot.', 'overstable', [11, 13], { bank: true, reqTags: ['flex'] }),
  S('spike-hyzer', 'Spike hyzer', 'Drive', 'Steep up-and-down over an obstacle.', 'overstable', [7, 11], { bank: true, height: 'high' }),
  S('tunnel', 'Low ceiling / tunnel', 'Drive', 'Flat, low, no climb — under branches.', 'stable', null, { glide: 'low', reqTags: ['tunnel'], height: 'low' }),
  S('approach-50-80', '50–80m straight', 'Approach', 'Controlled straight approach.', 'neutral', [4, 9]),
  S('touch-10-30', '10–30m touch', 'Approach', 'Soft landing, minimal skip.', 'stable', null, { glide: 'low', reqTags: ['touch'] }),
  S('finish-left', 'Must finish hard left', 'Approach', 'Has to dump left around a guard.', 'overstable', [4, 9], { bank: true }),
  S('finish-right-tree', 'Right around a tree', 'Approach', 'Must bend right past an obstacle.', 'understable', [4, 9], { bank: true }),
  S('forehand', 'Forehand utility', 'Utility', 'Flick line, must resist turnover.', 'overstable', [4, 13], { reqTags: ['forehand'], height: 'low' }),
  S('uphill', 'Uphill', 'Utility', 'Climbing shot plays more overstable — pick a class flippier.', 'neutral', [5, 11], { shift: -1 }),
  S('downhill', 'Downhill', 'Utility', 'Dropping shot plays more understable — pick a class more stable.', 'neutral', [7, 11], { shift: 1 }),
  S('glow-round', 'Glow round', 'Utility', 'Night round — needs a glow disc.', 'neutral', null, { reqTags: ['glow'], height: 'low' }),
  S('putt-8', 'Inside 8m', 'Putt', 'Inside the circle — commit.', 'neutral', null, { putt: true }),
  S('putt-8-15', '8–15m', 'Putt', 'Long putt / short jump.', 'neutral', null, { putt: true }),
];
const CATS = ['Drive', 'Approach', 'Utility', 'Putt'];
const COLORS = ['#C8FF4D', '#6883D6', '#7A9F2C', '#E0B341', '#D97757'];

// provisional engagement band (spec §1 / B3 — derived-from-form later; placeholder)
const ENGAGE = [7, 11];

let discs = [], wind = 'calm';

boot();
async function boot() {
  $('#load-state').hidden = false; $('#error-state').hidden = true;
  try {
    discs = await loadDiscs();
    $('#load-state').hidden = true; $('#caddy').hidden = false;
    buildWind(); renderTips(); renderCatalog();
  } catch (err) {
    console.error(err);
    $('#load-state').hidden = true; $('#caddy').hidden = true; $('#error-state').hidden = false;
    $('#error-detail').textContent = `${err.message}. The Sheet publishes as CSV with a few minutes of cache lag.`;
  }
}
$('#retry-btn')?.addEventListener('click', boot);

function buildWind() {
  const host = $('#wind');
  host.innerHTML = `<span class="sa-wind-lbl">Wind</span><div class="sa-wind-pills">` +
    WIND.map(w => `<button class="sa-wpill${w.id === wind ? ' active' : ''}" data-w="${w.id}">${w.arrow ? `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${w.arrow}"/></svg>` : ''}${w.label}</button>`).join('') +
    `</div><div class="sa-wind-note" id="wind-note"></div>`;
  host.querySelectorAll('.sa-wpill').forEach(b => b.onclick = () => { wind = b.dataset.w; host.querySelectorAll('.sa-wpill').forEach(p => p.classList.toggle('active', p === b)); updateWindNote(); renderCatalog(); });
  updateWindNote();
}
function updateWindNote() { const w = windById(wind); $('#wind-note').innerHTML = `${w.note} Throw <b>${w.height}</b>, aim <b>${w.aim}</b>.`; }

// ── selection (spec §4) ──
function targetClass(shape) { return shape.putt ? null : shift(shape.baseTarget, shape.shift + windById(wind).shift); }
function eligible(shape) {
  let pool = discs.slice();
  if (shape.putt) return pool.filter(isPutter);
  if (shape.reqTags.length) pool = pool.filter(d => shape.reqTags.every(t => tagsOf(d).includes(t)));
  if (shape.excTags.length) pool = pool.filter(d => !shape.excTags.some(t => tagsOf(d).includes(t)));
  if (shape.speed) pool = pool.filter(d => d.speed != null && d.speed >= shape.speed[0] && d.speed <= shape.speed[1]);
  return pool;
}
const distTo = (d, tgt) => Math.abs(CLASSES.indexOf(effStab(d)) - CLASSES.indexOf(tgt));
const roleMatch = (d, shape) => { const r = (d.role || '').toLowerCase(), c = shape.cat.toLowerCase(); return (c === 'putt' && /putt/.test(r)) || (c === 'approach' && /(approach|upshot|fairway)/.test(r)) || (c === 'drive' && /(distance|driver|workhorse|fairway)/.test(r)) || (c === 'utility' && /(utility|wind|overstable)/.test(r)) ? 1 : 0; };
const inEngage = d => d.speed != null && d.speed >= ENGAGE[0] && d.speed <= ENGAGE[1] ? 1 : 0;
const glideScore = (d, shape) => shape.glide === 'low' ? d.glide : (7 - d.glide);
function rankPutts(shape, pool) {
  const score = d => { const t = tagsOf(d); let s = 0; if (t.includes('putt-main')) s += 5; if (t.includes('putt')) s += 2; if (shape.id === 'putt-8-15' && t.includes('putt-long')) s += 8; if (/putt/i.test(d.role)) s += 1; return s; };
  return pool.slice().sort((a, b) => score(b) - score(a) || a.speed - b.speed).slice(0, 2);
}
function pickFor(shape) {
  if (shape.putt) return { picks: rankPutts(shape, eligible(shape)), tgt: null, gap: null };
  const tgt = targetClass(shape), pool = eligible(shape);
  const rank = (a, b) => {
    const da = distTo(a, tgt), db = distTo(b, tgt); if (da !== db) return da - db;
    // within a tolerant shape, prefer the flippier side (a wide hyzer holds; it never wants an overstable disc)
    if (shape.tol) { const ia = CLASSES.indexOf(effStab(a)), ib = CLASSES.indexOf(effStab(b)); if (ia !== ib) return ia - ib; }
    const ra = roleMatch(a, shape), rb = roleMatch(b, shape); if (ra !== rb) return rb - ra;
    const ea = inEngage(a), eb = inEngage(b); if (ea !== eb) return eb - ea;
    if (shape.glide) return glideScore(a, shape) - glideScore(b, shape);
    return b.speed - a.speed;
  };
  if (!pool.length) return { picks: [], tgt, gap: null };
  if (shape.reqTags.length) return { picks: pool.sort(rank).slice(0, 2), tgt, gap: null };
  const within = pool.filter(d => distTo(d, tgt) <= (shape.tol || 0));
  if (within.length) return { picks: within.sort(rank).slice(0, 2), tgt, gap: null };
  const nearest = pool.slice().sort((a, b) => distTo(a, tgt) - distTo(b, tgt) || rank(a, b))[0];
  return { picks: [], tgt, gap: { disc: nearest, cls: effStab(nearest), dist: distTo(nearest, tgt) } };
}

// ── render ──
function renderCatalog() {
  const host = $('#catalog');
  host.innerHTML = CATS.map(cat => `<div class="sa-cat">${cat}</div><div class="sa-grid">${SHAPES.filter(s => s.cat === cat).map(cardHtml).join('')}</div>`).join('');
  host.querySelectorAll('.sa-shape').forEach(c => c.onclick = () => openShape(c.dataset.id));
  requestAnimationFrame(() => host.querySelectorAll('.reveal').forEach((n, i) => setTimeout(() => n.classList.add('in'), i * 16)));
}
function cardHtml(shape) {
  const { picks, tgt, gap } = pickFor(shape);
  const flags = [shape.bank ? 'bank-sensitive' : '', shape.height ? `height ${shape.height}` : ''].filter(Boolean);
  const tgtBadge = shape.putt ? '<span class="sa-tgt">putting disc</span>' : `<span class="sa-tgt">${tgt}</span>`;
  let body;
  if (picks.length) body = picks.map(pickHtml).join('');
  else if (gap) body = `<div class="sa-gap">⚠ No ${tgt} disc in range — nearest is <b>${esc(gap.disc.name)}</b>, ${gap.dist} class off. Bag gap for this shot in this wind.</div>`;
  else body = `<div class="sa-gap">⚠ Nothing in the bag fits this shape yet${shape.reqTags.length ? ` — needs a disc tagged <b>${shape.reqTags.join(' / ')}</b>` : ''}.</div>`;
  return `<div class="sa-shape reveal" data-id="${shape.id}">
    <div class="sa-shape-top"><h3>${esc(shape.label)}</h3>${tgtBadge}</div>
    <div class="sa-desc">${esc(shape.desc)}</div>
    ${flags.length ? `<div class="sa-flags">${flags.map(f => `<span class="sa-flag">${f}</span>`).join('')}</div>` : ''}
    ${body}</div>`;
}
function pickHtml(d) {
  return `<div class="sa-pick"><img src="discs/${d.id}.webp" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
    <div><div class="sa-pn">${esc(d.name)}</div><div class="sa-pf">${esc(effStab(d))}${d.effective_stability ? ' ✦' : ''}${d.role ? ' · ' + esc(d.role) : ''}</div></div>
    <div class="sa-pnums">${d.speed}/${d.glide}/${d.turn}/${d.fade}</div></div>`;
}

function windAdjust(d) {
  const m = { calm: [0, 0], head: [-1, -1], tail: [1, 1], ltr: [-1, 0], rtl: [0, 1] }[wind];
  return { ...d, turn: d.turn + m[0], fade: Math.max(0, d.fade + m[1]) };
}
function openShape(id) {
  const shape = SHAPES.find(s => s.id === id); if (!shape) return;
  const { picks, tgt, gap } = pickFor(shape), w = windById(wind), top = picks[0];
  let chart = '', legend = '';
  if (top) {
    if (wind === 'calm') chart = renderFlightSvg({ ...top, color: 'var(--lime)' }, { width: 520, height: 380, strokeWidth: 4 });
    else {
      chart = renderFlightSvg([{ ...top, name: 'Calm', color: '#5C6960' }, { ...windAdjust(top), name: w.label, color: '#C8FF4D' }], { width: 520, height: 380, strokeWidth: 4 });
      legend = `<div class="sa-legend"><span><i style="background:#5C6960"></i>Calm</span><span><i style="background:#C8FF4D"></i>${esc(w.label)} (illustrative)</span></div>`;
    }
  }
  const heightLine = shape.height ? `stays ${esc(shape.height)} in any wind (shape override)` : `${esc(w.height)}${w.heightWhy ? ` — ${esc(w.heightWhy)}` : ''}`;
  const aimLine = shape.putt ? 'at the basket — wind is an aim tweak, not a disc change' : `${esc(w.aim)}${w.aimWhy ? ` — ${esc(w.aimWhy)}` : ''}`;
  const cueCls = top ? effStab(top) : 'neutral';
  const angleCue = shape.putt ? 'Aim &amp; commit — wind is an aim change, not a disc change.'
    : cueCls === 'understable' ? 'Understable pick — cue the TOP of your release-angle range.'
      : cueCls === 'overstable' ? 'Overstable pick — cue the BOTTOM of your release-angle range.'
        : 'Neutral pick — a flat, repeatable release.';
  $('#mbody').innerHTML = `
    <div class="sa-eyebrow">${esc(shape.cat)} · ${esc(w.label)}</div>
    <div class="sa-title">${esc(shape.label)}</div>
    <div class="sa-mdesc">${esc(shape.desc)}</div>
    ${top ? `<div class="sa-chart">${chart}</div>${legend}
      ${picks.map(d => `<div class="sa-rec"><img src="discs/${d.id}.webp" alt="" onerror="this.style.visibility='hidden'">
        <div><h4>${esc(d.name)} <span style="color:var(--muted);font-size:12px;font-weight:400">${d.speed}/${d.glide}/${d.turn}/${d.fade}</span></h4>
        <div class="sa-pf" style="font-size:11.5px;color:var(--muted)">${esc(effStab(d))}${d.effective_stability ? ' ✦' : ''}${d.role ? ' · ' + esc(d.role) : ''}</div>
        <div class="sa-why">${why(d, shape, tgt)}</div></div></div>`).join('')}`
      : `<div class="sa-banknote">⚠ ${gap ? `No <b>${tgt}</b> disc in the ${shape.speed ? `${shape.speed[0]}–${shape.speed[1]} speed` : 'right'} range for ${w.label.toLowerCase()}. Nearest is <b>${esc(gap.disc.name)}</b> (${esc(gap.cls)}, ${gap.dist} class off). A real bag gap — it fills itself when you add a matching disc.` : `Nothing fits this shape yet${shape.reqTags.length ? ` — needs a disc tagged <b>${shape.reqTags.join(' / ')}</b>` : ''}.`}</div>`}
    <dl class="sa-cue">
      <dt>Target</dt><dd>${shape.putt ? 'putting disc (role-based, not stability-filtered)' : `<b>${tgt}</b> stability in ${esc(w.label.toLowerCase())}`}</dd>
      <dt>Height</dt><dd>${heightLine}</dd>
      <dt>Aim</dt><dd>${aimLine}</dd>
      <dt>Angle</dt><dd>${angleCue}</dd>
    </dl>
    ${shape.bank ? `<div class="sa-banknote"><b>Bank vs wind:</b> ${esc(BANK[wind])}</div>` : ''}`;
  $('#modal').hidden = false;
  drawFlight($('#mbody'), !reduce());
}
function why(d, shape, tgt) {
  const cls = effStab(d), overridden = d.effective_stability && d.effective_stability !== derived(d);
  const bits = [`Plays <b>${cls}</b>${overridden ? ` — your call, not the ${derived(d)} its ${d.turn}/${d.fade} would suggest` : ''}.`];
  if (d.notes) bits.push(` ${esc(d.notes)}`);
  else if (d.role) bits.push(` Your ${esc(d.role.toLowerCase())}.`);
  bits.push(` Fits the <b>${tgt}</b> target for a ${shape.label.toLowerCase()} in ${windById(wind).label.toLowerCase()}.`);
  if (!inEngage(d) && d.speed > ENGAGE[1]) bits.push(` Above your reliable-engagement speed — full commit or drop down.`);
  return bits.join('');
}
function drawFlight(host, animate) {
  host.querySelectorAll('path.fp-p').forEach((p, i) => { const len = p.getTotalLength();
    p.style.transition = 'none'; p.style.strokeDasharray = len; p.style.strokeDashoffset = (animate && !reduce()) ? len : 0;
    if (animate && !reduce()) { p.getBoundingClientRect(); p.style.transition = `stroke-dashoffset .6s var(--ease) ${i * 70}ms`; p.style.strokeDashoffset = '0'; } });
}
function renderTips() {
  $('#tips').innerHTML = `<b>Standing cues.</b> Grip lock tracks the mold + plastic, not randomness — if a disc grip-locks, check rim shape and plastic hardness before changing technique. Angle discipline: cue the top of your release-angle range on understable discs, the bottom on overstable ones. Putting distance breakdowns can lag the overall rate — trust the trend until a fresh routine-based session exists.`;
}

$('#mx').onclick = () => $('#modal').hidden = true;
$('#backdrop').onclick = () => $('#modal').hidden = true;
addEventListener('keydown', e => { if (e.key === 'Escape') $('#modal').hidden = true; });
