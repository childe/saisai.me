import test from 'node:test';
import assert from 'node:assert/strict';
import { TASKS, CHAPTERS, evaluateTask } from '../lib/tasks.js';
import { settle, tick } from '../lib/engine.js';
import { createDamage } from '../lib/damage.js';
import { setParam, addPart, addWire, removeWire } from '../lib/circuit.js';
import { PARTS } from '../lib/parts.js';
import { terminalPoint, wirePoints, rotatePoint } from '../lib/geometry.js';
import { build } from './helpers.js';

const T43 = TASKS.find(t => t.id === 43);
const HINT = '现在是电池在点灯。断开开关看看，灯还亮吗？';

// 合上开关充 2 秒电，再按 open 决定是否断开。
const charged = (c, open = true) => {
  let ws = settle(c, createDamage());
  for (let k = 0; k < 40; k++) ws = tick(ws, 0.05);
  return open ? settle(setParam(ws.circuit, 'S', 'closed', false), ws.damage, ws.relays, ws.caps) : ws;
};
const run = ws => evaluateTask(T43, T43.initProgress(), ws);

const parts = { B: ['battery'], S: ['switch', { closed: true }], L: ['lamp'], C: ['capacitor', { farads: 1 }] };
const parallel = () => build({ parts, wires: [['B.p', 'S.a'], ['S.b', 'L.a'], ['L.b', 'B.n'], ['L.a', 'C.a'], ['L.b', 'C.b']] });

test('43 passes when the capacitor lights the lamp after the switch opens', () => {
  assert.equal(run(charged(parallel())).passed, true);
});

test('43 fails when the battery lights the lamp', () => {
  const r = run(charged(parallel(), false));
  assert.equal(r.passed, false);
  assert.equal(r.hint, HINT);
});

test('43 fails without a capacitor', () => {
  const { C, ...rest } = parts;
  const c = build({ parts: rest, wires: [['B.p', 'S.a'], ['S.b', 'L.a'], ['L.b', 'B.n']] });
  assert.equal(run(charged(c)).passed, false);
});

test('43 fails with the capacitor in series', () => {
  const c = build({ parts, wires: [['B.p', 'S.a'], ['S.b', 'L.a'], ['L.b', 'C.a'], ['C.b', 'B.n']] });
  assert.equal(run(charged(c)).passed, false);
});

test('chapter 7 is listed', () => {
  assert.ok(CHAPTERS.some(ch => ch.n === 7 && ch.name === '电容与定时'));
  assert.equal(T43.chapter, 7);
  assert.deepEqual(T43.palette, { battery: 1, switch: 1, lamp: 1, capacitor: 1 });
  assert.equal(T43.goal, '断开开关以后，让灯再亮一会儿');
});

// —— 第 44 关「延时关灯」——
const T44 = TASKS.find(t => t.id === 44);
const run41 = ws => evaluateTask(T44, T44.initProgress(), ws);
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

test('44 passes when relay holds the lamp after the switch opens', () => {
  assert.equal(run41(openAfter(delayCircuit(), 1)).passed, true);
});

test('44 hints while the switch is closed', () => {
  let ws = settle(delayCircuit(), createDamage());
  for (let k = 0; k < 50; k++) ws = tick(ws, 0.02);
  const r = run41(ws);
  assert.equal(r.passed, false);
  assert.equal(r.hint, '灯亮了。断开开关，看灯能不能晚一点再灭');
});

test('44 fails with the lamp wired to the battery', () => {
  assert.equal(run41(openAfter(delayCircuit({ lampDirect: true }), 1)).passed, false);
});

test('44 fails without the capacitor', () => {
  assert.equal(run41(openAfter(delayCircuit({ withCap: false }), 1, 0.2)).passed, false);
});

// —— 第 45 关「自己闪的灯」——
const T45 = TASKS.find(t => t.id === 45);
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

test('45 passes after the lamp blinks on its own', () => {
  assert.equal(playFor(T45, blinker(), 20), true);
});

test('45 passes with lamp on no', () => {
  assert.equal(playFor(T45, blinker({ lampOn: 'no' }), 40), true);
});

test('45 fails when the relay buzzes without a capacitor', () => {
  assert.equal(playFor(T45, blinker({ withCap: false }), 40), false);
});

test('45 progress starts empty', () => {
  const a = T45.initProgress(), b = T45.initProgress();
  assert.deepEqual(a, { state: null, v: {}, count: 0, flips: 0, dir: 0 });
  assert.notEqual(a, b);
});

// —— 第 46 关「自动红绿灯」——
const T46 = TASKS.find(t => t.id === 46);
// 在预置闪光电路上，常闭接 ncColor 的 LED、常开接 noColor 的 LED，各串 100Ω。
const withLeds = (ncColor, noColor) => {
  let c = T46.preset();
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

test('46 preset is locked flasher', () => {
  const c = T46.preset();
  const of = type => c.parts.filter(p => p.type === type);
  assert.equal(T46.lockPreset, true);
  assert.deepEqual(T46.palette, { led: 2, resistor: 2 });
  assert.equal(of('battery')[0].params.cells, 2);
  assert.equal(of('resistor')[0].params.ohms, 47);
  assert.equal(of('capacitor')[0].params.farads, 0.5);
  assert.equal(of('relay').length, 1);
  assert.ok(c.parts.every(p => p.preset) && c.wires.every(w => w.preset));
});

test('46 passes with red on nc and green on no', () => {
  assert.equal(playFor(T46, withLeds('red', 'green'), 60), true);
});

test('46 passes with colors swapped', () => {
  assert.equal(playFor(T46, withLeds('green', 'red'), 60), true);
});

test('46 fails with two red LEDs', () => {
  assert.equal(playFor(T46, withLeds('red', 'red'), 60), false);
});

// —— 评审后补的用例 ——

test('44 fails the instant the switch opens without a capacitor', () => {
  assert.equal(run41(openAfter(delayCircuit({ withCap: false }), 1, 0)).passed, false);
});

test('44 fails with a self-latching relay', () => {
  const c = delayCircuit({ withCap: false });
  c.wires.push({ id: 'latch', a: { part: 'K', term: 'no' }, b: { part: 'K', term: 'x' } });
  assert.equal(run41(openAfter(c, 1, 0.5)).passed, false);
});

test('45 fails with a buzzing relay next to a separately charging capacitor', () => {
  const c = build({
    parts: { B: ['battery'], K: ['relay'], L: ['lamp'], R: ['resistor', { ohms: 47 }], C: ['capacitor', { farads: 0.5 }] },
    wires: [['B.p', 'K.com'], ['K.nc', 'K.x'], ['K.y', 'B.n'], ['K.nc', 'L.a'], ['L.b', 'B.n'], ['B.p', 'R.a'], ['R.b', 'C.a'], ['C.b', 'B.n']],
  });
  assert.equal(playFor(T45, c, 40), false);
});

test('45 fails when the lamp wire is pulled and replaced by hand', () => {
  const c = build({
    parts: { B: ['battery'], R: ['resistor', { ohms: 220 }], C: ['capacitor', { farads: 0.5 }], L: ['lamp'] },
    wires: [['B.p', 'R.a'], ['R.b', 'C.a'], ['C.b', 'B.n'], ['B.p', 'L.a'], ['L.b', 'B.n']],
  });
  let ws = settle(c, createDamage());
  let progress = T45.initProgress();
  let passed = false;
  for (let k = 0; k < 60 / 0.02 && !passed; k++) {
    if (k % 200 === 100) {
      const lw = ws.circuit.wires.find(w => w.a.part === 'L' && w.a.term === 'b');
      ws = settle(removeWire(ws.circuit, lw.id), ws.damage, ws.relays, ws.caps);
    } else if (k % 200 === 0 && k > 0) {
      ws = settle(addWire(ws.circuit, { part: 'L', term: 'b' }, { part: 'B', term: 'n' }).circuit, ws.damage, ws.relays, ws.caps);
    }
    ws = tick(ws, 0.02);
    const r = evaluateTask(T45, progress, ws);
    passed = r.passed;
    progress = r.progress;
  }
  assert.equal(passed, false);
});

test('45 defaults the resistor to 10 ohms', () => {
  assert.deepEqual(T45.defaults, { resistor: { ohms: 10 } });
});

test('46 hints when no LED is green', () => {
  let ws = settle(withLeds('red', 'red'), createDamage());
  for (let k = 0; k < 10; k++) ws = tick(ws, 0.02);
  assert.equal(evaluateTask(T46, T46.initProgress(), ws).hint, '把一个 LED 的颜色改成绿色');
});

// 预置导线不压在任何元件本体和引线上，也不经过别的端点。
const zoneOf = p => {
  const h = p.type === 'relay' ? 1.35 : 0.7;
  const [a, b] = [rotatePoint([-1.9, -h], p.rot), rotatePoint([1.9, h], p.rot)];
  return { x0: p.x + Math.min(a[0], b[0]), x1: p.x + Math.max(a[0], b[0]), y0: p.y + Math.min(a[1], b[1]), y1: p.y + Math.max(a[1], b[1]) };
};
const hitsZone = ([x1, y1], [x2, y2], z) =>
  Math.max(x1, x2) > z.x0 && Math.min(x1, x2) < z.x1 && Math.max(y1, y2) > z.y0 && Math.min(y1, y2) < z.y1;
const onSeg = ([x, y], [x1, y1], [x2, y2]) =>
  (x1 === x2 && x === x1 && y >= Math.min(y1, y2) && y <= Math.max(y1, y2)) || (y1 === y2 && y === y1 && x >= Math.min(x1, x2) && x <= Math.max(x1, x2));

test('46 preset wires stay clear of parts and other terminals', () => {
  const c = T46.preset();
  for (const w of c.wires) {
    const pts = wirePoints(c, w);
    const ends = [terminalPoint(c.parts.find(p => p.id === w.a.part), w.a.term), terminalPoint(c.parts.find(p => p.id === w.b.part), w.b.term)];
    for (let i = 1; i < pts.length; i++) {
      for (const p of c.parts) {
        assert.ok(!hitsZone(pts[i - 1], pts[i], zoneOf(p)), `${w.a.part}.${w.a.term}-${w.b.part}.${w.b.term} 压在 ${p.type} 上`);
        for (const t of PARTS[p.type].terms) {
          const tp = terminalPoint(p, t);
          if (ends.some(e => e[0] === tp[0] && e[1] === tp[1])) continue;
          assert.ok(!onSeg(tp, pts[i - 1], pts[i]), `${w.a.part}.${w.a.term}-${w.b.part}.${w.b.term} 经过 ${p.type}.${t}`);
        }
      }
    }
  }
});

// —— 第 47 关「能调亮度的闪光灯」——
const T47 = TASKS.find(t => t.id === 47);
// 电池 → com，nc → 线圈（像电铃一样自己跳）；no → 变阻器 a–w → 灯。lampOn 换灯接的触点，fixed 把变阻器接成 a–b 定值。
const dimBlinker = ({ lampOn = 'no', fixed = false, cells = 1 } = {}) => build({
  parts: { B: ['battery', { cells }], K: ['relay'], V: ['rheostat', { pos: 0 }], L: ['lamp'] },
  wires: [['B.p', 'K.com'], ['K.nc', 'K.x'], ['K.y', 'B.n'], [`K.${lampOn}`, 'V.a'], [fixed ? 'V.b' : 'V.w', 'L.a'], ['L.b', 'B.n']],
});
// 闪 seconds 秒，每 slideEvery 秒把变阻器在 0 和 0.15 之间换一下；每帧推进 progress。
const blinkAndSlide = (c, seconds, { slideEvery = 0, change = null } = {}) => {
  let ws = settle(c, createDamage());
  let progress = T47.initProgress();
  let r = null;
  const per = Math.round(slideEvery / 0.02);
  for (let k = 1; k <= seconds / 0.02; k++) {
    if (per && k % per === 0) ws = settle(setParam(ws.circuit, 'V', 'pos', (k / per) % 2 ? 0.15 : 0), ws.damage, ws.relays, ws.caps);
    if (change && k === change.at) ws = settle(change.apply(ws.circuit), ws.damage, ws.relays, ws.caps);
    ws = tick(ws, 0.02);
    r = evaluateTask(T47, progress, ws);
    if (r.passed) return r;
    progress = r.progress;
  }
  return r;
};

test('47 lists its parts and goal', () => {
  assert.equal(T47.chapter, 7);
  assert.equal(T47.name, '能调亮度的闪光灯');
  assert.deepEqual(T47.palette, { battery: 1, relay: 1, rheostat: 1, lamp: 1 });
});

test('47 passes when the lamp blinks and the slider changes its brightness', () => {
  assert.equal(blinkAndSlide(dimBlinker(), 6, { slideEvery: 1 }).passed, true);
});

test('47 passes with the lamp on nc', () => {
  assert.equal(blinkAndSlide(dimBlinker({ lampOn: 'nc' }), 6, { slideEvery: 1 }).passed, true);
});

test('47 hints to slide when the lamp blinks at one brightness', () => {
  const r = blinkAndSlide(dimBlinker(), 6);
  assert.equal(r.passed, false);
  assert.equal(r.hint, '灯在闪了。拖动滑动变阻器的滑片，让灯变亮、变暗');
});

test('47 fails when the rheostat is wired as a fixed resistor', () => {
  const r = blinkAndSlide(dimBlinker({ fixed: true, cells: 4 }), 6, { slideEvery: 1 });
  assert.equal(r.passed, false);
  assert.equal(r.hint, '灯在闪了。拖动滑动变阻器的滑片，让灯变亮、变暗');
});

test('47 fails when only the battery cells change the brightness', () => {
  const change = { at: 100, apply: circuit => setParam(circuit, 'B', 'cells', 2) };
  assert.equal(blinkAndSlide(dimBlinker(), 6, { change }).passed, false);
});

test('47 fails when the lamp does not blink', () => {
  // 灯经变阻器直接接电池，继电器另外自己跳
  const c = build({
    parts: { B: ['battery'], K: ['relay'], V: ['rheostat', { pos: 0 }], L: ['lamp'] },
    wires: [['B.p', 'K.com'], ['K.nc', 'K.x'], ['K.y', 'B.n'], ['B.p', 'V.a'], ['V.w', 'L.a'], ['L.b', 'B.n']],
  });
  assert.equal(blinkAndSlide(c, 6, { slideEvery: 1 }).passed, false);
});

test('47 fails when a wire across the rheostat makes the lamp brighter', () => {
  const c = dimBlinker();
  c.parts.find(p => p.id === 'V').params.pos = 0.15;
  const change = { at: 100, apply: circuit => addWire(circuit, { part: 'V', term: 'a' }, { part: 'V', term: 'w' }).circuit };
  const r = blinkAndSlide(c, 6, { change });
  assert.equal(r.passed, false);
  assert.equal(r.hint, '灯在闪了。拖动滑动变阻器的滑片，让灯变亮、变暗');
});
