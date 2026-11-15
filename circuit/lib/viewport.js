// 画板视野：中心点 (cx, cy) 和缩放 k（屏幕像素 / SVG 单位）。size 是画板元素的像素宽高。
import { GRID, BOARD } from './geometry.js';

// 打开时看到的区域：原来 28×18 格的画板。
export const HOME = Object.freeze({ x: 0, y: 0, w: 28 * GRID, h: 18 * GRID });
const WORLD = { w: BOARD.w * GRID, h: BOARD.h * GRID };
const PAD = 6;
export const MAX_ZOOM = 3; // 相对 HOME 视野最多放大 3 倍
export const MIN_ZOOM = 0.5; // 最多缩小一半；画板更大的部分靠拖动查看

// 把矩形 r 整个装进 size，留 PAD 像素边。
export function fitView(r, size) {
  const k = Math.min((size.w - 2 * PAD) / r.w, (size.h - 2 * PAD) / r.h);
  return { cx: r.x + r.w / 2, cy: r.y + r.h / 2, k: Math.max(k, 1e-3) };
}

export function zoomLimits(size) {
  const home = fitView(HOME, size).k;
  return { min: Math.max(home * MIN_ZOOM, fitView({ x: 0, y: 0, ...WORLD }, size).k), max: home * MAX_ZOOM };
}

// 限制缩放范围；视野比整块画板小时中心不出画板，比画板大时居中。
export function clampView(v, size) {
  const { min, max } = zoomLimits(size);
  const k = Math.min(max, Math.max(min, v.k));
  const hw = size.w / (2 * k), hh = size.h / (2 * k);
  const axis = (c, half, world) => (half * 2 >= world ? world / 2 : Math.min(world - half, Math.max(half, c)));
  return { cx: axis(v.cx, hw, WORLD.w), cy: axis(v.cy, hh, WORLD.h), k };
}

export function viewBox(v, size) {
  const w = size.w / v.k, h = size.h / v.k;
  return [v.cx - w / 2, v.cy - h / 2, w, h];
}

// 屏幕上 (px, py)（相对画板左上角）处的点在缩放后保持不动。
export function zoomAt(v, factor, [px, py], size) {
  const [x0, y0] = viewBox(v, size);
  const wx = x0 + px / v.k, wy = y0 + py / v.k;
  const k = clampView({ ...v, k: v.k * factor }, size).k;
  return clampView({ cx: wx - px / k + size.w / (2 * k), cy: wy - py / k + size.h / (2 * k), k }, size);
}

// 手指移动 (dx, dy) 屏幕像素，画面跟着走。
export function panBy(v, dx, dy, size) {
  return clampView({ ...v, cx: v.cx - dx / v.k, cy: v.cy - dy / v.k }, size);
}

// 装下所有元件和导线的视野，不比 HOME 更放大；没有内容时回到 HOME。
export function contentRect(points) {
  if (!points.length) return HOME;
  const xs = points.map(p => p[0] * GRID), ys = points.map(p => p[1] * GRID);
  const m = 3 * GRID;
  let x = Math.min(...xs) - m, y = Math.min(...ys) - m;
  let w = Math.max(...xs) + m - x, h = Math.max(...ys) + m - y;
  if (w < HOME.w) { x -= (HOME.w - w) / 2; w = HOME.w; }
  if (h < HOME.h) { y -= (HOME.h - h) / 2; h = HOME.h; }
  return { x, y, w, h };
}
