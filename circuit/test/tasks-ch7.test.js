import test from 'node:test';
import assert from 'node:assert/strict';
import { TASKS, CHAPTERS, evaluateTask, withParams } from '../lib/tasks.js';
import { stableSolve, displayValue } from '../lib/task-kit.js';
import { settle } from '../lib/engine.js';
import { createDamage } from '../lib/damage.js';
import { build } from './helpers.js';
import { createEditor, reduce } from '../lib/editor.js';
import { addWire } from '../lib/circuit.js';
import { PARTS } from '../lib/parts.js';
import { drawPart } from '../lib/drawings.js';
import { GRID, BOARD, BODY_RECT, LEVER_RECT, rotatePoint, terminalPoint, wirePoints } from '../lib/geometry.js';

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

test('chapter 7 is listed with 7 tasks', () => {
  assert.ok(CHAPTERS.some(c => c.n === 7 && c.name === '逻辑与加法器'));
  assert.deepEqual(TASKS.filter(t => t.chapter === 7).map(t => t.id), [30, 31, 32, 33, 34, 35, 36]);
});

// 进入第 35 关，把电路装进关卡空间，然后依次执行动作。
const play = (s, ...as) => as.reduce(reduce, s);
const bellSpace = c => {
  const s = play(createEditor(), { type: 'setMode', mode: 'task' }, { type: 'chooseTask', index: TASKS.indexOf(T(35)) });
  return { ...s, task: { ...s.task, ...settle(c, createDamage()) } };
};
const ticks = (s, n) => play(s, ...Array.from({ length: n }, () => ({ type: 'tick', dt: 0.05 })));
// 按钮接线圈，线圈另一端经触点 contact 回到电池；contact 为 null 时线圈直接接电池负极。
const bell = contact => build({
  parts: { B: ['battery'], BT: ['button'], K: ['relay'] },
  wires: [['B.p', 'BT.a'], ['BT.b', 'K.x'], ...(contact ? [['K.y', `K.${contact}`], ['K.com', 'B.n']] : [['K.y', 'B.n']])],
});

test('35 bell: nc self-interrupt passes after holding the button', () => {
  let s = bellSpace(bell('nc'));
  s = play(s, { type: 'press', id: 'BT' });
  assert.equal(s.task.passed, false);
  s = ticks(s, 10);
  assert.ok(s.task.relays.flips >= 4);
  assert.equal(s.task.progress.seen, true);
  assert.equal(s.task.passed, true);
});

test('35 bell: releasing clears base but keeps seen', () => {
  let s = ticks(play(bellSpace(bell('nc')), { type: 'press', id: 'BT' }), 10);
  s = play(s, { type: 'release', id: 'BT' });
  assert.deepEqual(s.task.progress, { base: null, seen: true });
});

test('35 bell: tapping a no-contact relay does not pass', () => {
  for (const contact of ['no', null]) {
    let s = bellSpace(bell(contact));
    for (let i = 0; i < 6; i++) s = ticks(play(ticks(play(s, { type: 'press', id: 'BT' }), 2), { type: 'release', id: 'BT' }), 2);
    assert.equal(s.task.passed, false, String(contact));
  }
});

test('35 bell: seen alone is not enough when the relay is stable', () => {
  // 线圈直接接电池：按住时继电器稳定吸合，不会自己哒哒响
  const c = build({ parts: { B: ['battery'], BT: ['button', { pressed: true }], K: ['relay'] },
    wires: [['B.p', 'BT.a'], ['BT.b', 'K.x'], ['K.y', 'B.n']] });
  const ws = { ...settle(c, createDamage()), variant: null };
  assert.equal(evaluateTask(T(35), { base: 0, seen: true }, ws).passed, false);
  const osc = { ...settle(bell('nc'), createDamage()), variant: null };
  assert.equal(evaluateTask(T(35), { base: 0, seen: true }, osc).passed, true);
});

// 第 36 关：按 tag 找预置元件，接上触点网络。
const byTag = (c, tag) => c.parts.find(p => p.tag === tag).id;
const wireUp = (c, pairs) => pairs.reduce((cc, [a, b]) => {
  const [pa, ta] = a.split('.'), [pb, tb] = b.split('.');
  const r = addWire(cc, { part: byTag(cc, pa), term: ta }, { part: byTag(cc, pb), term: tb });
  assert.ok(r, `${a} - ${b}`);
  return r.circuit;
}, c);
// 设计文档「参考接法」：X1 = A1.no/B1.nc/B2.no，X0 = A1.nc/B1.no/B2.nc，Y1 = B1.com/C1.nc/C2.com，Y0 = B2.com/C1.no。
const SUM = [
  ['BL.p', 'A1.com'], ['A1.no', 'B1.nc'], ['A1.no', 'B2.no'], ['A1.nc', 'B1.no'], ['A1.nc', 'B2.nc'],
  ['B1.com', 'C1.nc'], ['B2.com', 'C1.no'], ['C1.com', 'D.i1'],
];
const CARRY = [['BL.p', 'A2.com'], ['A2.no', 'B3.com'], ['B3.no', 'D.i2'], ['B1.com', 'C2.com'], ['C2.no', 'D.i2']];
const adder = (pairs = [...SUM, ...CARRY]) => wireUp(T(36).preset(), pairs);
const run36 = c => evaluateTask(T(36), T(36).initProgress(), { ...settle(c, createDamage()), variant: null });

// 元件本体（含拨片）在画板上的矩形
const bodyOf = p => {
  const def = PARTS[p.type];
  const rects = [def.body ?? BODY_RECT, ...(def.lever ? [def.leverRect ?? LEVER_RECT] : [])];
  const pts = rects.flatMap(r => [[r.x0, r.y0], [r.x1, r.y1]]).map(q => rotatePoint(q, p.rot));
  const xs = pts.map(q => p.x + q[0]), ys = pts.map(q => p.y + q[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};
const overlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

test('36 full adder: preset fits the board and nothing overlaps', () => {
  const c = T(36).preset();
  const tags = c.parts.filter(p => p.type !== 'node').map(p => p.tag).sort();
  assert.deepEqual(tags, ['A', 'A1', 'A2', 'B', 'B1', 'B2', 'B3', 'BC', 'BL', 'C', 'C1', 'C2', 'D'].sort());
  assert.ok(c.parts.every(p => p.preset) && c.wires.every(w => w.preset));
  const seen = new Map();
  for (const p of c.parts) for (const term of PARTS[p.type].terms) {
    const [x, y] = terminalPoint(p, term);
    assert.ok(x >= 0 && x <= BOARD.w && y >= 0 && y <= BOARD.h, `${p.tag ?? p.id}.${term}`);
    const k = `${x},${y}`;
    assert.ok(!seen.has(k), `${p.tag ?? p.id}.${term} 和 ${seen.get(k)} 重合`);
    seen.set(k, `${p.tag ?? p.id}.${term}`);
  }
  const solid = c.parts.filter(p => p.type !== 'node');
  for (const p of solid) {
    const b = bodyOf(p);
    assert.ok(b.x0 >= 0 && b.x1 <= BOARD.w && b.y0 >= 0 && b.y1 <= BOARD.h, p.tag);
    for (const q of solid) if (q !== p) assert.ok(!overlap(b, bodyOf(q)), `${p.tag} 和 ${q.tag} 重叠`);
  }
});

test('36 full adder: preset wires do not run over other terminals', () => {
  const c = T(36).preset();
  const terms = c.parts.flatMap(p => PARTS[p.type].terms.map(t => ({ k: `${p.id}.${t}`, pt: terminalPoint(p, t) })));
  for (const w of c.wires) {
    const pts = wirePoints(c, w);
    const ends = [`${w.a.part}.${w.a.term}`, `${w.b.part}.${w.b.term}`];
    for (const { k, pt } of terms) {
      if (ends.includes(k)) continue;
      for (let i = 1; i < pts.length; i++) {
        const [a, b] = [pts[i - 1], pts[i]];
        const on = Math.min(a[0], b[0]) <= pt[0] && pt[0] <= Math.max(a[0], b[0])
          && Math.min(a[1], b[1]) <= pt[1] && pt[1] <= Math.max(a[1], b[1]);
        assert.ok(!on, `${w.id} 压在 ${k} 上`);
      }
    }
  }
});

test('36 full adder: preset coils pull in, display starts at 0', () => {
  const c = T(36).preset();
  const sw = id => byTag(c, id);
  const all = withParams(c, { [sw('A')]: { closed: true }, [sw('B')]: { closed: true }, [sw('C')]: { closed: true } });
  const s = stableSolve(all, new Set());
  assert.equal(s.stable, true);
  assert.deepEqual([...s.on].sort(), ['A1', 'A2', 'B1', 'B2', 'B3', 'C1', 'C2'].map(t => byTag(c, t)).sort());
  assert.equal(displayValue(stableSolve(c, new Set()).result, new Set(), byTag(c, 'D')), 0);
  assert.equal(T(36).lockPreset, true);
  assert.deepEqual(T(36).palette, {});
});

test('36 full adder: reference wiring passes all 8 combos', () => {
  const c = adder();
  for (const a of [0, 1]) for (const b of [0, 1]) for (const cc of [0, 1]) {
    const ch = { [byTag(c, 'A')]: { closed: !!a }, [byTag(c, 'B')]: { closed: !!b }, [byTag(c, 'C')]: { closed: !!cc } };
    const s = stableSolve(withParams(c, ch), new Set());
    assert.equal(s.stable, true);
    assert.equal(displayValue(s.result, new Set(), byTag(c, 'D')), a + b + cc, `${a}${b}${cc}`);
  }
  assert.equal(run36(c).passed, true);
});

test('36 full adder: sum-only wiring fails', () => {
  assert.equal(run36(adder(SUM)).passed, false);
  assert.equal(run36(T(36).preset()).passed, false);
});

test('full adder check is fast', () => {
  const ws = { ...settle(adder(), createDamage()), variant: null };
  const t0 = performance.now();
  T(36).check(T(36).initProgress(), ws);
  assert.ok(performance.now() - t0 < 50);
});

// 第 36 关：继电器常开/常闭标签和开关、继电器的名字，在板面上互不压住，也不盖端点。
test('36 full adder: relay contact labels and tag names do not overlap each other or terminals', () => {
  const c = T(36).preset();
  const vis = { glow: 0, burnt: false, alarm: false, spin: 0, volume: 0, text: null, stale: false };
  for (const style of ['cartoon', 'symbol']) {
    const labels = [], terms = [];
    for (const p of c.parts) {
      for (const term of PARTS[p.type].terms) terms.push(terminalPoint(p, term));
      for (const m of drawPart(p, style, vis).matchAll(/<text\b([^>]*)>([^<]*)</g)) {
        const a = m[1];
        if (!/class="label/.test(a) || !['switch', 'relay'].includes(p.type)) continue;
        // 转回正向的字绕自己的字形中心转：transform 里的圆心就是本地中心；没转的字中心在基线上方约 6。
        const rot = a.match(/rotate\(-?\d+ ([-\d.]+) ([-\d.]+)\)/);
        const local = rot ? [Number(rot[1]), Number(rot[2])] : [Number(a.match(/\bx="([-\d.]+)"/)[1]), Number(a.match(/\by="([-\d.]+)"/)[1]) - 6];
        const [rx, ry] = rotatePoint([local[0] / GRID, local[1] / GRID], p.rot);
        labels.push({ text: m[2], x: p.x + rx, y: p.y + ry, w: m[2].length * 0.4 });
      }
    }
    // 7 个继电器各有常开、常闭，再加 3 个开关和 7 个继电器的名字。
    assert.equal(labels.length, 7 * 2 + 10, style);
    for (const l of labels) {
      assert.ok(l.x - l.w / 2 >= 0 && l.x + l.w / 2 <= BOARD.w && l.y >= 0.4 && l.y <= BOARD.h - 0.4, `${style}/${l.text} 出界`);
      for (const [tx, ty] of terms) assert.ok(Math.hypot(l.x - tx, l.y - ty) >= 0.35, `${style}/${l.text} 盖住端点`);
    }
    for (const [i, a] of labels.entries()) for (const b of labels.slice(i + 1)) {
      if (Math.abs(a.y - b.y) < 0.4) assert.ok(Math.abs(a.x - b.x) >= (a.w + b.w) / 2 + 0.1, `${style}/${a.text}@${a.x},${a.y} 和 ${b.text}@${b.x},${b.y} 重叠`);
    }
  }
});
