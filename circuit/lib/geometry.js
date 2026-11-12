// 网格、端点坐标（含旋转）、触控命中、导线直角走线。坐标单位：网格。
import { PARTS } from './parts.js';

export const GRID = 40;
export const BOARD = Object.freeze({ w: 28, h: 18 });
export const BODY_RECT = Object.freeze({ x0: -1.6, x1: 1.6, y0: -0.6, y1: 0.6 });
export const LEVER_RECT = Object.freeze({ x0: -0.6, x1: 0.6, y0: -1.8, y1: -0.6 });
export const TERM_R = 0.55;
export const WIRE_HIT = 0.5;
export const MIN_TOUCH_PT = 44;

export function rotatePoint([x, y], rot) {
  let px = x, py = y;
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) [px, py] = [-py, px];
  return [px, py];
}

export function terminalPoint(part, term) {
  const [lx, ly] = rotatePoint(PARTS[part.type].termPos[term], part.rot);
  return [part.x + lx, part.y + ly];
}

export function touchAreas(k = 1) {
  const m = MIN_TOUCH_PT / (k * GRID);
  const lw = Math.max(LEVER_RECT.x1, m / 2);
  const bw = Math.max(BODY_RECT.x1, m / 2);
  return {
    termR: Math.max(TERM_R, m / 2),
    lever: { x0: -lw, x1: lw, y0: Math.min(LEVER_RECT.y0, LEVER_RECT.y1 - m), y1: LEVER_RECT.y1 },
    body: { x0: -bw, x1: bw, y0: BODY_RECT.y0, y1: Math.max(BODY_RECT.y1, BODY_RECT.y0 + m) },
  };
}

const toLocal = (part, [x, y]) => rotatePoint([x - part.x, y - part.y], 4 - (part.rot % 4));

function distToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function wirePoints(circuit, wire) {
  const pa = circuit.parts.find(p => p.id === wire.a.part);
  const pb = circuit.parts.find(p => p.id === wire.b.part);
  if (!pa || !pb) return null;
  return wireRoute(terminalPoint(pa, wire.a.term), terminalPoint(pb, wire.b.term));
}

export function hitTest(circuit, pt, k = 1) {
  const { termR, lever, body } = touchAreas(k);
  const parts = [...circuit.parts].reverse();
  let best = null, bestD = Infinity;
  for (const p of parts) {
    for (const term of PARTS[p.type].terms) {
      const [tx, ty] = terminalPoint(p, term);
      const d = Math.hypot(pt[0] - tx, pt[1] - ty);
      if (d <= termR && d < bestD) { best = { kind: 'terminal', part: p.id, term }; bestD = d; }
    }
  }
  if (best) return best;
  for (const p of parts) {
    if (!PARTS[p.type].lever) continue;
    const [x, y] = toLocal(p, pt);
    if (x >= lever.x0 && x <= lever.x1 && y >= lever.y0 && y < lever.y1) return { kind: 'lever', id: p.id };
  }
  for (const p of parts) {
    const [x, y] = toLocal(p, pt);
    if (x >= body.x0 && x <= body.x1 && y >= body.y0 && y <= body.y1) return { kind: 'part', id: p.id };
  }
  for (const w of [...circuit.wires].reverse()) {
    const pts = wirePoints(circuit, w);
    if (!pts) continue;
    for (let i = 1; i < pts.length; i++) {
      if (distToSegment(pt, pts[i - 1], pts[i]) <= WIRE_HIT) return { kind: 'wire', id: w.id };
    }
  }
  return null;
}

export function wireRoute(p1, p2) {
  if (p1[0] === p2[0] || p1[1] === p2[1]) return [p1, p2];
  return [p1, [p2[0], p1[1]], p2];
}

export function snap([x, y]) {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  return [clamp(Math.round(x), 3, BOARD.w - 3), clamp(Math.round(y), 3, BOARD.h - 3)];
}
