import test from 'node:test';
import assert from 'node:assert/strict';
import { TASKS, evaluateTask } from '../lib/tasks.js';
import { settle } from '../lib/engine.js';
import { createDamage, brokenSet } from '../lib/damage.js';
import { addPart, addWire } from '../lib/circuit.js';
import { lampLit, ofType, withParams, metersRead } from '../lib/task-kit.js';
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

test('chapter 5 lists tasks 21..23, all locked preset with fault progress', () => {
  assert.deepEqual(TASKS.filter(t => t.chapter === 5).map(t => t.id), [21, 22, 23]);
  for (const id of [21, 22, 23]) {
    assert.equal(T(id).lockPreset, true);
    assert.deepEqual(T(id).initProgress(), { measured: false, found: false, probed: [] });
  }
  assert.deepEqual(T(21).palette, { voltmeter: 1 });
  assert.deepEqual(T(22).palette, { voltmeter: 1, ammeter: 1 });
  assert.deepEqual(T(23).palette, { voltmeter: 1 });
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

test('task 22: fault is on a branch wire not touching L2, common part is fine', () => {
  const t = T(22);
  assert.ok(t.variants.length >= 2);
  for (const v of t.variants) {
    const c = t.preset(v);
    const bad = faulty(c)[0];
    assert.ok(c.wires.includes(bad), 'fault is a wire');
    assert.equal(bad.fault, 'open');
    const l2 = c.parts.filter(p => p.type === 'lamp')[1].id;
    assert.notEqual(bad.a.part, l2);
    assert.notEqual(bad.b.part, l2);
    const ws = wsOf(c, v);
    const lamps = ofType(c, 'lamp');
    assert.equal(lampLit(ws.result, new Set(), lamps[0].id), true, 'L1 lit');
    assert.equal(lampLit(ws.result, new Set(), lamps[1].id), false, 'L2 dark');
    assert.ok(ofType(c, 'switch')[0].params.closed, 'switch is closed');
    assert.ok(ofType(c, 'node').length >= 2);
    assert.ok(c.wires.filter(w => w.a.part !== lamps[1].id && w.b.part !== lamps[1].id &&
      (ofType(c, 'node').some(n => n.id === w.a.part) || ofType(c, 'node').some(n => n.id === w.b.part))).length >= 2);
  }
});

test('task 23: each variant puts the fault on one throw of one spdt', () => {
  const t = T(23);
  assert.equal(t.variants.length, 4);
  const seen = new Set();
  for (const v of t.variants) {
    const c = t.preset(v);
    const bad = faulty(c)[0];
    assert.equal(bad.type, 'spdt');
    assert.ok(['open-a', 'open-b'].includes(bad.fault));
    seen.add(`${bad.id}:${bad.fault}`);
    const [lamp] = ofType(c, 'lamp');
    const sw = ofType(c, 'spdt');
    const states = [];
    for (const a of ['a', 'b']) for (const b of ['a', 'b']) {
      const r = solve(withParams(c, { [sw[0].id]: { to: a }, [sw[1].id]: { to: b } }), new Set());
      states.push(lampLit(r, new Set(), lamp.id));
    }
    assert.ok(states.includes(true) && states.includes(false), `variant ${v}: ${states}`);
  }
  assert.equal(seen.size, 4);
});

test('metersRead: ammeter >= 0.01 A or voltmeter >= 0.1 V', () => {
  const t = T(21);
  const c = t.preset(t.variants[0]);
  assert.equal(metersRead(wsOf(c)), false);
  const bat = ofType(c, 'battery')[0].id;
  const m = withVoltmeter(c, bat, 'p', bat, 'n');
  assert.equal(metersRead(wsOf(m.circuit)), true);
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
    assert.equal(checked.progress.measured, true);
    assert.equal(checked.passed, false);
    assert.equal(checked.hint, null);
    assert.ok(checked.progress.probed.includes(`part:${bat}`));
    assert.equal(t.accuse(checked.progress, badTarget, wsb), null, `task ${id} unprobed bad`);
    assert.equal(t.accuse(checked.progress, other, wsb), null, `task ${id} unprobed other`);

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

test('task 22: at least 3 candidate wires, one fault each, L1 lit, trunk intact', () => {
  const t = T(22);
  assert.ok(t.variants.length >= 3);
  const seen = new Set();
  for (const v of t.variants) {
    const c = t.preset(v);
    const bad = faulty(c);
    assert.equal(bad.length, 1);
    assert.ok(c.wires.includes(bad[0]));
    const l2 = ofType(c, 'lamp')[1].id;
    assert.ok(bad[0].a.part !== l2 && bad[0].b.part !== l2);
    seen.add(bad[0].id);
    const ws = wsOf(c, v);
    assert.equal(lampLit(ws.result, new Set(), ofType(c, 'lamp')[0].id), true);
  }
  assert.equal(seen.size, t.variants.length);
});

test('check: hint before measuring, measured sticks, passed follows found', () => {
  const t = T(21);
  const v = t.variants[0];
  const c = t.preset(v);
  const ws0 = wsOf(c, v);
  const a = evaluateTask(t, t.initProgress(), ws0);
  assert.equal(a.hint, '先用电表量一量');
  assert.equal(a.passed, false);
  assert.equal(a.progress.measured, false);
  const bat = ofType(c, 'battery')[0].id;
  const m = withVoltmeter(c, bat, 'p', bat, 'n');
  const b = evaluateTask(t, a.progress, wsOf(m.circuit, v));
  assert.equal(b.progress.measured, true);
  assert.equal(b.hint, null);
  // 拆掉电压表，measured 仍保持
  const c2 = evaluateTask(t, b.progress, ws0);
  assert.equal(c2.progress.measured, true);
  assert.equal(c2.hint, null);
  const d = evaluateTask(t, { ...b.progress, found: true }, wsOf(m.circuit, v));
  assert.equal(d.passed, true);
});
