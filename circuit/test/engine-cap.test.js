import test from 'node:test';
import assert from 'node:assert/strict';
import { createDamage } from '../lib/damage.js';
import { settle, tick } from '../lib/engine.js';
import { capsAtRest } from '../lib/caps.js';
import { setParam, movePart, removePart, removeWire } from '../lib/circuit.js';
import { createEditor, reduce } from '../lib/editor.js';
import { PHYS } from '../lib/parts.js';
import { build, loop } from './helpers.js';

const run = (ws, dt, n) => {
  for (let k = 0; k < n; k++) ws = tick(ws, dt);
  return ws;
};

const rc = (ohms, farads) => loop(
  { B: ['battery'], R: ['resistor', { ohms }], C: ['capacitor', { farads }] },
  ['B.p', 'R.a', 'R.b', 'C.a', 'C.b', 'B.n'],
);

// 电池 → 开关 → 灯 → 电池，电容并在灯两端
const keepLit = (closed = true) => build({
  parts: { B: ['battery'], S: ['switch', { closed }], L: ['lamp'], C: ['capacitor', { farads: 1 }] },
  wires: [['B.p', 'S.a'], ['S.b', 'L.a'], ['L.b', 'B.n'], ['L.a', 'C.a'], ['L.b', 'C.b']],
});

const lit = ws => ws.result.parts.L.p >= PHYS.LAMP_LIT_P;

test('capacitor charges to about 63% after one RC', () => {
  const ws = run(settle(rc(10, 1), createDamage()), 0.05, 200);
  const frac = ws.caps.v.C / 1.5;
  assert.ok(frac > 0.6 && frac < 0.66, `${frac}`);
});

test('slow charge still advances at 120 Hz', () => {
  const ws = run(settle(rc(1000, 1), createDamage()), 1 / 120, 120);
  assert.ok(ws.caps.v.C > 0.001, `${ws.caps.v.C}`);
});

test('tick returns the same object once at rest', () => {
  let ws = settle(rc(10, 0.1), createDamage());
  for (let k = 0; k < 400 && !capsAtRest(ws.circuit, ws.result); k++) ws = tick(ws, 0.05);
  assert.equal(capsAtRest(ws.circuit, ws.result), true);
  assert.equal(tick(ws, 0.05), ws);
});

test('lamp keeps glowing after the switch opens', () => {
  let ws = run(settle(keepLit(), createDamage()), 0.05, 40);
  ws = settle(setParam(ws.circuit, 'S', 'closed', false), ws.damage, ws.relays, ws.caps);
  assert.equal(lit(ws), true);
  ws = run(ws, 0.05, 80);
  assert.equal(lit(ws), true);
  ws = run(ws, 0.05, 200);
  assert.equal(lit(ws), false);
});

test('moving a charged capacitor keeps its voltage', () => {
  const ws = run(settle(rc(10, 0.1), createDamage()), 0.05, 40);
  const v = ws.caps.v.C;
  const moved = settle(movePart(ws.circuit, 'C', 30, 20), ws.damage, ws.relays, ws.caps);
  assert.equal(moved.caps.v.C, v);
});

test('isolated charged capacitor keeps voltage and rests', () => {
  let ws = run(settle(rc(10, 0.1), createDamage()), 0.05, 10);
  const v = ws.caps.v.C;
  assert.ok(v > 0.5);
  const c = removeWire(removeWire(ws.circuit, 'w2'), 'w3');
  ws = settle(c, ws.damage, ws.relays, ws.caps);
  assert.equal(ws.caps.v.C, v);
  assert.equal(tick(ws, 0.05), ws);
});

test('removing the capacitor prunes its charge', () => {
  let ws = run(settle(rc(10, 0.1), createDamage()), 0.05, 10);
  ws = settle(removePart(ws.circuit, 'C'), ws.damage, ws.relays, ws.caps);
  assert.equal('C' in ws.caps.v, false);
});

test('inrush blows a fuse in series with a capacitor', () => {
  const c = loop({ B: ['battery'], F: ['fuse', { rating: 0.5 }], C: ['capacitor'] }, ['B.p', 'F.a', 'F.b', 'C.a', 'C.b', 'B.n']);
  assert.equal(settle(c, createDamage()).damage.broken.F, true);
});

test('inrush burns an LED in series with a capacitor', () => {
  const c = loop({ B: ['battery', { cells: 2 }], D: ['led'], C: ['capacitor'] }, ['B.p', 'D.a', 'D.k', 'C.a', 'C.b', 'B.n']);
  assert.equal(settle(c, createDamage()).damage.broken.D, true);
});

test('relay flasher with capacitor keeps flipping', () => {
  const c = build({
    parts: { B: ['battery', { cells: 2 }], K: ['relay'], R: ['resistor', { ohms: 47 }], C: ['capacitor', { farads: 0.1 }] },
    wires: [['B.p', 'K.com'], ['K.nc', 'R.a'], ['R.b', 'C.a'], ['R.b', 'K.x'], ['C.b', 'B.n'], ['K.y', 'B.n']],
  });
  let ws = settle(c, createDamage());
  for (let k = 0; k < 500; k++) {
    ws = tick(ws, 0.02);
    assert.equal(ws.result.ok, true);
  }
  assert.ok(ws.relays.flips >= 4, `flips ${ws.relays.flips}`);
});

test('clear resets capacitor charge', () => {
  const e = createEditor();
  let s = { ...e, free: { ...e.free, ...settle(rc(10, 0.1), createDamage()), history: [] } };
  for (let k = 0; k < 10; k++) s = reduce(s, { type: 'tick', dt: 0.05 });
  assert.ok(s.free.caps.v.C > 0.5);
  s = reduce(reduce(s, { type: 'askClear' }), { type: 'confirmClear' });
  assert.deepEqual(s.free.caps.v, {});
});

test('charge survives other edits in the editor', () => {
  const e = createEditor();
  let s = { ...e, free: { ...e.free, ...settle(rc(10, 0.1), createDamage()), history: [] } };
  for (let k = 0; k < 10; k++) s = reduce(s, { type: 'tick', dt: 0.05 });
  const v = s.free.caps.v.C;
  s = reduce(s, { type: 'place', partType: 'lamp', x: 40, y: 30 });
  assert.equal(s.free.caps.v.C, v);
});
