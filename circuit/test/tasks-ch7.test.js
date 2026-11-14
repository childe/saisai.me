import test from 'node:test';
import assert from 'node:assert/strict';
import { TASKS, CHAPTERS, evaluateTask } from '../lib/tasks.js';
import { settle } from '../lib/engine.js';
import { createDamage } from '../lib/damage.js';
import { build } from './helpers.js';

const T = id => TASKS.find(t => t.id === id);
const run = (id, c, variant = null) => evaluateTask(T(id), T(id).initProgress(), { ...settle(c, createDamage()), variant });

const display = inputs => build({ parts: { B: ['battery'], D: ['display'] },
  wires: [...inputs.map(i => ['B.p', `D.${i}`]), ['D.g', 'B.n']] });

test('30 display: 4+1 shows 5', () => {
  assert.equal(run(30, display(['i4', 'i1']), 5).passed, true);
  assert.equal(run(30, display(['i4', 'i2', 'i1']), 7).passed, true);
});

test('30 display: only i4 does not pass for 5', () => {
  assert.equal(run(30, display(['i4']), 5).passed, false);
  // 显示 5 但目标是 3
  assert.equal(run(30, display(['i4', 'i1']), 3).passed, false);
});

// 半加器参考接法：上组交叉接出「和」，下组串起来出「进位」。swapA / swapB 为真时把那个开关的 a、b 端对调（「1」换到 a 位置）。
const halfAdder = ({ swapA = false, swapB = false, carry = true } = {}) => {
  const t = (sw, swap) => term => `${sw}.${swap ? { a: 'b', b: 'a' }[term[0]] + term[1] : term}`;
  const A = t('A', swapA), S = t('S', swapB);
  return build({ parts: { B: ['battery'], A: ['dpdt'], S: ['dpdt'], D: ['display'] },
    wires: [
      ['B.p', 'A.c1'], [A('a1'), S('b1')], [A('b1'), S('a1')], ['S.c1', 'D.i1'],
      ...(carry ? [['B.p', 'A.c2'], [A('b2'), 'S.c2'], [S('b2'), 'D.i2']] : []),
      ['D.g', 'B.n'],
    ] });
};

test('31 half adder: reference wiring passes', () => {
  assert.equal(run(31, halfAdder()).passed, true);
});

test('31 half adder: either 1-position mapping passes', () => {
  assert.equal(run(31, halfAdder({ swapA: true, swapB: true })).passed, true);
  // A 的「1」在 b、B 的「1」在 a：两个开关的映射不同也要能过
  assert.equal(run(31, halfAdder({ swapB: true })).passed, true);
});

test('31 half adder: sum without carry fails', () => {
  assert.equal(run(31, halfAdder({ carry: false })).passed, false);
});

// 开关→线圈在电池 B1 那边；触点接法由 contact 给出（'no' / 'nc'）。
const relayLamp = (contact, closed = false) => build({
  parts: { B1: ['battery'], S: ['switch', { closed }], K: ['relay'], B2: ['battery'], L: ['lamp'] },
  wires: [['B1.p', 'S.a'], ['S.b', 'K.x'], ['K.y', 'B1.n'], ['B2.p', 'K.com'], [`K.${contact}`, 'L.a'], ['L.b', 'B2.n']],
});

test('32 relay: two separate loops pass', () => {
  assert.equal(run(32, relayLamp('no')).passed, true);
  assert.equal(run(32, relayLamp('no', true)).passed, true);
});

test('32 relay: lamp on the coil battery fails', () => {
  const c = build({ parts: { B1: ['battery'], S: ['switch'], K: ['relay'], B2: ['battery'], L: ['lamp'] },
    wires: [['B1.p', 'S.a'], ['S.b', 'K.x'], ['K.y', 'B1.n'], ['B1.p', 'K.com'], ['K.no', 'L.a'], ['L.b', 'B1.n']] });
  assert.equal(run(32, c).passed, false);
});

test('32 relay: switch drives lamp directly fails', () => {
  // 继电器线圈一直通电、触点没用；开关直接管灯
  const c = build({ parts: { B1: ['battery'], S: ['switch'], K: ['relay'], B2: ['battery'], L: ['lamp'] },
    wires: [['B1.p', 'K.x'], ['K.y', 'B1.n'], ['B2.p', 'S.a'], ['S.b', 'L.a'], ['L.b', 'B2.n']] });
  assert.equal(run(32, c).passed, false);
});

test('33 not gate: nc contact passes', () => {
  assert.equal(run(33, relayLamp('nc')).passed, true);
});

test('33 not gate: no contact fails', () => {
  assert.equal(run(33, relayLamp('no')).passed, false);
});

// 两个开关各带一个继电器线圈；触点网络由 contacts 给出。
const twoRelays = contacts => build({
  parts: { B1: ['battery'], S1: ['switch'], S2: ['switch'], K1: ['relay'], K2: ['relay'], B2: ['battery'], L: ['lamp'] },
  wires: [['B1.p', 'S1.a'], ['S1.b', 'K1.x'], ['K1.y', 'B1.n'], ['B1.p', 'S2.a'], ['S2.b', 'K2.x'], ['K2.y', 'B1.n'],
    ...contacts, ['L.b', 'B2.n']],
});
const andWiring = () => twoRelays([['B2.p', 'K1.com'], ['K1.no', 'K2.com'], ['K2.no', 'L.a']]);
const orWiring = () => twoRelays([['B2.p', 'K1.com'], ['B2.p', 'K2.com'], ['K1.no', 'L.a'], ['K2.no', 'L.a']]);

test('34 and: two relays in series pass', () => {
  assert.equal(run(34, andWiring(), 'and').passed, true);
});

test('34 and: one relay with two switches in series passes', () => {
  const c = build({ parts: { B1: ['battery'], S1: ['switch'], S2: ['switch'], K: ['relay'], B2: ['battery'], L: ['lamp'] },
    wires: [['B1.p', 'S1.a'], ['S1.b', 'S2.a'], ['S2.b', 'K.x'], ['K.y', 'B1.n'], ['B2.p', 'K.com'], ['K.no', 'L.a'], ['L.b', 'B2.n']] });
  assert.equal(run(34, c, 'and').passed, true);
});

test('34 or: parallel contacts pass', () => {
  assert.equal(run(34, orWiring(), 'or').passed, true);
  assert.equal(run(34, orWiring(), 'and').passed, false);
});

test('34 or: and-wiring fails the or variant', () => {
  assert.equal(run(34, andWiring(), 'or').passed, false);
});

test('34 and: switches driving the lamp directly fail', () => {
  // 两个开关直接串在灯的回路里，继电器空接：亮灭对，但继电器不起作用
  const c = build({ parts: { B1: ['battery'], S1: ['switch'], S2: ['switch'], K1: ['relay'], K2: ['relay'], B2: ['battery'], L: ['lamp'] },
    wires: [['B1.p', 'K1.x'], ['K1.y', 'B1.n'], ['B2.p', 'S1.a'], ['S1.b', 'S2.a'], ['S2.b', 'L.a'], ['L.b', 'B2.n']] });
  assert.equal(run(34, c, 'and').passed, false);
});

test('34 and: switches in the lamp loop plus an always-on relay fail', () => {
  // 两个开关直接串在灯的回路里，再串一个线圈常通的继电器常开触点：继电器看似起作用，但开关没经过继电器
  const c = build({ parts: { B1: ['battery'], S1: ['switch'], S2: ['switch'], K1: ['relay'], K2: ['relay'], B2: ['battery'], L: ['lamp'] },
    wires: [['B1.p', 'K1.x'], ['K1.y', 'B1.n'], ['B2.p', 'S1.a'], ['S1.b', 'S2.a'], ['S2.b', 'K1.com'], ['K1.no', 'L.a'], ['L.b', 'B2.n']] });
  assert.equal(run(34, c, 'and').passed, false);
});

test('34 goal text follows the variant', () => {
  assert.equal(T(34).goal('and'), '两个开关都合上，灯才亮');
  assert.equal(T(34).goal('or'), '随便合上一个开关，灯就亮');
});

test('chapter 7 is listed with 5 tasks so far', () => {
  assert.ok(CHAPTERS.some(c => c.n === 7 && c.name === '逻辑与加法器'));
  assert.deepEqual(TASKS.filter(t => t.chapter === 7).map(t => t.id), [30, 31, 32, 33, 34]);
});
