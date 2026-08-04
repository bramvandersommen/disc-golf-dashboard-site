// Custom SVG charts — dark/lime system, draw-in motion, shared tooltip.
// No chart library: every mark, gridline and tooltip is deliberate.

const NS = 'http://www.w3.org/2000/svg';
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const COLORS = {
  lime: '#C8FF4D',
  limeDim: '#8FB339',
  limeDeep: '#7A9F2C', // categorical slot 1 (validated)
  blue: '#6883D6',     // categorical slot 2 (validated)
  bad: '#FF8A7A',
  muted: '#8C9B90',
  faint: '#5C6960',
};
export { COLORS };

function el(tag, attrs = {}, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

// ── shared tooltip ────────────────────────────────────────────────────
const tip = () => document.getElementById('tooltip');
export function showTip(html, clientX, clientY) {
  const t = tip();
  t.innerHTML = html;
  t.hidden = false;
  const pad = 14;
  const r = t.getBoundingClientRect();
  let x = clientX + pad, y = clientY - r.height - 10;
  if (x + r.width > window.innerWidth - 8) x = clientX - r.width - pad;
  if (y < 8) y = clientY + pad;
  t.style.left = `${x}px`;
  t.style.top = `${y}px`;
}
export function hideTip() { tip().hidden = true; }

export function ttHtml(title, rows) {
  return `<div class="tt-title">${title}</div>` +
    rows.map(([k, v]) => `<div class="tt-row"><span>${k}</span><b>${v}</b></div>`).join('');
}

function niceTicks(min, max, count = 4) {
  const span = max - min || 1;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= count) || mag * 10;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(+v.toFixed(6));
  return ticks;
}

let uid = 0;

// ── line / area chart ─────────────────────────────────────────────────
// points: [{x: label, y: number|null, meta?}], opts: {unit, anchor:{value,label}, yFmt}
export function lineChart(container, points, opts = {}) {
  container.innerHTML = '';
  const W = Math.max(300, container.clientWidth || 560);
  const H = opts.height || 230;
  const m = { t: 16, r: 14, b: 30, l: 40 };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img' }, container);
  const id = `lc${++uid}`;

  const valid = points.filter(p => p.y !== null && p.y !== undefined);
  if (valid.length < 2) return emptyNote(container, svg, W, H, 'Not enough data for a trend yet');

  const ys = valid.map(p => p.y);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (opts.anchor) { lo = Math.min(lo, opts.anchor.value); hi = Math.max(hi, opts.anchor.value); }
  const pad = (hi - lo) * 0.14 || 10;
  const ticks = niceTicks(Math.max(0, lo - pad), hi + pad);
  const yMin = ticks[0], yMax = ticks.at(-1);

  const x = i => m.l + (i / (points.length - 1)) * (W - m.l - m.r);
  const y = v => m.t + (1 - (v - yMin) / (yMax - yMin)) * (H - m.t - m.b);

  for (const t of ticks) {
    el('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), class: 'gridline' }, svg);
    el('text', { x: m.l - 8, y: y(t) + 3.5, 'text-anchor': 'end', class: 'axis-label' }, svg)
      .textContent = opts.yFmt ? opts.yFmt(t) : t;
  }
  points.forEach((p, i) => {
    const last = i === points.length - 1;
    const t = el('text', { x: x(i), y: H - 9, 'text-anchor': 'middle', class: `axis-label${last ? ' em' : ''}` }, svg);
    t.textContent = p.x;
  });

  if (opts.anchor) {
    el('line', { x1: m.l, x2: W - m.r, y1: y(opts.anchor.value), y2: y(opts.anchor.value), stroke: COLORS.faint, 'stroke-dasharray': '5 5', 'stroke-width': 1.2 }, svg);
    const lbl = el('text', { x: W - m.r, y: y(opts.anchor.value) - 6, 'text-anchor': 'end', class: 'axis-label em' }, svg);
    lbl.textContent = opts.anchor.label;
  }

  const idx = points.map((p, i) => ({ ...p, i })).filter(p => p.y !== null && p.y !== undefined);
  const d = idx.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.y).toFixed(1)}`).join('');

  // area fill
  const defs = el('defs', {}, svg);
  const grad = el('linearGradient', { id: `${id}g`, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el('stop', { offset: '0%', 'stop-color': COLORS.lime, 'stop-opacity': 0.22 }, grad);
  el('stop', { offset: '100%', 'stop-color': COLORS.lime, 'stop-opacity': 0 }, grad);
  const areaD = `${d}L${x(idx.at(-1).i)},${H - m.b}L${x(idx[0].i)},${H - m.b}Z`;
  const area = el('path', { d: areaD, fill: `url(#${id}g)`, opacity: 0 }, svg);

  const line = el('path', { d, class: 'chart-series-line', stroke: COLORS.lime }, svg);

  // draw-in
  if (!reducedMotion()) {
    const len = line.getTotalLength();
    line.style.strokeDasharray = len;
    line.style.strokeDashoffset = len;
    line.getBoundingClientRect();
    line.style.transition = 'stroke-dashoffset 580ms cubic-bezier(0.22,1,0.36,1)';
    line.style.strokeDashoffset = '0';
    area.style.transition = 'opacity 420ms ease 260ms';
  }
  requestAnimationFrame(() => { area.style.opacity = '1'; });

  // dots: end point emphasized
  idx.forEach((p, k) => {
    const last = k === idx.length - 1;
    el('circle', {
      cx: x(p.i), cy: y(p.y), r: last ? 4.5 : 3,
      fill: last ? COLORS.lime : '#0A0D0B',
      stroke: COLORS.lime, 'stroke-width': 2, class: 'chart-dot',
    }, svg);
  });

  // end-value direct label
  const lastP = idx.at(-1);
  const endLbl = el('text', {
    x: Math.min(x(lastP.i) + 9, W - 4), y: y(lastP.y) - 10,
    class: 'direct-label', fill: COLORS.lime,
    'text-anchor': x(lastP.i) > W - 56 ? 'end' : 'start',
  }, svg);
  endLbl.textContent = opts.yFmt ? opts.yFmt(lastP.y) : lastP.y;

  // crosshair + tooltip
  const cross = el('line', { y1: m.t, y2: H - m.b, stroke: COLORS.faint, 'stroke-width': 1, opacity: 0, 'pointer-events': 'none' }, svg);
  const hot = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' }, svg);
  hot.addEventListener('pointermove', e => {
    const rect = svg.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (W / rect.width);
    let best = idx[0];
    for (const p of idx) if (Math.abs(x(p.i) - px) < Math.abs(x(best.i) - px)) best = p;
    cross.setAttribute('x1', x(best.i)); cross.setAttribute('x2', x(best.i));
    cross.setAttribute('opacity', 0.6);
    showTip(ttHtml(best.title || best.x, best.rows || [[opts.unit || 'value', opts.yFmt ? opts.yFmt(best.y) : best.y]]), e.clientX, e.clientY);
  });
  hot.addEventListener('pointerleave', () => { cross.setAttribute('opacity', 0); hideTip(); });

  return svg;
}

// ── bar chart ─────────────────────────────────────────────────────────
// bars: [{label, value|null, title?, rows?, dim?}]
export function barChart(container, bars, opts = {}) {
  container.innerHTML = '';
  const W = Math.max(300, container.clientWidth || 560);
  const H = opts.height || 230;
  const m = { t: 18, r: 14, b: 30, l: opts.yAxis === false ? 14 : 40 };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img' }, container);

  const valid = bars.filter(b => b.value !== null && b.value !== undefined);
  if (!valid.length) return emptyNote(container, svg, W, H, 'No data for this period');

  const hi = opts.max ?? Math.max(...valid.map(b => b.value), opts.target?.value || 0) * 1.08;
  let ticks = niceTicks(0, hi);
  if (opts.max) ticks = ticks.filter(t => t <= opts.max);
  const yMax = ticks.at(-1);
  const y = v => m.t + (1 - v / yMax) * (H - m.t - m.b);

  if (opts.yAxis !== false) for (const t of ticks) {
    el('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), class: 'gridline' }, svg);
    el('text', { x: m.l - 8, y: y(t) + 3.5, 'text-anchor': 'end', class: 'axis-label' }, svg)
      .textContent = opts.yFmt ? opts.yFmt(t) : t;
  }

  const slot = (W - m.l - m.r) / bars.length;
  const bw = Math.min(opts.maxBarW || 46, slot * 0.62);

  if (opts.target) {
    el('line', { x1: m.l, x2: W - m.r, y1: y(opts.target.value), y2: y(opts.target.value), stroke: COLORS.faint, 'stroke-dasharray': '5 5', 'stroke-width': 1.2 }, svg);
    el('text', { x: W - m.r, y: y(opts.target.value) - 6, 'text-anchor': 'end', class: 'axis-label em' }, svg)
      .textContent = opts.target.label;
  }

  const baseY = H - m.b;
  bars.forEach((b, i) => {
    const cx = m.l + slot * i + slot / 2;
    el('text', { x: cx, y: H - 9, 'text-anchor': 'middle', class: `axis-label${b.em ? ' em' : ''}` }, svg)
      .textContent = b.label;
    if (b.value === null || b.value === undefined) {
      el('text', { x: cx, y: baseY - 6, 'text-anchor': 'middle', class: 'axis-label' }, svg).textContent = '·';
      return;
    }
    const hFull = baseY - y(b.value);
    const fill = b.color || (b.dim ? COLORS.limeDim : COLORS.lime);
    const rect = el('rect', {
      x: cx - bw / 2, y: baseY, width: bw, height: 0,
      rx: Math.min(4, bw / 2), fill, opacity: b.dim ? 0.45 : 0.92,
    }, svg);
    const show = () => { rect.setAttribute('y', y(b.value)); rect.setAttribute('height', Math.max(hFull, 1.5)); };
    if (reducedMotion()) show();
    else {
      rect.style.transition = `y 480ms cubic-bezier(0.22,1,0.36,1) ${i * 45}ms, height 480ms cubic-bezier(0.22,1,0.36,1) ${i * 45}ms`;
      requestAnimationFrame(() => requestAnimationFrame(show));
    }
    // selective direct label: emphasized bar(s) only
    if (b.em) {
      const lbl = el('text', { x: cx, y: y(b.value) - 7, 'text-anchor': 'middle', class: 'direct-label', fill: COLORS.lime }, svg);
      lbl.textContent = opts.yFmt ? opts.yFmt(b.value) : b.value;
      if (!reducedMotion()) { lbl.style.opacity = 0; lbl.style.transition = 'opacity 300ms ease 500ms'; requestAnimationFrame(() => lbl.style.opacity = 1); }
    }
    const hot = el('rect', { x: m.l + slot * i, y: m.t, width: slot, height: H - m.t - m.b, fill: 'transparent' }, svg);
    hot.addEventListener('pointermove', e =>
      showTip(ttHtml(b.title || b.label, b.rows || [['value', opts.yFmt ? opts.yFmt(b.value) : b.value]]), e.clientX, e.clientY));
    hot.addEventListener('pointerleave', hideTip);
  });

  return svg;
}

// ── grouped bars (2 series) ───────────────────────────────────────────
// groups: [{label, a, b}] — series names in opts.seriesA/seriesB
export function groupedBars(container, groups, opts = {}) {
  container.innerHTML = '';
  const W = Math.max(300, container.clientWidth || 560);
  const H = opts.height || 220;
  const m = { t: 18, r: 14, b: 30, l: 40 };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img' }, container);

  const vals = groups.flatMap(g => [g.a, g.b]).filter(v => v !== null && v !== undefined);
  if (!vals.length) return emptyNote(container, svg, W, H, 'No data for this period');
  const ticks = niceTicks(0, Math.max(...vals) * 1.15);
  const yMax = ticks.at(-1);
  const y = v => m.t + (1 - v / yMax) * (H - m.t - m.b);

  for (const t of ticks) {
    el('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), class: 'gridline' }, svg);
    el('text', { x: m.l - 8, y: y(t) + 3.5, 'text-anchor': 'end', class: 'axis-label' }, svg)
      .textContent = `${t}%`;
  }

  const slot = (W - m.l - m.r) / groups.length;
  const bw = Math.min(30, slot * 0.26);
  const gap = 4; // surface gap between paired bars
  const baseY = H - m.b;

  groups.forEach((g, i) => {
    const cx = m.l + slot * i + slot / 2;
    el('text', { x: cx, y: H - 9, 'text-anchor': 'middle', class: 'axis-label em' }, svg).textContent = g.label;
    [[g.a, COLORS.limeDeep, opts.seriesA, -bw - gap / 2], [g.b, COLORS.blue, opts.seriesB, gap / 2]].forEach(([v, color, name, dx], k) => {
      if (v === null || v === undefined) return;
      const rect = el('rect', { x: cx + dx, y: baseY, width: bw, height: 0, rx: 4, fill: color, opacity: 0.95 }, svg);
      const show = () => { rect.setAttribute('y', y(v)); rect.setAttribute('height', Math.max(baseY - y(v), 1.5)); };
      if (reducedMotion()) show();
      else {
        rect.style.transition = `y 460ms cubic-bezier(0.22,1,0.36,1) ${i * 60 + k * 40}ms, height 460ms cubic-bezier(0.22,1,0.36,1) ${i * 60 + k * 40}ms`;
        requestAnimationFrame(() => requestAnimationFrame(show));
      }
      const lbl = el('text', { x: cx + dx + bw / 2, y: y(v) - 6, 'text-anchor': 'middle', class: 'direct-label', fill: color }, svg);
      lbl.textContent = `${v}%`;
      const hot = el('rect', { x: cx + dx - 3, y: m.t, width: bw + 6, height: H - m.t - m.b, fill: 'transparent' }, svg);
      hot.addEventListener('pointermove', e => showTip(ttHtml(g.label, [[name, `${v}%`]]), e.clientX, e.clientY));
      hot.addEventListener('pointerleave', hideTip);
    });
  });

  return svg;
}

// ── radial gauge ──────────────────────────────────────────────────────
export function gauge(container, { value, max, display, unit, size = 108 }) {
  container.innerHTML = '';
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, max ? value / max : 0));
  const wrap = document.createElement('div');
  wrap.className = 'gauge';
  wrap.style.width = `${size}px`;
  wrap.style.height = `${size}px`;
  const svg = el('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size });
  el('circle', { cx: size / 2, cy: size / 2, r, class: 'gauge-track', 'stroke-width': stroke }, svg);
  const arc = el('circle', {
    cx: size / 2, cy: size / 2, r, class: 'gauge-arc', 'stroke-width': stroke,
    'stroke-dasharray': c, 'stroke-dashoffset': c,
    transform: `rotate(-90 ${size / 2} ${size / 2})`,
  }, svg);
  wrap.appendChild(svg);
  const center = document.createElement('div');
  center.className = 'gauge-center';
  center.innerHTML = `<div class="gauge-value">${display}</div>${unit ? `<div class="gauge-unit">${unit}</div>` : ''}`;
  wrap.appendChild(center);
  container.appendChild(wrap);
  const target = c * (1 - frac * 0.999);
  if (reducedMotion()) arc.style.strokeDashoffset = target;
  else {
    arc.getBoundingClientRect();
    arc.style.transition = 'stroke-dashoffset 600ms cubic-bezier(0.22,1,0.36,1) 120ms';
    arc.style.strokeDashoffset = target;
  }
  return wrap;
}

// ── contribution graph ────────────────────────────────────────────────
// GitHub-style day grid. Two visually distinct states, because the sources
// have different coverage: tracked workout days carry intensity from
// `minutes`; round-only days (before Apple Watch tracking began) get a flat
// marker. Rendering only the tracked series would show five months as empty.
export function contributionGraph(container, days, { start, end } = {}) {
  container.innerHTML = '';
  const dates = [...days.keys()].sort();
  if (!dates.length) {
    container.innerHTML = '<p class="note">No sessions recorded in this range.</p>';
    return;
  }
  const first = new Date(`${start || dates[0]}T00:00:00Z`);
  const last = new Date(`${end || dates.at(-1)}T00:00:00Z`);

  // start on the Monday of the first week
  const gridStart = new Date(first);
  const dow = (gridStart.getUTCDay() + 6) % 7; // Mon=0
  gridStart.setUTCDate(gridStart.getUTCDate() - dow);

  const weeks = Math.ceil(((last - gridStart) / 86400000 + 1) / 7);
  const CELL = 13, GAP = 3, LEFT = 26, TOP = 18;
  const W = LEFT + weeks * (CELL + GAP);
  const H = TOP + 7 * (CELL + GAP) + 4;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', class: 'contrib' }, container);

  const maxMin = Math.max(...[...days.values()].map(d => d.minutes), 1);
  const iso = d => d.toISOString().slice(0, 10);

  ['M', 'W', 'F'].forEach((lbl, i) => {
    el('text', { x: 0, y: TOP + (i * 2) * (CELL + GAP) + CELL - 2, class: 'axis-label' }, svg).textContent = lbl;
  });

  let lastMonth = '';
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const cur = new Date(gridStart);
      cur.setUTCDate(cur.getUTCDate() + w * 7 + d);
      if (cur > last) continue;
      const key = iso(cur);
      const x = LEFT + w * (CELL + GAP);
      const y = TOP + d * (CELL + GAP);

      if (d === 0) {
        const mo = cur.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
        if (mo !== lastMonth) {
          el('text', { x, y: 10, class: 'axis-label' }, svg).textContent = mo;
          lastMonth = mo;
        }
      }

      const rec = days.get(key);
      const cell = el('rect', {
        x, y, width: CELL, height: CELL, rx: 3,
        class: 'contrib-cell' + (rec ? (rec.tracked ? ' tracked' : ' round-only') : ''),
      }, svg);

      if (rec) {
        if (rec.tracked) {
          // intensity from minutes; floor keeps a short session visible
          cell.style.opacity = String(0.35 + 0.65 * Math.min(1, rec.minutes / maxMin));
        }
        const parts = [];
        if (rec.rounds) parts.push(['Rounds', rec.rounds]);
        if (rec.minutes) parts.push(['Tracked', `${Math.round(rec.minutes)} min`]);
        if (!rec.tracked) parts.push(['Source', 'round record only']);
        cell.addEventListener('pointermove', e => showTip(ttHtml(
          new Date(`${key}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
          parts), e.clientX, e.clientY));
        cell.addEventListener('pointerleave', hideTip);
      }
    }
  }
  return svg;
}

// ── count-up ──────────────────────────────────────────────────────────
export function countUp(node, target, { decimals = 0, duration = 560, suffix = '' } = {}) {
  if (target === null || target === undefined) { node.textContent = '—'; return; }
  if (reducedMotion()) { node.textContent = target.toFixed(decimals) + suffix; return; }
  const start = performance.now();
  const from = 0;
  const step = now => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    node.textContent = (from + (target - from) * eased).toFixed(decimals) + suffix;
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function emptyNote(container, svg, W, H, msg) {
  const t = el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'axis-label em' }, svg);
  t.textContent = msg;
  return svg;
}
