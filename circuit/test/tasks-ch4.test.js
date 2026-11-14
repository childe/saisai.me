import test from 'node:test';
import assert from 'node:assert/strict';
import { TASKS, evaluateTask } from '../lib/tasks.js';
import { settle } from '../lib/engine.js';
import { createDamage } from '../lib/damage.js';
import { PHYS } from '../lib/parts.js';
import { withParams, ofType } from '../lib/task-kit.js';
import { build } from './helpers.js';

const T = id => TASKS.find(t => t.id === id);
const wsOf = (c, variant) => ({ ...settle(c, createDamage()), variant });
const run = (id, c, progress = T(id).initProgress(), variant) => evaluateTask(T(id), progress, wsOf(c, variant));

const bat = { battery: ['battery', { cells: 2 }] };

test('chapter 4 lists tasks 17..20 in order', () => {
  assert.deepEqual(TASKS.filter(t => t.chapter === 4).map(t => t.id), [17, 18, 19, 20]);
  assert.deepEqual(T(17).defaults, { battery: { cells: 2 } });
});

test('task 17: main lamp in series with two parallel lamps passes', () => {
  const c = build({ parts: { ...bat, L1: ['lamp'], L2: ['lamp'], L3: ['lamp'] },
    wires: [['battery.p', 'L1.a'], ['L1.b', 'L2.a'], ['L1.b', 'L3.a'], ['L2.b', 'battery.n'], ['L3.b', 'battery.n']] });
  assert.equal(run(17, c).passed, true);
});

test('task 17: three in series fails', () => {
  const c = build({ parts: { ...bat, L1: ['lamp'], L2: ['lamp'], L3: ['lamp'] },
    wires: [['battery.p', 'L1.a'], ['L1.b', 'L2.a'], ['L2.b', 'L3.a'], ['L3.b', 'battery.n']] });
  assert.equal(run(17, c).passed, false);
});

test('task 17: three in parallel fails', () => {
  const c = build({ parts: { ...bat, L1: ['lamp'], L2: ['lamp'], L3: ['lamp'] },
    wires: [['battery.p', 'L1.a'], ['battery.p', 'L2.a'], ['battery.p', 'L3.a'],
      ['L1.b', 'battery.n'], ['L2.b', 'battery.n'], ['L3.b', 'battery.n']] });
  assert.equal(run(17, c).passed, false);
});

test('task 17: one lamp left out fails', () => {
  const c = build({ parts: { ...bat, L1: ['lamp'], L2: ['lamp'], L3: ['lamp'] },
    wires: [['battery.p', 'L1.a'], ['L1.b', 'L2.a'], ['L2.b', 'battery.n']] });
  assert.equal(run(17, c).passed, false);
});

const closedWs = (t, v) => {
  const c = t.preset(v);
  return wsOf(withParams(c, { [ofType(c, 'switch')[0].id]: { closed: true } }), v);
};
const openWs = (t, v) => wsOf(t.preset(v), v);

test('task 18: predict flow with numbers', () => {
  const t = T(18);
  assert.deepEqual(t.variants, [2, 3, 4]);
  assert.equal(t.lockPreset, true);
  assert.equal(t.answer.kind, 'predict');
  assert.equal(t.answer.unit, 'A');
  assert.equal(t.answer.question(2), '电池 3 V，每盏灯 10 Ω。猜猜电流表读多少？');
  assert.equal(t.answer.question(4), '电池 6 V，每盏灯 10 Ω。猜猜电流表读多少？');
  for (const v of t.variants) {
    const base = t.preset(v);
    assert.equal(ofType(base, 'switch').length, 1);
    assert.equal(ofType(base, 'lamp').length, 3);
    assert.ok(base.parts.every(p => p.preset) && base.wires.every(w => w.preset));
  }
  const closed = closedWs(t, 2);
  assert.ok(Math.abs(t.target(closed) - 0.197) < 0.005, String(t.target(closed)));
  const sub = t.submit(t.initProgress(), 0.2, openWs(t, 2));
  assert.equal(sub.hint, '合上开关看看！');
  assert.equal(evaluateTask(t, sub.progress, openWs(t, 2)).hint, '合上开关看看！');
  assert.equal(evaluateTask(t, sub.progress, closed).passed, true);
  const bad = t.submit(t.initProgress(), 0.4, openWs(t, 2));
  const rb = evaluateTask(t, bad.progress, closed);
  assert.equal(rb.passed, false);
  assert.ok(rb.hint.startsWith('实际是'));
  assert.equal(t.submit(t.initProgress(), 0.2, closed), null);
});

test('task 18: series lamp is not burned with 4 cells', () => {
  const closed = closedWs(T(18), 4);
  const main = ofType(closed.circuit, 'lamp')[0];
  assert.ok(closed.result.parts[main.id].p < PHYS.LAMP_BURN_P);
});

test('predict peek: closing the switch before answering latches peeked', () => {
  const t = T(18);
  const base = t.preset(2);
  const sw = ofType(base, 'switch')[0].id;
  const r1 = evaluateTask(t, t.initProgress(), closedWs(t, 2));
  assert.equal(r1.progress.peeked, true);
  assert.equal(r1.hint, '你已经看过读数了，点「重来」再猜');
  const reopened = wsOf(withParams(base, { [sw]: { closed: false } }), 2);
  const r2 = evaluateTask(t, r1.progress, reopened);
  assert.equal(r2.hint, '你已经看过读数了，点「重来」再猜');
  assert.equal(t.submit(r2.progress, 0.2, reopened), null);
  assert.equal(t.initProgress().peeked, undefined);
});

test('predict peek: submitting first, then closing, is not a peek', () => {
  const t = T(18);
  const sub = t.submit(t.initProgress(), 0.2, openWs(t, 2));
  const r = evaluateTask(t, sub.progress, closedWs(t, 2));
  assert.equal(r.progress.peeked, undefined);
  assert.equal(r.passed, true);
});

// 19：灯 L1 串在主路，开关并在 L2 两端。
test('task 19: switch across one lamp passes', () => {
  const c = build({ parts: { ...bat, L1: ['lamp'], L2: ['lamp'], S: ['switch'] },
    wires: [['battery.p', 'L1.a'], ['L1.b', 'L2.a'], ['L2.b', 'battery.n'], ['S.a', 'L2.a'], ['S.b', 'L2.b']] });
  assert.equal(run(19, c).passed, true);
});

test('task 19: switch in the main path fails', () => {
  const c = build({ parts: { ...bat, L1: ['lamp'], L2: ['lamp'], S: ['switch'] },
    wires: [['battery.p', 'S.a'], ['S.b', 'L1.a'], ['L1.b', 'L2.a'], ['L2.b', 'battery.n']] });
  assert.equal(run(19, c).passed, false);
});

test('task 19: switch straight across the battery fails', () => {
  const c = build({ parts: { ...bat, L1: ['lamp'], L2: ['lamp'], S: ['switch'] },
    wires: [['battery.p', 'L1.a'], ['L1.b', 'L2.a'], ['L2.b', 'battery.n'], ['S.a', 'battery.p'], ['S.b', 'battery.n']] });
  assert.equal(run(19, c).passed, false);
});

// 20：变阻器只在 L1 支路。
test('task 20: rheostat in one branch dims only that lamp', () => {
  const c = build({ parts: { battery: ['battery', { cells: 1 }], L1: ['lamp'], L2: ['lamp'], R: ['rheostat', { pos: 0.5 }] },
    wires: [['battery.p', 'L1.a'], ['L1.b', 'R.a'], ['R.w', 'battery.n'], ['battery.p', 'L2.a'], ['L2.b', 'battery.n']] });
  assert.equal(run(20, c).passed, true);
});

test('task 20: rheostat in the main path fails', () => {
  const c = build({ parts: { battery: ['battery', { cells: 1 }], L1: ['lamp'], L2: ['lamp'], R: ['rheostat', { pos: 0.5 }] },
    wires: [['battery.p', 'R.a'], ['R.w', 'L1.a'], ['R.w', 'L2.a'], ['L1.b', 'battery.n'], ['L2.b', 'battery.n']] });
  assert.equal(run(20, c).passed, false);
});

test('task 20: rheostat with two lamps in series fails', () => {
  const c = build({ parts: { battery: ['battery', { cells: 1 }], L1: ['lamp'], L2: ['lamp'], R: ['rheostat', { pos: 0.5 }] },
    wires: [['battery.p', 'L1.a'], ['L1.b', 'L2.a'], ['L2.b', 'R.a'], ['R.w', 'battery.n']] });
  assert.equal(run(20, c).passed, false);
});
