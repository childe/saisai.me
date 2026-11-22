import test from 'node:test';
import assert from 'node:assert/strict';
import { TASKS, evaluateTask } from '../lib/tasks.js';
import { settle } from '../lib/engine.js';
import { createDamage, brokenSet } from '../lib/damage.js';
import { addPart, addWire } from '../lib/circuit.js';
import { lampLit, ofType, withParams } from '../lib/task-kit.js';
import { solve } from '../lib/solve.js';
import { PARTS } from '../lib/parts.js';

const T = id => TASKS.find(t => t.id === id);
const wsOf = (c, variant) => ({ ...settle(c, createDamage()), variant });
const faulty = c => [...c.parts, ...c.wires].filter(x => x.fault);

// 给电路加一个电压表，接在 (part a, term ta) 和 (part b, term tb) 之间。
function withVoltmeter(c, a, ta, b, tb) {
  const p = addPart(c, 'voltmeter', 20, 20);
  let r = addWire(p.circuit, { part: p.id, term: 'p' }, { part: a, term: ta });
  r = addWire(r.circuit, { part: p.id, term: 'n' }, { part: b, term: tb });
  return { circuit: r.circuit, vid: p.id };
}

test('chapter 3 ends with 48, 21, 22; 21 and 22 are locked preset with fault progress', () => {
  assert.deepEqual(TASKS.filter(t => t.chapter === 3).map(t => t.id), [11, 12, 13, 14, 15, 16, 48, 21, 22]);
  for (const id of [21, 22]) {
    assert.equal(T(id).lockPreset, true);
    assert.deepEqual(T(id).initProgress(), { found: false, probed: [] });
  }
  assert.deepEqual(T(21).palette, { voltmeter: 1 });
  assert.deepEqual(T(22).palette, { voltmeter: 1 });
  assert.deepEqual(T(21).suspect, { types: ['lamp'], name: '灯' });
  assert.deepEqual(T(22).suspect, { types: ['wire'], name: '导线' });
  assert.deepEqual(T(23).suspect, { types: ['spdt'], name: '开关' });
});

test('every variant presets exactly one fault, all items preset', () => {
  for (const id of [21, 22, 23]) {
    const t = T(id);
    assert.ok(t.variants.length >= 2);
    for (const v of t.variants) {
      const c = t.preset(v);
      assert.equal(faulty(c).length, 1, `task ${id} variant ${v}`);
      assert.ok([...c.parts, ...c.wires].every(x => x.preset));
    }
  }
});

test('21, 22: at least one lamp is dark in every variant', () => {
  for (const id of [21, 22]) {
    for (const v of T(id).variants) {
      const ws = wsOf(T(id).preset(v), v);
      assert.equal(ws.result.ok, true);
      const br = brokenSet(ws.damage);
      assert.ok(ofType(ws.circuit, 'lamp').some(l => !lampLit(ws.result, br, l.id)), `task ${id} variant ${v}`);
    }
  }
});

test('task 21: faulty lamp is a lamp; voltmeter across it reads the battery, across a good lamp reads ~0', () => {
  const t = T(21);
  assert.equal(t.variants.length, 3);
  for (const v of t.variants) {
    const c = t.preset(v);
    const bad = faulty(c)[0];
    assert.equal(bad.type, 'lamp');
    assert.equal(bad.fault, 'open');
    for (const l of ofType(c, 'lamp')) {
      const m = withVoltmeter(c, l.id, 'a', l.id, 'b');
      const r = solve(m.circuit, new Set());
      const reading = Math.abs(r.parts[m.vid].v);
      if (l.id === bad.id) assert.ok(reading >= 2.9, `bad lamp reads ${reading}`);
      else assert.ok(reading < 0.1, `good lamp reads ${reading}`);
    }
  }
});

test('task 48: preset switch open and lamp dark; measuring switch (3 V) then lamp (0 V) passes', () => {
  const t = T(48);
  assert.equal(t.accuse, undefined);
  assert.equal(t.lockPreset, true);
  assert.deepEqual(t.palette, { voltmeter: 1 });
  const c = t.preset();
  const S = ofType(c, 'switch')[0], L = ofType(c, 'lamp')[0];
  assert.equal(S.params.closed, false);
  assert.ok([...c.parts, ...c.wires].every(x => x.preset));
  assert.equal(lampLit(wsOf(c).result, new Set(), L.id), false);
  let r = evaluateTask(t, t.initProgress(), wsOf(c));
  assert.equal(r.hint, '先用电压表量一量');
  assert.equal(r.passed, false);
  const onS = withVoltmeter(c, S.id, 'a', S.id, 'b');
  assert.ok(Math.abs(solve(onS.circuit, new Set()).parts[onS.vid].v) >= 2.9);
  r = evaluateTask(t, r.progress, wsOf(onS.circuit));
  assert.equal(r.passed, false);
  assert.equal(r.hint, null);
  const onL = withVoltmeter(c, L.id, 'a', L.id, 'b');
  assert.ok(Math.abs(solve(onL.circuit, new Set()).parts[onL.vid].v) < 0.1);
  r = evaluateTask(t, r.progress, wsOf(onL.circuit));
  assert.equal(r.passed, true);
});

test('task 48: measuring the lamp only, or the switch only while closed, does not pass', () => {
  const t = T(48);
  const c = t.preset();
  const S = ofType(c, 'switch')[0], L = ofType(c, 'lamp')[0];
  const onL = withVoltmeter(c, L.id, 'a', L.id, 'b');
  assert.equal(evaluateTask(t, t.initProgress(), wsOf(onL.circuit)).passed, false);
  const closed = withParams(c, { [S.id]: { closed: true } });
  const onS = withVoltmeter(closed, S.id, 'a', S.id, 'b');
  let r = evaluateTask(t, t.initProgress(), wsOf(onS.circuit));
  assert.equal(r.hint, null);
  r = evaluateTask(t, r.progress, wsOf(withVoltmeter(closed, L.id, 'a', L.id, 'b').circuit));
  assert.equal(r.passed, false);
});

test('task 22: four long preset wires, one open per variant, no node parts, all lamps dark', () => {
  const t = T(22);
  assert.deepEqual(t.variants, [0, 1, 2, 3]);
  const seen = new Set();
  for (const v of t.variants) {
    const c = t.preset(v);
    assert.equal(c.wires.length, 4);
    assert.equal(ofType(c, 'node').length, 0);
    assert.equal(faulty(c).length, 1);
    assert.ok(c.wires.includes(faulty(c)[0]));
    assert.equal(faulty(c)[0].fault, 'open');
    seen.add(faulty(c)[0].id);
    assert.ok(ofType(c, 'switch')[0].params.closed);
    const ws = wsOf(c, v);
    assert.equal(ws.result.ok, true);
    assert.ok(ofType(c, 'lamp').every(l => !lampLit(ws.result, new Set(), l.id)));
    for (const w of c.wires) {
      const m = withVoltmeter(c, w.a.part, w.a.term, w.b.part, w.b.term);
      const reading = Math.abs(solve(m.circuit, new Set()).parts[m.vid].v);
      if (w.fault) assert.ok(reading >= 2.9, `variant ${v} bad wire reads ${reading}`);
      else assert.ok(reading < 0.1, `variant ${v} good wire reads ${reading}`);
    }
    for (const l of ofType(c, 'lamp')) {
      const m = withVoltmeter(c, l.id, 'a', l.id, 'b');
      assert.ok(Math.abs(solve(m.circuit, new Set()).parts[m.vid].v) < 0.1, `variant ${v} lamp not 0 V`);
    }
  }
  assert.equal(seen.size, 4);
});

test('goal and how texts of the fault levels', () => {
  assert.equal(T(48).name, '断开的地方');
  assert.equal(T(48).goal, '量一量断开的开关');
  assert.ok(T(48).how.includes('断开的地方能量到电池的 3 V'));
  assert.equal(T(21).goal, '找出坏掉的那一盏灯');
  assert.ok(T(21).how.includes('读到 3 V 的就是它'));
  assert.equal(T(22).name, '哪根线断了');
  assert.equal(T(22).goal, '找出断掉的那根导线');
  assert.ok(T(22).how.includes('点那根线'));
});

// 目标的两个不同端点：导线是两头，元件取前两个端点。
const endsOf = (c, target) => {
  if (target.kind === 'wire') { const w = c.wires.find(x => x.id === target.id); return [w.a, w.b]; }
  const p = c.parts.find(x => x.id === target.id);
  const [t0, t1] = p.type === 'spdt' ? ['c', p.params.to] : PARTS[p.type].terms;
  return [{ part: p.id, term: t0 }, { part: p.id, term: t1 }];
};
const across = (c, target) => { const [e1, e2] = endsOf(c, target); return withVoltmeter(c, e1.part, e1.term, e2.part, e2.term); };
const keyOf = t => `${t.kind}:${t.id}`;

test('accuse: null unless the target was probed; right on fault, wrong on other preset; null on non-preset', () => {
  for (const id of [21, 22, 23]) {
    const t = T(id);
    const v = t.variants[0];
    const c = t.preset(v);
    const bad = faulty(c)[0];
    const isWire = c.wires.includes(bad);
    const badTarget = { kind: isWire ? 'wire' : 'part', id: bad.id };
    const other = isWire ? { kind: 'wire', id: c.wires.find(w => !w.fault).id } : { kind: 'part', id: ofType(c, bad.type).find(p => !p.fault).id };

    const ws0 = wsOf(c, v);
    assert.equal(t.accuse(t.initProgress(), badTarget, ws0), null);

    // 量的是电池：有读数，但目标没量过，不能指认
    const bat = ofType(c, 'battery')[0].id;
    const mb = withVoltmeter(c, bat, 'p', bat, 'n');
    const wsb = wsOf(mb.circuit, v);
    const checked = evaluateTask(t, t.initProgress(), wsb);
    assert.equal(checked.passed, false);
    assert.equal(checked.hint, null);
    assert.ok(checked.progress.probed.includes(`part:${bat}`));
    assert.equal(t.accuse(checked.progress, badTarget, wsb), null, `task ${id} unprobed bad`);
    assert.equal(t.accuse(checked.progress, other, wsb), null, `task ${id} unprobed other`);
    // 电池量过了，但电池不是这关的候选
    assert.equal(t.accuse(checked.progress, { kind: 'part', id: bat }, wsb), null, `task ${id} battery is not a suspect`);

    // 量过目标两端，拆掉电压表后仍然可以指认
    let p = checked.progress;
    for (const target of [badTarget, other]) {
      const m = across(c, target);
      p = evaluateTask(t, p, wsOf(m.circuit, v)).progress;
      assert.ok(p.probed.includes(keyOf(target)), `task ${id} probed ${keyOf(target)}: ${p.probed}`);
    }
    assert.equal(t.accuse(p, badTarget, ws0), 'right');
    assert.equal(t.accuse(p, other, ws0), 'wrong');
    // 孩子自己加的电压表和导线不是答案
    assert.equal(t.accuse(p, { kind: 'part', id: mb.vid }, wsb), null);
    const childWire = mb.circuit.wires.find(w => !w.preset);
    assert.equal(t.accuse(p, { kind: 'wire', id: childWire.id }, wsb), null);
    // 不存在的目标
    assert.equal(t.accuse(p, { kind: 'part', id: 'nope' }, ws0), null);
  }
});

test('probe: voltmeter leads must reach two different ends of the target through wires only', () => {
  const t = T(21);
  const c = t.preset('L1');
  const [l1, l2] = ofType(c, 'lamp');
  // 电压表接在 L1.a 和 L2.b：中间隔着两盏灯，不算量过 L1 或 L2
  const m = withVoltmeter(c, l1.id, 'a', l2.id, 'b');
  const p = evaluateTask(t, t.initProgress(), wsOf(m.circuit, 'L1')).progress;
  assert.ok(!p.probed.includes(`part:${l1.id}`) && !p.probed.includes(`part:${l2.id}`), String(p.probed));
  // L1.b 与 L2.a 之间只有一根导线：接在 L1.a 和 L2.a 就是量了 L1
  const m2 = withVoltmeter(c, l1.id, 'a', l2.id, 'a');
  const p2 = evaluateTask(t, t.initProgress(), wsOf(m2.circuit, 'L1')).progress;
  assert.ok(p2.probed.includes(`part:${l1.id}`));
  // 一根导线：两头接在同一个点上（导线本身算），不算量过它
  const w = c.wires.find(x => x.a.part === l1.id && x.a.term === 'b');
  const m3 = withVoltmeter(c, l1.id, 'b', l1.id, 'b');
  assert.ok(!evaluateTask(t, t.initProgress(), wsOf(m3.circuit, 'L1')).progress.probed.includes(`wire:${w.id}`));
});

test('check: hint until something is probed, probed sticks, passed follows found', () => {
  const t = T(21);
  const v = t.variants[0];
  const c = t.preset(v);
  const ws0 = wsOf(c, v);
  const a = evaluateTask(t, t.initProgress(), ws0);
  assert.equal(a.hint, '先用电压表量一量');
  assert.equal(a.passed, false);
  assert.deepEqual(a.progress.probed, []);
  const bat = ofType(c, 'battery')[0].id;
  const m = withVoltmeter(c, bat, 'p', bat, 'n');
  const b = evaluateTask(t, a.progress, wsOf(m.circuit, v));
  assert.ok(b.progress.probed.includes(`part:${bat}`));
  assert.equal(b.hint, null);
  // 拆掉电压表，量过的记录仍保持
  const c2 = evaluateTask(t, b.progress, ws0);
  assert.ok(c2.progress.probed.includes(`part:${bat}`));
  assert.equal(c2.hint, null);
  const d = evaluateTask(t, { ...b.progress, found: true }, wsOf(m.circuit, v));
  assert.equal(d.passed, true);
});

test('0 V reading still counts as probed', () => {
  const t = T(21);
  const c = t.preset('L1');
  const l2 = ofType(c, 'lamp')[1];
  const m = withVoltmeter(c, l2.id, 'a', l2.id, 'b');
  assert.ok(Math.abs(solve(m.circuit, new Set()).parts[m.vid].v) < 0.1);
  const r = evaluateTask(t, t.initProgress(), wsOf(m.circuit, 'L1'));
  assert.ok(r.progress.probed.includes(`part:${l2.id}`));
  assert.equal(r.hint, null);
});
