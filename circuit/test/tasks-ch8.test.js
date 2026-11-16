import test from 'node:test';
import assert from 'node:assert/strict';
import { TASKS, CHAPTERS, evaluateTask } from '../lib/tasks.js';
import { settle, tick } from '../lib/engine.js';
import { createDamage } from '../lib/damage.js';
import { setParam, addPart, addWire } from '../lib/circuit.js';
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

// —— 第 42 关「自己闪的灯」——
const T42 = TASKS.find(t => t.id === 42);
// 每帧 tick 并推进 progress，seconds 秒内过关返回 true。
const playFor = (task, c, seconds) => {
  let ws = settle(c, createDamage());
  let progress = task.initProgress();
  for (let k = 0; k < seconds / 0.02; k++) {
    ws = tick(ws, 0.02);
    const r = evaluateTask(task, progress, ws);
    if (r.passed) return true;
    progress = r.progress;
  }
  return false;
};
// 电池 → com，nc → 电阻 → 电容∥线圈；灯接在 lampOn 触点上。
const blinker = ({ withCap = true, lampOn = 'nc' } = {}) => build({
  parts: { B: ['battery'], K: ['relay'], R: ['resistor', { ohms: 10 }], L: ['lamp'], ...(withCap ? { C: ['capacitor', { farads: 0.5 }] } : {}) },
  wires: [['B.p', 'K.com'], ['K.nc', 'R.a'], ['R.b', 'K.x'], ['K.y', 'B.n'], ...(withCap ? [['R.b', 'C.a'], ['C.b', 'B.n']] : []),
    [`K.${lampOn}`, 'L.a'], ['L.b', 'B.n']],
});

test('42 passes after the lamp blinks on its own', () => {
  assert.equal(playFor(T42, blinker(), 20), true);
});

test('42 passes with lamp on no', () => {
  assert.equal(playFor(T42, blinker({ lampOn: 'no' }), 40), true);
});

test('42 fails when the relay buzzes without a capacitor', () => {
  assert.equal(playFor(T42, blinker({ withCap: false }), 40), false);
});

test('42 progress starts empty', () => {
  const a = T42.initProgress(), b = T42.initProgress();
  assert.deepEqual(a, { state: null, v: {}, count: 0 });
  assert.notEqual(a, b);
});

// —— 第 43 关「自动红绿灯」——
const T43 = TASKS.find(t => t.id === 43);
// 在预置闪光电路上，常闭接 ncColor 的 LED、常开接 noColor 的 LED，各串 100Ω。
const withLeds = (ncColor, noColor) => {
  let c = T43.preset();
  const id = type => c.parts.find(p => p.type === type).id;
  const K = id('relay'), B = id('battery');
  const add = (type, x, y, params) => { const r = addPart(c, type, x, y, params); c = r.circuit; return r.id; };
  const wire = (a, b) => { c = addWire(c, a, b).circuit; };
  for (const [contact, color, y] of [['nc', ncColor, 30], ['no', noColor, 40]]) {
    const R = add('resistor', 50, y, { ohms: 100 }), D = add('led', 60, y, { color });
    wire({ part: K, term: contact }, { part: R, term: 'a' });
    wire({ part: R, term: 'b' }, { part: D, term: 'a' });
    wire({ part: D, term: 'k' }, { part: B, term: 'n' });
  }
  return c;
};

test('43 preset is locked flasher', () => {
  const c = T43.preset();
  const of = type => c.parts.filter(p => p.type === type);
  assert.equal(T43.lockPreset, true);
  assert.deepEqual(T43.palette, { led: 2, resistor: 2 });
  assert.equal(of('battery')[0].params.cells, 2);
  assert.equal(of('resistor')[0].params.ohms, 47);
  assert.equal(of('capacitor')[0].params.farads, 0.5);
  assert.equal(of('relay').length, 1);
  assert.ok(c.parts.every(p => p.preset) && c.wires.every(w => w.preset));
});

test('43 passes with red on nc and green on no', () => {
  assert.equal(playFor(T43, withLeds('red', 'green'), 60), true);
});

test('43 passes with colors swapped', () => {
  assert.equal(playFor(T43, withLeds('green', 'red'), 60), true);
});

test('43 fails with two red LEDs', () => {
  assert.equal(playFor(T43, withLeds('red', 'red'), 60), false);
});
