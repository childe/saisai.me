import test from 'node:test';
import assert from 'node:assert/strict';
import { TASKS, CHAPTERS, evaluateTask } from '../lib/tasks.js';
import { settle, tick } from '../lib/engine.js';
import { createDamage } from '../lib/damage.js';
import { setParam } from '../lib/circuit.js';
import { build } from './helpers.js';

const T40 = TASKS.find(t => t.id === 40);
const HINT = '现在是电池在点灯。断开开关看看，灯还亮吗？';

// 合上开关充 2 秒电，再按 open 决定是否断开。
const charged = (c, open = true) => {
  let ws = settle(c, createDamage());
  for (let k = 0; k < 40; k++) ws = tick(ws, 0.05);
  return open ? settle(setParam(ws.circuit, 'S', 'closed', false), ws.damage, ws.relays, ws.caps) : ws;
};
const run = ws => evaluateTask(T40, T40.initProgress(), ws);

const parts = { B: ['battery'], S: ['switch', { closed: true }], L: ['lamp'], C: ['capacitor', { farads: 1 }] };
const parallel = () => build({ parts, wires: [['B.p', 'S.a'], ['S.b', 'L.a'], ['L.b', 'B.n'], ['L.a', 'C.a'], ['L.b', 'C.b']] });

test('40 passes when the capacitor lights the lamp after the switch opens', () => {
  assert.equal(run(charged(parallel())).passed, true);
});

test('40 fails when the battery lights the lamp', () => {
  const r = run(charged(parallel(), false));
  assert.equal(r.passed, false);
  assert.equal(r.hint, HINT);
});

test('40 fails without a capacitor', () => {
  const { C, ...rest } = parts;
  const c = build({ parts: rest, wires: [['B.p', 'S.a'], ['S.b', 'L.a'], ['L.b', 'B.n']] });
  assert.equal(run(charged(c)).passed, false);
});

test('40 fails with the capacitor in series', () => {
  const c = build({ parts, wires: [['B.p', 'S.a'], ['S.b', 'L.a'], ['L.b', 'C.a'], ['C.b', 'B.n']] });
  assert.equal(run(charged(c)).passed, false);
});

test('chapter 8 is listed', () => {
  assert.ok(CHAPTERS.some(ch => ch.n === 8 && ch.name === '电容与定时'));
  assert.equal(T40.chapter, 8);
  assert.deepEqual(T40.palette, { battery: 1, switch: 1, lamp: 1, capacitor: 1 });
  assert.equal(T40.goal, '断开开关以后，让灯再亮一会儿');
});

// —— 第 41 关「延时关灯」——
const T41 = TASKS.find(t => t.id === 41);
const run41 = ws => evaluateTask(T41, T41.initProgress(), ws);
// 开关管线圈，电容并在线圈上；继电器常开触点点灯。lampDirect：灯直接接电池（作弊）。
const delayCircuit = ({ withCap = true, lampDirect = false } = {}) => build({
  parts: { B: ['battery'], S: ['switch', { closed: true }], K: ['relay'], L: ['lamp'], ...(withCap ? { C: ['capacitor', { farads: 0.1 }] } : {}) },
  wires: [['B.p', 'S.a'], ['S.b', 'K.x'], ['K.y', 'B.n'], ...(withCap ? [['S.b', 'C.a'], ['C.b', 'B.n']] : []),
    ['B.p', 'K.com'], lampDirect ? ['B.p', 'L.a'] : ['K.no', 'L.a'], ['L.b', 'B.n']],
});
const openAfter = (c, seconds, after = 0) => {
  let ws = settle(c, createDamage());
  for (let k = 0; k < seconds / 0.02; k++) ws = tick(ws, 0.02);
  ws = settle(setParam(ws.circuit, 'S', 'closed', false), ws.damage, ws.relays, ws.caps);
  for (let k = 0; k < after / 0.02; k++) ws = tick(ws, 0.02);
  return ws;
};

test('41 passes when relay holds the lamp after the switch opens', () => {
  assert.equal(run41(openAfter(delayCircuit(), 1)).passed, true);
});

test('41 hints while the switch is closed', () => {
  let ws = settle(delayCircuit(), createDamage());
  for (let k = 0; k < 50; k++) ws = tick(ws, 0.02);
  const r = run41(ws);
  assert.equal(r.passed, false);
  assert.equal(r.hint, '灯亮了。断开开关，看灯能不能晚一点再灭');
});

test('41 fails with the lamp wired to the battery', () => {
  assert.equal(run41(openAfter(delayCircuit({ lampDirect: true }), 1)).passed, false);
});

test('41 fails without the capacitor', () => {
  assert.equal(run41(openAfter(delayCircuit({ withCap: false }), 1, 0.2)).passed, false);
});
