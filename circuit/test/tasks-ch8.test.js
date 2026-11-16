import test from 'node:test';
import assert from 'node:assert/strict';
import { TASKS, CHAPTERS, evaluateTask } from '../lib/tasks.js';
import { settle, tick } from '../lib/engine.js';
import { createDamage } from '../lib/damage.js';
import { setParam } from '../lib/circuit.js';
import { build } from './helpers.js';

const T38 = TASKS.find(t => t.id === 38);
const HINT = '现在是电池在点灯。断开开关看看，灯还亮吗？';

// 合上开关充 2 秒电，再按 open 决定是否断开。
const charged = (c, open = true) => {
  let ws = settle(c, createDamage());
  for (let k = 0; k < 40; k++) ws = tick(ws, 0.05);
  return open ? settle(setParam(ws.circuit, 'S', 'closed', false), ws.damage, ws.relays, ws.caps) : ws;
};
const run = ws => evaluateTask(T38, T38.initProgress(), ws);

const parts = { B: ['battery'], S: ['switch', { closed: true }], L: ['lamp'], C: ['capacitor', { farads: 1 }] };
const parallel = () => build({ parts, wires: [['B.p', 'S.a'], ['S.b', 'L.a'], ['L.b', 'B.n'], ['L.a', 'C.a'], ['L.b', 'C.b']] });

test('38 passes when the capacitor lights the lamp after the switch opens', () => {
  assert.equal(run(charged(parallel())).passed, true);
});

test('38 fails when the battery lights the lamp', () => {
  const r = run(charged(parallel(), false));
  assert.equal(r.passed, false);
  assert.equal(r.hint, HINT);
});

test('38 fails without a capacitor', () => {
  const { C, ...rest } = parts;
  const c = build({ parts: rest, wires: [['B.p', 'S.a'], ['S.b', 'L.a'], ['L.b', 'B.n']] });
  assert.equal(run(charged(c)).passed, false);
});

test('38 fails with the capacitor in series', () => {
  const c = build({ parts, wires: [['B.p', 'S.a'], ['S.b', 'L.a'], ['L.b', 'C.a'], ['C.b', 'B.n']] });
  assert.equal(run(charged(c)).passed, false);
});

test('chapter 8 is listed', () => {
  assert.ok(CHAPTERS.some(ch => ch.n === 8 && ch.name === '电容与定时'));
  assert.equal(T38.chapter, 8);
  assert.deepEqual(T38.palette, { battery: 1, switch: 1, lamp: 1, capacitor: 1 });
  assert.equal(T38.goal, '断开开关以后，让灯再亮一会儿');
});
