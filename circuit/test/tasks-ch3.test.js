import test from 'node:test';
import assert from 'node:assert/strict';
import { TASKS, evaluateTask } from '../lib/tasks.js';
import { settle } from '../lib/engine.js';
import { createDamage } from '../lib/damage.js';
import { setParam } from '../lib/circuit.js';
import { PHYS } from '../lib/parts.js';
import { withinTolerance, withParams, ofType, presetCircuit } from '../lib/task-kit.js';
import { build } from './helpers.js';

const T = id => TASKS.find(t => t.id === id);
const wsOf = (c, variant) => ({ ...settle(c, createDamage()), variant });
const run = (id, c, progress = T(id).initProgress(), variant) => evaluateTask(T(id), progress, wsOf(c, variant));

test('withinTolerance: 10% of actual, at least 0.01', () => {
  assert.equal(withinTolerance(0.15, 0.148), true);
  assert.equal(withinTolerance(0.2, 0.148), false);
  assert.equal(withinTolerance(0.01, 0.0), true);
  assert.equal(withinTolerance(0.03, 0.0), false);
});

test('presetCircuit throws naming the endpoints when a wire is rejected', () => {
  const parts = [['B', 'battery', 9, 12], ['L', 'lamp', 9, 5]];
  assert.throws(() => presetCircuit(parts, [['B.p', 'L.zz']]), /B\.p.*L\.zz/);
  assert.throws(() => presetCircuit(parts, [['B.p', 'X.a']]), /B\.p.*X\.a/);
  assert.throws(() => presetCircuit(parts, [['B.p', 'L.a'], ['L.a', 'B.p']]), /L\.a.*B\.p/);
});

// 每道预测题：开关断开时能提交，合上后判定；错答案带「实际是」提示。
function predictCases(id, variants, expected) {
  test(`task ${id}: predict flow for every variant`, () => {
    const task = T(id);
    assert.deepEqual(task.variants, variants);
    assert.equal(task.lockPreset, true);
    assert.equal(task.answer.kind, 'predict');
    variants.forEach((v, k) => {
      const base = task.preset(v);
      const sw = ofType(base, 'switch');
      assert.equal(sw.length, 1);
      assert.ok(base.parts.every(p => p.preset) && base.wires.every(w => w.preset));
      const open = wsOf(withParams(base, { [sw[0].id]: { closed: false } }), v);
      const closed = wsOf(withParams(base, { [sw[0].id]: { closed: true } }), v);
      const actual = task.target(closed);
      if (expected[k] != null) assert.ok(Math.abs(actual - expected[k]) < 0.005, `${id}/${k}: ${actual}`);
      assert.match(task.answer.question(v), /猜/);

      const sub = task.submit(task.initProgress(), actual, open);
      assert.notEqual(sub, null);
      assert.equal(sub.hint, '合上开关看看！');
      assert.equal(task.submit(sub.progress, actual, open), null);
      assert.equal(task.submit(task.initProgress(), actual, closed), null);

      assert.equal(evaluateTask(task, task.initProgress(), closed).passed, false);
      assert.equal(evaluateTask(task, sub.progress, open).hint, '合上开关看看！');
      assert.equal(evaluateTask(task, sub.progress, open).passed, false);
      assert.equal(evaluateTask(task, sub.progress, closed).passed, true);

      const bad = task.submit(task.initProgress(), actual * 1.3, open);
      const rb = evaluateTask(task, bad.progress, closed);
      assert.equal(rb.passed, false);
      assert.ok(rb.hint.startsWith('实际是'), rb.hint);
      assert.equal(rb.progress.wrong, true);
      assert.equal(evaluateTask(task, rb.progress, closed).passed, false);
    });
  });
}

predictCases(12, [2, 3, 4], [null, null, null]);
predictCases(13, [2, 3, 4], [null, null, null]);
predictCases(14, [{ cells: 1, n: 2 }, { cells: 2, n: 2 }, { cells: 1, n: 3 }, { cells: 2, n: 3 }], [null, 0.577, null, null]);

test('task 12/13 numbers', () => {
  const closed = (t, v) => {
    const c = t.preset(v);
    return wsOf(withParams(c, { [ofType(c, 'switch')[0].id]: { closed: true } }), v);
  };
  assert.ok(Math.abs(T(12).target(closed(T(12), 2)) - 0.148) < 0.005);
  assert.ok(Math.abs(T(13).target(closed(T(13), 2)) - 1.49) < 0.02);
});

test('predict questions quote the computed reading', () => {
  assert.equal(T(12).answer.question(2), '合上开关后 A1 读 0.15 A。猜猜 A2 读多少？');
  assert.equal(T(13).answer.question(3), '电池是 4.5 V，两盏一样的灯串联。猜猜电压表读多少？');
  assert.match(T(14).answer.question({ cells: 2, n: 3 }), /^A1 读 0\.\d\d A，3 盏一样的灯并联。猜猜 A2 读多少？$/);
  assert.equal(T(12).answer.unit, 'A');
  assert.equal(T(13).answer.unit, 'V');
});

test('task 14: no lamp is overloaded in any variant', () => {
  for (const v of T(14).variants) {
    const c = T(14).preset(v);
    const sw = ofType(c, 'switch')[0].id;
    const ws = settle(withParams(c, { [sw]: { closed: true } }), createDamage());
    const lamps = ofType(c, 'lamp');
    assert.equal(lamps.length, v.n);
    for (const l of lamps) assert.ok(ws.result.parts[l.id].p < PHYS.LAMP_BURN_P);
  }
});

const lampRheo = pos => build({ parts: { B: ['battery', { cells: 1 }], L: ['lamp'], R: ['rheostat', { pos }], A: ['ammeter'] },
  wires: [['B.p', 'L.a'], ['L.b', 'R.a'], ['R.w', 'A.p'], ['A.n', 'B.n']] });

test('task 15: current 0.1 A with lit lamp passes, 0.5 pos fails', () => {
  assert.deepEqual(T(15).locked, { battery: ['cells'] });
  assert.equal(run(15, lampRheo(0.1)).passed, true);
  assert.equal(run(15, lampRheo(0.5)).passed, false);
  const noLamp = build({ parts: { B: ['battery'], R: ['rheostat', { pos: 0.5 }], A: ['ammeter'] },
    wires: [['B.p', 'R.a'], ['R.w', 'A.p'], ['A.n', 'B.n']] });
  assert.equal(run(15, noLamp).passed, false);
});

const ledRig = pos => build({ parts: { B: ['battery', { cells: 2 }], R: ['rheostat', { pos }], A: ['ammeter'], D: ['led'] },
  wires: [['B.p', 'R.a'], ['R.w', 'A.p'], ['A.n', 'D.a'], ['D.k', 'B.n']] });

test('task 16: answer needs the experiment and a value in 0.025..0.035', () => {
  const t = T(16);
  assert.equal(t.answer.kind, 'measure');
  const rig = ledRig(1);
  const early = t.submit(t.initProgress(), 0.03, wsOf(rig));
  const r0 = evaluateTask(t, early.progress, wsOf(rig));
  assert.equal(r0.passed, false);
  assert.equal(r0.hint, '先用电流表和变阻器做实验，把 LED 调到烧坏为止');

  const burnWs = wsOf(setParam(rig, 'R', 'pos', 0));
  assert.ok(burnWs.damage.broken[ofType(rig, 'led')[0].id]);
  const r1 = evaluateTask(t, t.initProgress(), wsOf(rig));
  const r2 = evaluateTask(t, r1.progress, burnWs);
  assert.equal(r2.progress.burned, true);
  assert.equal(r2.progress.sawSeries, true);
  const good = t.submit(r2.progress, 0.03, burnWs);
  assert.equal(evaluateTask(t, good.progress, burnWs).passed, true);
  const bad = t.submit(good.progress, 0.05, burnWs);
  const rb = evaluateTask(t, bad.progress, burnWs);
  assert.equal(rb.passed, false);
  assert.equal(rb.hint, '再看看 LED 烧坏前电流表读多少');
  assert.equal(evaluateTask(t, t.submit(bad.progress, 0.03, burnWs).progress, burnWs).passed, true);
});

test('task 16: burned without an ammeter in series does not count', () => {
  const t = T(16);
  const noMeter = build({ parts: { B: ['battery', { cells: 2 }], D: ['led'] }, wires: [['B.p', 'D.a'], ['D.k', 'B.n']] });
  const r = evaluateTask(t, { ...t.initProgress(), answer: 0.03 }, wsOf(noMeter));
  assert.equal(r.progress.sawSeries, false);
  assert.equal(r.passed, false);
});

test('chapter 3 lists tasks 11..16 in order', () => {
  assert.deepEqual(TASKS.filter(t => t.chapter === 3).map(t => t.id), [11, 12, 13, 14, 15, 16]);
});

test('task 13 question uses the physical cell voltage', () => {
  assert.equal(T(13).answer.question(2), `电池是 ${2 * PHYS.V_CELL} V，两盏一样的灯串联。猜猜电压表读多少？`);
});

test('task 11: correct meters pass, ammeter across lamp fails', () => {
  const ok = build({ parts: { B: ['battery'], A: ['ammeter'], L: ['lamp'], V: ['voltmeter'] },
    wires: [['B.p', 'A.p'], ['A.n', 'L.a'], ['L.b', 'B.n'], ['V.p', 'L.a'], ['V.n', 'L.b']] });
  assert.equal(run(11, ok).passed, true);
  const bad = build({ parts: { B: ['battery'], A: ['ammeter'], L: ['lamp'], V: ['voltmeter'] },
    wires: [['B.p', 'L.a'], ['L.b', 'B.n'], ['A.p', 'L.a'], ['A.n', 'L.b'], ['V.p', 'L.a'], ['V.n', 'L.b']] });
  assert.equal(run(11, bad).passed, false);
});
