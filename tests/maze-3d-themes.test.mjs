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
  for (const fn of [paintWall, paintWallTop, paintFloor]) {
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
