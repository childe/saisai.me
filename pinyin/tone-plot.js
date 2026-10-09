/** 把标准音和本次录音的归一化音高曲线画在同一张图上。 */

export const RANGE = 10;   // 纵轴 ±10 半音
export const PAD = 12;

const REF_COLOR = '#b8b2d8';
const USER_COLOR = '#667eea';

/** 曲线 → 画布坐标。纯函数，便于单测。 */
export function contourPoints(contour, w, h) {
  if (!contour || contour.length === 0) return [];
  const span = w - 2 * PAD;
  const half = h / 2 - PAD;
  const n = contour.length;
  return Array.from(contour, (v, i) => {
    const clamped = Math.max(-RANGE, Math.min(RANGE, v));
    return {
      x: n === 1 ? PAD : PAD + span * i / (n - 1),
      y: h / 2 - (clamped / RANGE) * half,
    };
  });
}

function stroke(ctx, pts, color, width, dash) {
  if (pts.length === 0) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(dash || []);
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
  ctx.restore();
}

export function drawContours(canvas, { reference, user }) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // 中线
  ctx.strokeStyle = '#ddd9f0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, h / 2);
  ctx.lineTo(w - PAD, h / 2);
  ctx.stroke();

  stroke(ctx, contourPoints(reference, w, h), REF_COLOR, 3, [6, 5]);
  stroke(ctx, contourPoints(user, w, h), USER_COLOR, 4);
}
