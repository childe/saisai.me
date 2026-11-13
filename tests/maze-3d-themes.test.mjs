import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  THEME_IDS,
  DEFAULT_THEME,
  THEMES,
  parseTheme,
  blockColorIndex,
  wallShade,
  paintWall,
  paintWallTop,
  paintFloor,
  paintGround,
  mixHex,
} from '../maze-3d/themes.js';

const here = dirname(fileURLToPath(import.meta.url));

const ALLOWED_METHODS = new Set([
  'fillRect',
  'strokeRect',
  'clearRect',
  'beginPath',
  'closePath',
  'moveTo',
  'lineTo',
  'arc',
  'ellipse',
  'rect',
  'quadraticCurveTo',
  'fill',
  'stroke',
  'save',
  'restore',
  'translate',
  'rotate',
]);
const ALLOWED_PROPS = new Set([
  'fillStyle',
  'strokeStyle',
  'lineWidth',
  'globalAlpha',
  'lineCap',
  'lineJoin',
]);

// 记录所有方法调用与属性赋值的假 2D 上下文；遇到白名单外的方法或属性直接抛错
function fakeCtx() {
  const calls = [];
  const values = {};
  const ctx = new Proxy(
    {},
    {
      get(_, prop) {
        if (typeof prop !== 'string') return undefined;
        if (ALLOWED_PROPS.has(prop)) return values[prop];
        if (!ALLOWED_METHODS.has(prop)) throw new Error(`method not allowed: ${prop}`);
        return (...args) => {
          calls.push([prop, ...args]);
        };
      },
      set(_, prop, value) {
        if (!ALLOWED_PROPS.has(prop)) throw new Error(`property not allowed: ${String(prop)}`);
        values[prop] = value;
        calls.push(['set', prop, value]);
        return true;
      },
    },
  );
  return { ctx, calls };
}

test('theme ids', () => {
  assert.deepEqual(THEME_IDS, ['garden', 'brick', 'blocks', 'castle']);
  assert.equal(DEFAULT_THEME, 'garden');
  for (const id of THEME_IDS) assert.equal(parseTheme(id), id);
  for (const bad of [null, undefined, '', 'GARDEN', 'foo', 1, {}]) assert.equal(parseTheme(bad), 'garden');
});

test('theme data complete', () => {
  const isColor = (c) => Number.isInteger(c) && c >= 0 && c <= 0xffffff;
  const labels = { garden: '🌳 花园', brick: '🧱 砖墙', blocks: '🧸 积木', castle: '🏰 城堡' };
  assert.deepEqual(Object.keys(THEMES).sort(), [...THEME_IDS].sort());
  for (const id of THEME_IDS) {
    const t = THEMES[id];
    assert.equal(t.label, labels[id]);
    for (const c of [t.sky.top, t.sky.bottom, t.fogColor, t.hemi.sky, t.hemi.ground, t.sun.color, t.floorBase, t.wallTint]) {
      assert.ok(isColor(c), `${id} ${c}`);
    }
    assert.equal(t.fogColor, t.sky.bottom);
    assert.ok(t.hemi.intensity > 0 && t.sun.intensity > 0);
  }
  assert.equal(THEMES.blocks.blockPalette.length, 5);
  assert.ok(THEMES.blocks.blockPalette.every(isColor));
  for (const id of ['garden', 'brick', 'castle']) assert.equal(THEMES[id].blockPalette, undefined);
});

test('blockColorIndex deterministic and uniform', () => {
  const counts = [0, 0, 0, 0, 0];
  let sameAdjacent = 0;
  for (let i = 0; i < 1000; i++) {
    const k = blockColorIndex(i, 5);
    assert.equal(k, blockColorIndex(i, 5));
    assert.ok(Number.isInteger(k) && k >= 0 && k < 5);
    counts[k]++;
    if (i > 0 && k === blockColorIndex(i - 1, 5)) sameAdjacent++;
  }
  for (const c of counts) assert.ok(c >= 100 && c <= 300, `count ${c}`);
  assert.ok(sameAdjacent <= 350, `sameAdjacent ${sameAdjacent}`);
});

test('wallShade deterministic in range', () => {
  for (let i = 0; i < 1000; i++) {
    const s = wallShade(i);
    assert.equal(s, wallShade(i));
    assert.ok(s >= 0.92 && s <= 1.0);
  }
});

test('paint functions deterministic and draw', () => {
  for (const fn of [paintWall, paintWallTop, paintFloor, paintGround]) {
    for (const id of [...THEME_IDS, 'nope']) {
      const a = fakeCtx();
      fn(id, a.ctx, 256);
      const b = fakeCtx();
      fn(id, b.ctx, 256);
      assert.ok(a.calls.some(([n]) => n === 'fillRect'), `${fn.name} ${id}`);
      assert.ok(a.calls.length >= 20);
      assert.deepEqual(a.calls, b.calls);
    }
  }
  const g = fakeCtx();
  paintWall('garden', g.ctx, 256);
  const n = fakeCtx();
  paintWall('nope', n.ctx, 256);
  assert.deepEqual(n.calls, g.calls);
});

test('themes.js has no three/DOM dependency', () => {
  const src = readFileSync(join(here, '..', 'maze-3d', 'themes.js'), 'utf8');
  assert.doesNotMatch(src, /\bimport\b/);
  assert.doesNotMatch(src, /\b(document|window|THREE)\b/);
});

const rgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const dist = (a, b) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));
// p 到线段 ab（RGB 空间）的最短距离
function segDist(p, a, b) {
  const P = rgb(p);
  const A = rgb(a);
  const B = rgb(b);
  const ab = B.map((v, i) => v - A[i]);
  const ap = P.map((v, i) => v - A[i]);
  const len2 = ab.reduce((s, v) => s + v * v, 0);
  let t = len2 === 0 ? 0 : ab.reduce((s, v, i) => s + v * ap[i], 0) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(...P.map((v, i) => v - (A[i] + ab[i] * t)));
}

test('ground and fogFloor colors', () => {
  const isColor = (c) => Number.isInteger(c) && c >= 0 && c <= 0xffffff;
  for (const id of THEME_IDS) {
    const t = THEMES[id];
    assert.ok(isColor(t.ground) && isColor(t.fogFloor), id);
    for (const c of [t.floorBase, 0x4caf50, 0xe53935, 0xff6b6b]) {
      assert.ok(dist(t.fogFloor, c) >= 60, `${id} fogFloor vs ${c.toString(16)}: ${dist(t.fogFloor, c)}`);
    }
    // 地面主色与天空渐变线段、迷宫地板都要分得开（g1 天空占比检查依赖它）
    assert.ok(segDist(t.ground, t.sky.top, t.sky.bottom) >= 40, `${id} ground vs sky`);
    assert.ok(dist(t.ground, t.floorBase) >= 60, `${id} ground vs floor`);
  }
});

test('mixHex', () => {
  assert.equal(mixHex(0x000000, 0xffffff, 0.5), 0x808080);
  assert.equal(mixHex(0x123456, 0xabcdef, 0), 0x123456);
  assert.equal(mixHex(0x123456, 0xabcdef, 1), 0xabcdef);
  assert.equal(mixHex(0xff0000, 0x0000ff, 0.5), 0x800080);
});

test('paintGround deterministic and differs per theme', () => {
  const runs = {};
  for (const id of [...THEME_IDS, 'nope']) {
    const a = fakeCtx();
    paintGround(id, a.ctx, 256);
    const b = fakeCtx();
    paintGround(id, b.ctx, 256);
    assert.ok(a.calls.some(([n]) => n === 'fillRect'));
    assert.ok(a.calls.length >= 20);
    assert.deepEqual(a.calls, b.calls);
    runs[id] = JSON.stringify(a.calls);
  }
  assert.equal(runs.nope, runs.garden);
  assert.equal(new Set(THEME_IDS.map((id) => runs[id])).size, 4);
  // 第一笔铺底色就是主题 ground
  for (const id of THEME_IDS) {
    const hex = '#' + THEMES[id].ground.toString(16).padStart(6, '0');
    assert.ok(runs[id].includes(JSON.stringify(hex)), `${id} base fill`);
  }
});
