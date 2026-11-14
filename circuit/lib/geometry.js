// 网格、端点坐标（含旋转）、触控命中、导线直角走线。坐标单位：网格。
import { PARTS } from './parts.js';

export const GRID = 40;
export const BOARD = Object.freeze({ w: 28, h: 18 });
export const BODY_RECT = Object.freeze({ x0: -1.6, x1: 1.6, y0: -0.6, y1: 0.6 });
export const LEVER_RECT = Object.freeze({ x0: -0.6, x1: 0.6, y0: -1.8, y1: -0.6 });
export const TERM_R = 0.55;
export const WIRE_HIT = 0.5;
export const MIN_TOUCH_PT = 44;
const SELF_WIRE_OFFSET = 1.5;

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

// 元件自己写了 body / leverRect 时：以矩形中心往四周撑到至少 44 屏幕像素。
function grow(r, k) {
  const m = MIN_TOUCH_PT / (k * GRID);
  const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
  const hw = Math.max((r.x1 - r.x0) / 2, m / 2), hh = Math.max((r.y1 - r.y0) / 2, m / 2);
  return { x0: cx - hw, x1: cx + hw, y0: cy - hh, y1: cy + hh };
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
  if (pa === pb && !Array.isArray(wire.via)) {
    // 同一元件两端之间的导线：往元件本地 +y 方向（拨片的反方向）绕出一个 U 形，不压在本体上。
    const p1 = terminalPoint(pa, wire.a.term), p2 = terminalPoint(pa, wire.b.term);
    const [ox, oy] = rotatePoint([0, SELF_WIRE_OFFSET], pa.rot);
    return [p1, [p1[0] + ox, p1[1] + oy], [p2[0] + ox, p2[1] + oy], p2];
  }
  const A = terminalPoint(pa, wire.a.term), B = terminalPoint(pb, wire.b.term);
  if (!Array.isArray(wire.via)) return wireRoute(A, B);
  // 显式路线：依次经过各拐点（含 via: []），相邻两点之间按直角走线。
  const stops = [A, ...wire.via, B];
  const out = [A];
  for (let i = 1; i < stops.length; i++) out.push(...wireRoute(stops[i - 1], stops[i]).slice(1));
  return simplifyRoute(out);
}

export const expandRoute = wirePoints;

const samePt = (p, q) => p[0] === q[0] && p[1] === q[1];
const clampV = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 去掉相邻重复点和共线的中间点；至少保留 2 个点。
export function simplifyRoute(points) {
  const out = [];
  for (const p of points) {
    if (out.length && samePt(out.at(-1), p)) continue;
    if (out.length >= 2) {
      const a = out.at(-2), b = out.at(-1);
      if ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1])) out.pop();
    }
    out.push(p);
  }
  if (out.length === 1) out.push(out[0]);
  return out;
}

// 折线上离 pt 最近的线段，以及沿该线段取整（夹在线段范围内）的落点。
export function nearestOnRoute(points, pt) {
  let seg = 0, bestD = Infinity;
  for (let i = 0; i + 1 < points.length; i++) {
    const d = distToSegment(pt, points[i], points[i + 1]);
    if (d < bestD) { bestD = d; seg = i; }
  }
  const [a, b] = [points[seg], points[seg + 1]];
  if (a[1] === b[1]) {
    return { seg, P: [clampV(Math.round(pt[0]), Math.min(a[0], b[0]), Math.max(a[0], b[0])), a[1]] };
  }
  return { seg, P: [a[0], clampV(Math.round(pt[1]), Math.min(a[1], b[1]), Math.max(a[1], b[1]))] };
}

// 在 P 处把折线分成两段，返回两段各自的拐点。P 为首末点或不在折线上时返回 null。
export function splitRoute(points, P) {
  if (samePt(P, points[0]) || samePt(P, points.at(-1))) return null;
  for (let i = 0; i + 1 < points.length; i++) {
    if (distToSegment(P, points[i], points[i + 1]) > 1e-9) continue;
    // 只去掉紧挨分割处、与 P 重合的那个拐点；路线后面再次经过 P 的拐点要保留。
    const via1 = points.slice(1, i + 1), via2 = points.slice(i + 1, -1);
    if (via1.length && samePt(via1.at(-1), P)) via1.pop();
    if (via2.length && samePt(via2[0], P)) via2.shift();
    return { via1, via2 };
  }
  return null;
}

// 拼接两段折线（pts1 以连接点结尾、pts2 以连接点开头），返回合并后导线的拐点。
export function joinRoute(pts1, pts2) {
  return simplifyRoute([...pts1, ...pts2.slice(1)]).slice(1, -1);
}

export function hitTest(circuit, pt, k = 1, selWire = null) {
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
  // 选中导线的线段把手：每段中点一个。
  const sw = selWire && circuit.wires.find(w => w.id === selWire);
  const spts = sw && wirePoints(circuit, sw);
  if (spts) {
    for (let i = 0; i + 1 < spts.length; i++) {
      const mx = (spts[i][0] + spts[i + 1][0]) / 2, my = (spts[i][1] + spts[i + 1][1]) / 2;
      const d = Math.hypot(pt[0] - mx, pt[1] - my);
      if (d <= termR && d < bestD) { best = { kind: 'handle', wire: selWire, seg: i }; bestD = d; }
    }
    if (best) return best;
  }
  for (const p of parts) {
    const def = PARTS[p.type];
    if (!def.lever) continue;
    const r = def.leverRect ? grow(def.leverRect, k) : lever;
    const [x, y] = toLocal(p, pt);
    if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y < r.y1) return { kind: 'lever', id: p.id };
  }
  for (const p of parts) {
    if (p.type === 'node') continue; // 连接点没有本体，只有端点
    const b = PARTS[p.type].body ? grow(PARTS[p.type].body, k) : body;
    const [x, y] = toLocal(p, pt);
    if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return { kind: 'part', id: p.id };
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

// 手指轨迹 → 直角路线。pts[0] 是起点，其余是已落下的拐点；dir 是当前段的走向。
export const TRACE_TURN = 1;
export const TRACE_BACK = 0.5;

const segDir = (a, b) => (a[1] === b[1] ? 'h' : 'v');

export function startTrace(start) {
  return { pts: [start], dir: null };
}

export function stepTrace(trace, pt) {
  const pts = trace.pts.slice();
  let dir = trace.dir;
  // 回退：手指回到上一段上，吃掉最后一个拐点。
  while (pts.length >= 2 && distToSegment(pt, pts.at(-2), pts.at(-1)) < TRACE_BACK) {
    pts.pop();
    dir = segDir(pts.at(-1), trace.pts[pts.length]);
  }
  const last = pts.at(-1);
  if (pts.length === 1 && Math.hypot(pt[0] - last[0], pt[1] - last[1]) < TRACE_TURN) return { pts, dir: null };
  if (dir === null) {
    const dx = Math.abs(pt[0] - last[0]), dy = Math.abs(pt[1] - last[1]);
    if (Math.max(dx, dy) >= TRACE_TURN) dir = dx >= dy ? 'h' : 'v';
    return { pts, dir };
  }
  let c = null;
  if (dir === 'h' && Math.abs(pt[1] - last[1]) >= TRACE_TURN) {
    c = [clampV(Math.round(pt[0]), 0, BOARD.w), last[1]];
    dir = 'v';
  } else if (dir === 'v' && Math.abs(pt[0] - last[0]) >= TRACE_TURN) {
    c = [last[0], clampV(Math.round(pt[1]), 0, BOARD.h)];
    dir = 'h';
  }
  if (c) {
    if (samePt(c, last)) { if (pts.length >= 2) pts.pop(); }
    else pts.push(c);
  }
  return { pts, dir };
}

export function tracePath(trace, end) {
  const pts = trace.pts;
  const last = pts.at(-1);
  let tail;
  if (trace.dir === 'h') tail = [last, [end[0], last[1]], end];
  else if (trace.dir === 'v') tail = [last, [last[0], end[1]], end];
  else tail = wireRoute(last, end);
  return simplifyRoute([...pts.slice(0, -1), ...tail]);
}

// 垂直位移取整后叠加到原坐标上（保留半格线段的偏移），并限制在 [0, max] 内。
const shiftBy = (v, d, max) => v + clampV(Math.round(d), Math.ceil(-v), Math.floor(max - v));

// 拖动折线的第 seg 段：垂直于该段平移 delta（相对按下位置），位移取整到整格；返回新的拐点。
export function dragSegment(points, seg, delta) {
  const a = points[seg], b = points[seg + 1];
  const last = points.length - 2;
  const pts = points.map(p => [...p]);
  let ins0 = null, ins1 = null;
  if (a[1] === b[1]) {
    const ny = shiftBy(a[1], delta[1], BOARD.h);
    pts[seg][1] = ny; pts[seg + 1][1] = ny;
    if (seg === 0) ins0 = [a[0], ny];
    if (seg === last) ins1 = [b[0], ny];
  } else {
    const nx = shiftBy(a[0], delta[0], BOARD.w);
    pts[seg][0] = nx; pts[seg + 1][0] = nx;
    if (seg === 0) ins0 = [nx, a[1]];
    if (seg === last) ins1 = [nx, b[1]];
  }
  // 首末点（元件端点）不动：先还原，再在内侧插入新拐点。
  pts[0] = [...points[0]];
  pts[pts.length - 1] = [...points.at(-1)];
  if (ins1) pts.splice(pts.length - 1, 0, ins1);
  if (ins0) pts.splice(1, 0, ins0);
  return simplifyRoute(pts).slice(1, -1);
}
