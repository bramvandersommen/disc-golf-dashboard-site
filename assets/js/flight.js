// flight.js — deterministic disc-golf flight-path curve from (speed, glide, turn,
// fade). Direct port of tools/flight_path.py — a pure function of the four flight
// numbers, so nothing is stored or fetched. Verified against the Python model and
// the Infinite Discs calibration (Innova Star Wraith 11/5/-1/3 → ~395 ft, shallow
// right bulge peaking ~260 ft, finishing just left of the launch line).
//
// Sign convention: +x = right of the launch line for RHBH. Understable discs have
// negative turn, so -turn yields rightward drift; fade is positive and pulls left.

// ── model constants (identical to the Python) ──────────────────────────
const D0 = 130.0, KS = 20.0, KG = 9.0;        // distance model (feet)
const A = 34.0, MU_T = 0.45, SIG_T = 0.26;    // turn (high-speed) term
const B = 62.0, T0 = 0.55;                    // fade (low-speed) term
const STEPS = 160;

export const POWER     = { slower: 0.82, normal: 1.0, faster: 1.18 };
export const TURN_GAIN = { slower: 0.55, normal: 1.0, faster: 1.45 };
export const FADE_GAIN = { slower: 1.25, normal: 1.0, faster: 0.85 };

const gauss = (t, mu, sig) => Math.exp(-(((t - mu) / sig) ** 2));

// The model is calibrated in feet (Infinite Discs reference). The dashboard is
// metric-only, so display is metres — internal maths stays in feet for calibration
// integrity, and only the rendered axis/points are converted.
export const FT_TO_M = 0.3048;

export function distanceFt(f, power = 'normal') {
  return (D0 + KS * f.speed + KG * f.glide) * POWER[power];
}

export const distanceM = (f, power = 'normal') => distanceFt(f, power) * FT_TO_M;

// Return [{x, y}, …] in feet from release (0,0) to landing. +x = right (RHBH).
export function path(f, { power = 'normal', hand = 'rhbh', steps = STEPS } = {}) {
  const dist = distanceFt(f, power);
  const tg = TURN_GAIN[power], fg = FADE_GAIN[power];
  const dt = 1.0 / steps;

  const pts = [];
  let x = 0.0;
  for (let i = 0; i <= steps; i++) {
    const t = i * dt;
    pts.push({ x, y: t * dist });
    const vTurn = -f.turn * A * tg * gauss(t, MU_T, SIG_T);
    const vFade = -f.fade * B * fg * (Math.max(0, t - T0) / (1.0 - T0)) ** 2;
    x += (vTurn + vFade) * dt;
  }
  const mirror = hand.toLowerCase() === 'lhbh' || hand.toLowerCase() === 'rhfh';
  return mirror ? pts.map(p => ({ x: -p.x, y: p.y })) : pts;
}

// Convenience: coerce a disc record's flight numbers into the {speed,glide,turn,fade}
// the model wants. Numbers may arrive as strings from the Sheet — coerce.
export const flightOf = d => ({
  speed: Number(d.speed), glide: Number(d.glide),
  turn: Number(d.turn), fade: Number(d.fade),
});

// ── themed SVG renderer ────────────────────────────────────────────────
// Draws one or more flight paths on a dark card. Colours come from CSS variables
// so it themes with the dashboard; pass an explicit colour per disc for overlays.
// discs: [{ name, speed, glide, turn, fade, color? }]
export function renderFlightSvg(discs, {
  width = 300, height = 380, power = 'normal', hand = 'rhbh',
  accent = 'var(--lime, #C8FF4D)', yMax = null, xHalf = null,
  strokeWidth = 4, showEnd = true,
} = {}) {
  const list = Array.isArray(discs) ? discs : [discs];
  // Plot in metres (dashboard is metric-only); the model's feet are converted here.
  const paths = list.map(d => ({
    d, pts: path(flightOf(d), { power, hand }).map(p => ({ x: p.x * FT_TO_M, y: p.y * FT_TO_M })),
  }));
  const all = paths.flatMap(p => p.pts);

  const yTop = yMax ?? Math.ceil(Math.max(...all.map(p => p.y)) / 25) * 25;
  const span = all.length ? Math.max(...all.map(p => Math.abs(p.x))) : 1;
  const xh = xHalf ?? Math.max(20, Math.ceil((span * 1.45) / 10) * 10);

  const ml = 40, mr = 14, mt = 14, mb = 26;
  const pw = width - ml - mr, ph = height - mt - mb;
  const sx = xft => ml + pw / 2 + (xft / xh) * (pw / 2);
  const sy = yft => mt + ph - (yft / yTop) * ph;

  const palette = ['#6883D6', '#7A9F2C', '#E0B341', '#D97757'];
  const colorFor = (d, i) => d.color || (i === 0 ? accent : palette[(i - 1) % palette.length]);

  const o = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Disc flight path">`,
    `<style>`,
    `.fp-g{stroke:var(--fp-grid,#242D26);stroke-width:1}`,
    `.fp-a{stroke:var(--fp-grid,#2c352e);stroke-width:1;stroke-dasharray:3 5}`,
    `.fp-l{font:500 10px var(--font-body,Inter,system-ui,sans-serif);fill:var(--fp-muted,#5C6960)}`,
    `.fp-p{fill:none;stroke-linecap:round;stroke-linejoin:round}`,
    `</style>`,
  ];

  // horizontal gridlines + distance labels (metres)
  const step = yTop <= 150 ? 25 : 50;
  for (let v = 0; v <= yTop + 0.1; v += step) {
    const yy = sy(v).toFixed(1);
    o.push(`<line class="fp-g" x1="${ml}" y1="${yy}" x2="${ml + pw}" y2="${yy}"/>`);
    o.push(`<text class="fp-l" x="${ml - 6}" y="${(+yy + 3).toFixed(1)}" text-anchor="end">${v === yTop ? v + 'm' : v}</text>`);
  }
  // centre launch line + side guides
  for (let k = -2; k <= 2; k++) {
    const xx = (ml + pw / 2 + k * (pw / 6)).toFixed(1);
    o.push(`<line class="${k === 0 ? 'fp-a' : 'fp-g'}" x1="${xx}" y1="${mt}" x2="${xx}" y2="${mt + ph}"/>`);
  }
  o.push(`<line class="fp-g" x1="${ml}" y1="${mt + ph}" x2="${ml + pw}" y2="${mt + ph}"/>`);

  // draw each path with a soft glow under the accent
  paths.forEach(({ d, pts }, i) => {
    const col = colorFor(d, i);
    const dd = pts.map((p, j) => `${j ? 'L' : 'M'}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(' ');
    o.push(`<path class="fp-p" d="${dd}" stroke="${col}" stroke-width="${strokeWidth}" opacity="0.95"/>`);
    if (showEnd) {
      const e = pts[pts.length - 1];
      o.push(`<circle cx="${sx(e.x).toFixed(1)}" cy="${sy(e.y).toFixed(1)}" r="${strokeWidth}" fill="${col}"/>`);
    }
  });

  o.push('</svg>');
  return o.join('');
}
