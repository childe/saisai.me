import test from 'node:test';
import assert from 'node:assert/strict';
import { TASKS, evaluateTask } from '../lib/tasks.js';
import { settle } from '../lib/engine.js';
import { createDamage } from '../lib/damage.js';
import { build } from './helpers.js';
import { solve } from '../lib/solve.js';
import { lampLit, ofType, withParams } from '../lib/task-kit.js';

const T = id => TASKS.find(t => t.id === id);
const run = (id, c, progress = T(id).initProgress()) => evaluateTask(T(id), progress, settle(c, createDamage()));
const faulty = c => [...c.parts, ...c.wires].filter(x => x.fault);

test('task 24: staircase wiring passes, single switch fails', () => {
  const st = build({ parts: { B: ['battery'], S1: ['spdt'], S2: ['spdt'], L: ['lamp'] },
    wires: [['B.p', 'S1.c'], ['S1.a', 'S2.a'], ['S1.b', 'S2.b'], ['S2.c', 'L.a'], ['L.b', 'B.n']] });
  assert.equal(run(24, st).passed, true);
  const one = build({ parts: { B: ['battery'], S1: ['spdt'], S2: ['spdt'], L: ['lamp'] },
    wires: [['B.p', 'S1.c'], ['S1.a', 'L.a'], ['L.b', 'B.n']] });
  assert.equal(run(24, one).passed, false);
});

test('task 26: spdt alternates two LEDs; one LED only or no resistor fails', () => {
  const mk = extra => build({ parts: { B1: ['battery'], B2: ['battery'], R: ['resistor', { ohms: 220 }], S: ['spdt'], D1: ['led'], D2: ['led', { color: 'green' }] },
    wires: [['B1.p', 'B2.n'], ['B2.p', 'R.a'], ['R.b', 'S.c'], ['S.a', 'D1.a'], ['D1.k', 'B1.n'], ...extra] });
  assert.equal(run(26, mk([['S.b', 'D2.a'], ['D2.k', 'B1.n']])).passed, true);
  assert.equal(run(26, mk([])).passed, false);
  const noR = build({ parts: { B1: ['battery'], B2: ['battery'], S: ['spdt'], D1: ['led'], D2: ['led'] },
    wires: [['B1.p', 'B2.n'], ['B2.p', 'S.c'], ['S.a', 'D1.a'], ['D1.k', 'B1.n'], ['S.b', 'D2.a'], ['D2.k', 'B1.n']] });
  assert.equal(run(26, noR).passed, false);
});

test('task 27: spdt picks a slow or fast gear; no resistor in either gear fails', () => {
  const mk = extra => build({ parts: { B: ['battery', { cells: 2 }], S: ['switch'], D: ['spdt'], R: ['resistor', { ohms: 10 }], M: ['motor'] },
    wires: [['B.p', 'S.a'], ['S.b', 'D.c'], ['D.a', 'M.a'], ['M.b', 'B.n'], ...extra] });
  const ok = mk([['D.b', 'R.a'], ['R.b', 'M.a']]);
  assert.equal(run(27, ok).passed, true);
  // 没有电阻：两档一样快
  const same = mk([['D.b', 'M.a']]);
  assert.equal(run(27, same).passed, false);
});

test('chapter 5 lists 24, 23, 26, 27 in play order', () => {
  assert.deepEqual(TASKS.filter(t => t.chapter === 5).map(t => t.id), [24, 23, 26, 27]);
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

test('task 23: goal and how texts', () => {
  assert.equal(T(23).goal, '找出坏掉的那个开关');
  assert.ok(T(23).how.includes('公共端'));
});
