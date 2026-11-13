// 3D 迷宫主题：主题数据、确定性哈希与纹理绘制。
// 只用 Canvas 2D 的基本绘图方法，不依赖 three.js 与页面，可以在 node 中测试。

export const THEME_IDS = ['garden', 'brick', 'blocks', 'castle'];
export const DEFAULT_THEME = 'garden';

export const THEMES = {
  garden: {
    label: '🌳 花园',
    sky: { top: 0x7ec8f5, bottom: 0xd8f0ff },
    fogColor: 0xd8f0ff,
    hemi: { sky: 0xffffff, ground: 0xb7d9a0, intensity: 2.0 },
    sun: { color: 0xfff4e0, intensity: 1.0 },
    floorBase: 0xfffaf0,
    wallTint: 0xffffff,
  },
  brick: {
    label: '🧱 砖墙',
    sky: { top: 0x8fc4f0, bottom: 0xffe2c4 },
    fogColor: 0xffe2c4,
    hemi: { sky: 0xfff3e0, ground: 0xc9a68a, intensity: 2.0 },
    sun: { color: 0xffe8c8, intensity: 1.0 },
    floorBase: 0xf7f3ee,
    wallTint: 0xffffff,
  },
  blocks: {
    label: '🧸 积木',
    sky: { top: 0x9fd8ff, bottom: 0xe8f7ff },
    fogColor: 0xe8f7ff,
    hemi: { sky: 0xffffff, ground: 0xdde6f0, intensity: 2.1 },
    sun: { color: 0xffffff, intensity: 1.0 },
    floorBase: 0xf4f6f8,
    wallTint: 0xffffff,
    blockPalette: [0xef5350, 0xffca28, 0x42a5f5, 0x66bb6a, 0xffa726],
  },
  castle: {
    label: '🏰 城堡',
    sky: { top: 0x5d7290, bottom: 0xa9b8cc },
    fogColor: 0xa9b8cc,
    hemi: { sky: 0xdfe6f0, ground: 0x6b6f78, intensity: 1.9 },
    sun: { color: 0xfff0dc, intensity: 0.9 },
    floorBase: 0xaeb3bc,
    wallTint: 0xffffff,
  },
};

export function parseTheme(value) {
  for (const id of THEME_IDS) if (value === id) return id;
  return DEFAULT_THEME;
}

// ---------- 哈希与随机数 ----------
// murmur3 fmix32
function hash32(n) {
  let h = n | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function blockColorIndex(segmentIndex, paletteLength) {
  return hash32(segmentIndex + 0x9e37) % paletteLength;
}

export function wallShade(segmentIndex) {
  return 0.92 + 0.08 * (hash32(segmentIndex + 0x51ed) / 0xffffffff);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SURFACE = { wall: 0, top: 1, floor: 2 };

function rngFor(id, surface) {
  return mulberry32(hash32(THEME_IDS.indexOf(id) * 3 + SURFACE[surface] + 1));
}

function pick(rand, list) {
  return list[Math.floor(rand() * list.length)];
}

function between(rand, lo, hi) {
  return lo + rand() * (hi - lo);
}

function gray(v) {
  const c = Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${c},${c},${c})`;
}

// 把总长切成若干段，每段尽量落在 [min, max]
function partition(total, min, max, rand) {
  const parts = [];
  let rem = total;
  while (rem > max) {
    const hi = Math.min(max, rem - min);
    const p = hi >= min ? Math.round(between(rand, min, hi)) : Math.floor(rem / 2);
    parts.push(p);
    rem -= p;
  }
  parts.push(rem);
  return parts;
}

// 横向无缝：元素跨过左右边界时，在另一侧再画一份
function wrapX(size, x, halfWidth, draw) {
  draw(x);
  if (x - halfWidth < 0) draw(x + size);
  if (x + halfWidth > size) draw(x - size);
}

function ellipseAt(ctx, x, y, rx, ry, rot) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fill();
}

function circleAt(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ---------- 墙面 ----------
const LEAF_GREENS = ['#1c4418', '#2f6a28', '#4f9a3c', '#7cc35a', '#a6dd7e'];

function wallGarden(ctx, size, rand) {
  const k = size / 256;
  ctx.fillStyle = '#1f4a1c';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 520; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const rx = between(rand, 7, 14) * k;
    const ry = between(rand, 3.5, 7) * k;
    const rot = rand() * Math.PI;
    ctx.fillStyle = pick(rand, LEAF_GREENS);
    wrapX(size, x, rx, (xx) => ellipseAt(ctx, xx, y, rx, ry, rot));
  }
  const flowers = ['#ffffff', '#ffe066', '#ff9ec7'];
  for (let i = 0; i < 40; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = between(rand, 2, 3.5) * k;
    ctx.fillStyle = pick(rand, flowers);
    wrapX(size, x, r, (xx) => circleAt(ctx, xx, y, r));
  }
}

function wallBrick(ctx, size, rand) {
  const k = size / 256;
  const bw = 64 * k;
  const bh = 32 * k;
  const gap = 4 * k;
  ctx.fillStyle = '#3a3633';
  ctx.fillRect(0, 0, size, size);
  const reds = ['#c4593c', '#a94832', '#d36e4b', '#8f3d2a'];
  const rows = Math.round(size / bh);
  for (let r = 0; r < rows; r++) {
    const offset = r % 2 === 1 ? bw / 2 : 0;
    for (let c = -1; c < size / bw; c++) {
      const x = c * bw + offset;
      if (x >= size) continue;
      const y = r * bh;
      const color = pick(rand, reds);
      const speckles = [];
      for (let s = 0; s < 8; s++) speckles.push([rand(), rand(), between(rand, 1, 2.5) * k, s % 2 === 0]);
      const draw = (xx) => {
        ctx.fillStyle = color;
        ctx.fillRect(xx + gap / 2, y + gap / 2, bw - gap, bh - gap);
        ctx.fillStyle = 'rgba(255,220,190,0.35)';
        ctx.fillRect(xx + gap / 2, y + gap / 2, bw - gap, 3 * k);
        ctx.fillStyle = 'rgba(40,10,0,0.3)';
        ctx.fillRect(xx + gap / 2, y + bh - gap / 2 - 3 * k, bw - gap, 3 * k);
        ctx.fillStyle = 'rgba(255,225,200,0.12)';
        ctx.fillRect(xx + gap / 2, y + bh * 0.35, bw - gap, bh * 0.25);
        for (const [sx, sy, sr, dark] of speckles) {
          ctx.fillStyle = dark ? 'rgba(40,10,0,0.3)' : 'rgba(255,210,180,0.3)';
          circleAt(ctx, xx + gap + sx * (bw - 2 * gap), y + gap + sy * (bh - 2 * gap), sr);
        }
      };
      draw(x);
      if (x < 0) draw(x + size);
      if (x + bw > size) draw(x - size);
    }
  }
}

function wallBlocks(ctx, size, rand) {
  const half = size / 2;
  const k = size / 256;
  const line = 3 * k;
  ctx.fillStyle = gray(232);
  ctx.fillRect(0, 0, size, size);
  for (const x0 of [0, half]) {
    // 暗边：右沿、下沿
    ctx.fillStyle = gray(90);
    ctx.fillRect(x0 + half - 14 * k, 0, 14 * k, size);
    ctx.fillRect(x0, size - 16 * k, half, 16 * k);
    // 主体：自上而下略微变暗的塑料光泽
    ctx.fillStyle = gray(228);
    roundRectPath(ctx, x0 + 6 * k, 6 * k, half - 22 * k, size - 24 * k, 10 * k);
    ctx.fill();
    const bands = 12;
    const bandH = (size - 44 * k) / bands;
    for (let b = 0; b < bands; b++) {
      ctx.fillStyle = gray(240 - b * 2.5);
      ctx.fillRect(x0 + 12 * k, 16 * k + b * bandH, half - 34 * k, bandH);
    }
    // 细小的颗粒
    for (let s = 0; s < 220; s++) {
      ctx.fillStyle = gray(between(rand, 200, 250));
      circleAt(ctx, x0 + between(rand, 14, half / k - 26) * k, between(rand, 18, 228) * k, between(rand, 1, 2.5) * k);
    }
    // 左上高光
    ctx.fillStyle = gray(255);
    roundRectPath(ctx, x0 + 10 * k, 10 * k, half - 34 * k, 10 * k, 5 * k);
    ctx.fill();
    roundRectPath(ctx, x0 + 10 * k, 10 * k, 10 * k, size - 44 * k, 5 * k);
    ctx.fill();
    // 中部两条浅色纹路
    ctx.fillStyle = gray(212);
    ctx.fillRect(x0 + 28 * k, 90 * k, half - 60 * k, 4 * k);
    ctx.fillRect(x0 + 28 * k, 160 * k, half - 60 * k, 4 * k);
  }
  // 分块线：x = 0 与 x = 128
  ctx.fillStyle = gray(60);
  ctx.fillRect(0, 0, line, size);
  ctx.fillRect(size - line, 0, line, size);
  ctx.fillRect(half - line, 0, line * 2, size);
}

function wallCastle(ctx, size, rand) {
  const k = size / 256;
  const gap = 4 * k;
  ctx.fillStyle = gray(50);
  ctx.fillRect(0, 0, size, size);
  const heights = partition(256, 28, 48, rand);
  let y = 0;
  for (const h0 of heights) {
    const h = h0 * k;
    const widths = partition(256, 40, 90, rand);
    let x = Math.floor(rand() * 60) * k;
    for (const w0 of widths) {
      const w = w0 * k;
      const shade = between(rand, 110, 190);
      const chips = [];
      for (let s = 0; s < 3; s++) chips.push([rand(), rand(), between(rand, 2, 4) * k, rand() < 0.5 ? -22 : 18]);
      const draw = (xx) => {
        ctx.fillStyle = gray(shade);
        ctx.fillRect(xx + gap / 2, y + gap / 2, w - gap, h - gap);
        ctx.fillStyle = gray(shade + 20);
        ctx.fillRect(xx + gap / 2, y + gap / 2, w - gap, 3 * k);
        ctx.fillStyle = gray(shade - 30);
        ctx.fillRect(xx + gap / 2, y + h - gap / 2 - 3 * k, w - gap, 3 * k);
        for (const [cx, cy, cr, d] of chips) {
          ctx.fillStyle = gray(shade + d);
          circleAt(ctx, xx + gap + cx * (w - 2 * gap), y + gap + cy * (h - 2 * gap), cr);
        }
      };
      const xs = x % size;
      draw(xs);
      if (xs + w > size) draw(xs - size);
      x += w;
    }
    y += h;
  }
}

// ---------- 墙顶（纵向 32 px 周期） ----------
function stripes(size, draw) {
  const k = size / 256;
  const period = 32 * k;
  for (let y0 = 0; y0 < size; y0 += period) draw(y0, period, k);
}

function topGarden(ctx, size, rand) {
  ctx.fillStyle = '#163a14';
  ctx.fillRect(0, 0, size, size);
  const k = size / 256;
  const leaves = [];
  for (let i = 0; i < 70; i++) {
    leaves.push([rand() * size, rand() * 32 * k, between(rand, 5, 10) * k, between(rand, 2.5, 5) * k, rand() * Math.PI, pick(rand, LEAF_GREENS.slice(0, 4))]);
  }
  stripes(size, (y0) => {
    for (const [x, y, rx, ry, rot, color] of leaves) {
      ctx.fillStyle = color;
      wrapX(size, x, rx, (xx) => ellipseAt(ctx, xx, y0 + y, rx, ry, rot));
    }
  });
}

function topBrick(ctx, size, rand) {
  ctx.fillStyle = '#e8dcc0';
  ctx.fillRect(0, 0, size, size);
  const k = size / 256;
  const dots = [];
  for (let i = 0; i < 24; i++) dots.push([rand() * size, rand() * 32 * k, between(rand, 1, 2) * k]);
  stripes(size, (y0, period) => {
    ctx.fillStyle = '#f6eedb';
    ctx.fillRect(0, y0 + 2 * k, size, 4 * k);
    ctx.fillStyle = '#c9b996';
    ctx.fillRect(0, y0 + period - 5 * k, size, 3 * k);
    for (let x = 0; x < size; x += 64 * k) {
      ctx.fillStyle = '#a8977a';
      ctx.fillRect(x, y0, 3 * k, period);
    }
    ctx.fillStyle = '#d4c6a6';
    for (const [x, y, r] of dots) wrapX(size, x, r, (xx) => circleAt(ctx, xx, y0 + y, r));
  });
}

function topBlocks(ctx, size) {
  ctx.fillStyle = gray(225);
  ctx.fillRect(0, 0, size, size);
  stripes(size, (y0, period, k) => {
    for (let x = 32 * k; x < size; x += 64 * k) {
      const cy = y0 + period / 2;
      ctx.fillStyle = gray(150);
      circleAt(ctx, x + 2 * k, cy + 2 * k, 10 * k);
      ctx.fillStyle = gray(240);
      circleAt(ctx, x, cy, 10 * k);
      ctx.fillStyle = gray(255);
      circleAt(ctx, x - 3 * k, cy - 3 * k, 4 * k);
    }
  });
}

function topCastle(ctx, size, rand) {
  ctx.fillStyle = gray(90);
  ctx.fillRect(0, 0, size, size);
  const k = size / 256;
  const blocks = [];
  let x = 0;
  for (const w of partition(256, 40, 80, rand)) {
    blocks.push([x * k, w * k, between(rand, 80, 110)]);
    x += w;
  }
  stripes(size, (y0, period) => {
    for (const [bx, bw, shade] of blocks) {
      ctx.fillStyle = gray(shade);
      ctx.fillRect(bx + 2 * k, y0 + 2 * k, bw - 4 * k, period - 4 * k);
      ctx.fillStyle = gray(shade + 15);
      ctx.fillRect(bx + 2 * k, y0 + 2 * k, bw - 4 * k, 2 * k);
    }
    ctx.fillStyle = gray(55);
    ctx.fillRect(0, y0, size, 2 * k);
    ctx.fillRect(0, y0 + period - 2 * k, size, 2 * k);
    for (const [bx] of blocks) ctx.fillRect(bx, y0, 2 * k, period);
  });
}

// ---------- 地板（整张一个格子） ----------
function floorGarden(ctx, size, rand) {
  const k = size / 256;
  ctx.fillStyle = '#f6efe0';
  ctx.fillRect(0, 0, size, size);
  const fills = ['#fbf7ee', '#efe6d2', '#f3ecdc', '#fffdf6'];
  ctx.strokeStyle = '#cfc2a6';
  ctx.lineWidth = 1.5 * k;
  for (let i = 0; i < 26; i++) {
    const x = between(rand, 16, 240) * k;
    const y = between(rand, 16, 240) * k;
    const rx = between(rand, 7, 16) * k;
    const ry = rx * between(rand, 0.6, 1);
    const rot = rand() * Math.PI;
    ctx.fillStyle = pick(rand, fills);
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function floorBrick(ctx, size, rand) {
  const k = size / 256;
  const half = size / 2;
  ctx.fillStyle = '#cdbfae';
  ctx.fillRect(0, 0, size, size);
  for (const x of [0, half]) {
    for (const y of [0, half]) {
      ctx.fillStyle = pick(rand, ['#f5efe6', '#f1eadf', '#f8f3ec']);
      ctx.fillRect(x + 3 * k, y + 3 * k, half - 6 * k, half - 6 * k);
      ctx.fillStyle = '#fbf8f3';
      ctx.fillRect(x + 3 * k, y + 3 * k, half - 6 * k, 3 * k);
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = '#e6ddd0';
        circleAt(ctx, x + between(rand, 14, 114) * k, y + between(rand, 14, 114) * k, between(rand, 1, 2.5) * k);
      }
    }
  }
}

function floorBlocks(ctx, size) {
  const k = size / 256;
  ctx.fillStyle = gray(240);
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = gray(225);
  ctx.fillRect(0, 0, size, 2 * k);
  ctx.fillRect(0, 0, 2 * k, size);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const x = (32 + 64 * c) * k;
      const y = (32 + 64 * r) * k;
      ctx.fillStyle = gray(196);
      circleAt(ctx, x + 3 * k, y + 3 * k, 16 * k);
      ctx.fillStyle = gray(246);
      circleAt(ctx, x, y, 16 * k);
      ctx.fillStyle = gray(255);
      circleAt(ctx, x - 5 * k, y - 5 * k, 6 * k);
    }
  }
}

function floorCastle(ctx, size, rand) {
  const k = size / 256;
  ctx.fillStyle = gray(236);
  ctx.fillRect(0, 0, size, size);
  // 三条不规则石板缝把格子分成 4 块
  const j = () => between(rand, -14, 14) * k;
  const mx = size / 2 + j();
  const my = size / 2 + j();
  const shades = [242, 232, 238, 228];
  const quads = [
    [0, 0, mx, my],
    [mx, 0, size - mx, my],
    [0, my, mx, size - my],
    [mx, my, size - mx, size - my],
  ];
  quads.forEach(([x, y, w, h], i) => {
    ctx.fillStyle = gray(shades[i]);
    ctx.fillRect(x, y, w, h);
    for (let s = 0; s < 4; s++) {
      ctx.fillStyle = gray(shades[i] - 10);
      circleAt(ctx, x + between(rand, 0.15, 0.85) * w, y + between(rand, 0.15, 0.85) * h, between(rand, 2, 4) * k);
    }
  });
  ctx.strokeStyle = gray(185);
  ctx.lineWidth = 3 * k;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(mx + j(), 0);
  ctx.lineTo(mx + j() / 2, my * 0.5);
  ctx.lineTo(mx, my);
  ctx.lineTo(mx + j() / 2, my + (size - my) * 0.5);
  ctx.lineTo(mx + j(), size);
  ctx.moveTo(0, my + j());
  ctx.lineTo(mx * 0.5, my + j() / 2);
  ctx.lineTo(mx, my);
  ctx.lineTo(mx + (size - mx) * 0.5, my + j() / 2);
  ctx.lineTo(size, my + j());
  ctx.stroke();
  ctx.strokeRect(1.5 * k, 1.5 * k, size - 3 * k, size - 3 * k);
}

const WALL = { garden: wallGarden, brick: wallBrick, blocks: wallBlocks, castle: wallCastle };
const TOP = { garden: topGarden, brick: topBrick, blocks: topBlocks, castle: topCastle };
const FLOOR = { garden: floorGarden, brick: floorBrick, blocks: floorBlocks, castle: floorCastle };

export function paintWall(id, ctx, size) {
  id = parseTheme(id);
  WALL[id](ctx, size, rngFor(id, 'wall'));
}

export function paintWallTop(id, ctx, size) {
  id = parseTheme(id);
  TOP[id](ctx, size, rngFor(id, 'top'));
}

export function paintFloor(id, ctx, size) {
  id = parseTheme(id);
  FLOOR[id](ctx, size, rngFor(id, 'floor'));
}
