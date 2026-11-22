// 第 5 章：单刀双掷开关与保险丝。
import { PHYS } from '../parts.js';
import { solve } from '../solve.js';
import { brokenSet } from '../damage.js';
import { createCircuit } from '../circuit.js';
import { lampLit, ledLit, motorOn, buzzerOn, withParams, ofType, result, noProgress, presetCircuit, faultTask } from '../task-kit.js';

// 23：楼梯灯，故障是某个开关的某一掷接触不良。variant 如 'S1.a' 表示 S1 的 a 掷
const stairsPreset = variant => {
  const [sw, throwName] = variant.split('.');
  const bad = name => (name === sw ? { fault: `open-${throwName}` } : {});
  return presetCircuit([
    ['B', 'battery', 5, 12, { cells: 2 }],
    ['S1', 'spdt', 5, 5, {}, bad('S1')], ['S2', 'spdt', 15, 5, {}, bad('S2')],
    ['L', 'lamp', 13, 12],
  ], [
    ['B.p', 'S1.c'],
    ['S1.a', 'S2.a', { via: [[7, 2], [19, 2], [19, 4]] }],
    ['S1.b', 'S2.b', { via: [[7, 8], [19, 8], [19, 6]] }],
    ['S2.c', 'L.a', { via: [[13, 5], [11, 5]] }],
    ['L.b', 'B.n', { via: [[15, 15], [7, 15]] }],
  ]);
};

export const CH5 = [
  {
    id: 24, chapter: 5, name: '楼梯灯', goal: '楼上楼下都能开关同一盏灯', palette: { battery: 1, lamp: 1, spdt: 2 },
    preset: () => createCircuit(), initProgress: noProgress,
    check(progress, ws) {
      const br = brokenSet(ws.damage);
      const sw = ofType(ws.circuit, 'spdt');
      const lamps = ofType(ws.circuit, 'lamp');
      for (let i = 0; i < sw.length; i++) for (let j = i + 1; j < sw.length; j++) {
        const s1 = sw[i].id, s2 = sw[j].id;
        const table = {};
        let valid = true;
        for (const t1 of ['a', 'b']) for (const t2 of ['a', 'b']) {
          const r = solve(withParams(ws.circuit, { [s1]: { to: t1 }, [s2]: { to: t2 } }), br);
          if (!r.ok) valid = false;
          table[t1 + t2] = r;
        }
        if (!valid) continue;
        const flip = t => (t === 'a' ? 'b' : 'a');
        for (const l of lamps) {
          const lit = k => lampLit(table[k], br, l.id);
          const ok = ['aa', 'ab', 'ba', 'bb'].every(k =>
            lit(k) !== lit(flip(k[0]) + k[1]) && lit(k) !== lit(k[0] + flip(k[1])));
          if (ok) return result(true, progress);
        }
      }
      return result(false, progress);
    },
  },
  faultTask({
    id: 23, chapter: 5, name: '失灵的开关', goal: '楼梯灯有时不亮，找出哪个开关坏了',
    palette: { voltmeter: 1 }, variants: ['S1.a', 'S1.b', 'S2.a', 'S2.b'], preset: stairsPreset, suspect: { types: ['spdt'], name: '开关' },
  }),
  {
    id: 26, chapter: 5, name: '红绿灯', goal: '拨一下开关，两盏 LED 换着亮', palette: { battery: 2, resistor: 1, spdt: 1, led: 2 },
    preset: () => createCircuit(), initProgress: noProgress,
    check(progress, ws) {
      const br = brokenSet(ws.damage);
      const leds = ofType(ws.circuit, 'led');
      for (const s of ofType(ws.circuit, 'spdt')) {
        const lit = [];
        for (const to of ['a', 'b']) {
          const r = solve(withParams(ws.circuit, { [s.id]: { to } }), br);
          // 拨过去会烧坏的 LED 不算数：判定只解电路，不会真的记下损坏。
          const safe = r.ok && leds.every(d => !(r.parts[d.id]?.i >= PHYS.LED_BURN_A));
          lit.push(safe ? leds.filter(d => ledLit(r, br, d.id)).map(d => d.id) : null);
        }
        const [x, y] = lit;
        if (x?.length === 1 && y?.length === 1 && x[0] !== y[0]) return result(true, progress);
      }
      return result(false, progress);
    },
  },
  {
    id: 27, chapter: 5, name: '两档风扇', goal: '总开关管通断，另一个开关拨一下换快慢档',
    palette: { battery: 1, switch: 1, spdt: 1, resistor: 1, motor: 1 }, defaults: { battery: { cells: 2 } },
    preset: () => createCircuit(), initProgress: noProgress,
    check(progress, ws) {
      const br = brokenSet(ws.damage);
      const motors = ofType(ws.circuit, 'motor');
      for (const s of ofType(ws.circuit, 'switch')) for (const d of ofType(ws.circuit, 'spdt')) {
        const at = (closed, to) => solve(withParams(ws.circuit, { [s.id]: { closed }, [d.id]: { to } }), br);
        const off = ['a', 'b'].map(to => at(false, to));
        const on = ['a', 'b'].map(to => at(true, to));
        if (![...off, ...on].every(r => r.ok)) continue;
        for (const m of motors) {
          if (off.some(r => motorOn(r, br, m.id)) || !on.every(r => motorOn(r, br, m.id))) continue;
          const v = on.map(r => Math.abs(r.parts[m.id].v));
          if (Math.max(...v) >= 2 * Math.min(...v)) return result(true, progress);
        }
      }
      return result(false, progress);
    },
  },
  {
    id: 25, chapter: 5, name: '保险丝救场', goal: '用保险丝保护短路的电池', palette: { fuse: 1 },
    preset: () => presetCircuit([['B', 'battery', 9, 12], ['L', 'lamp', 9, 5]], [['B.p', 'L.a'], ['L.b', 'B.n'], ['B.p', 'B.n']]),
    initProgress: () => ({ pre: null }),
    check(progress, ws) {
      const f = ofType(ws.circuit, 'fuse')[0];
      const b = ofType(ws.circuit, 'battery')[0];
      if (!f || !b) return result(false, progress);
      let pre = progress.pre;
      for (const r of ws.trail) {
        if (r.brokenKey.split(',').includes(f.id)) continue;
        if (!r.parts[f.id] || !r.parts[b.id]) continue;
        pre = { iFuse: Math.abs(r.parts[f.id].i), iBatt: Math.abs(r.parts[b.id].i) };
      }
      const next = pre === progress.pre ? progress : { pre };
      const blown = !!ws.damage.broken[f.id];
      const iNow = Math.abs(ws.result.parts[b.id]?.i ?? Infinity);
      const passed = blown && iNow < PHYS.SHORT_A && !!pre &&
        Math.abs(pre.iFuse - pre.iBatt) <= 0.05 * pre.iBatt && pre.iFuse > PHYS.SHORT_A;
      return result(passed, next);
    },
  },
  {
    id: 28, chapter: 5, name: '防盗报警', goal: '门关着时蜂鸣器不响，门一打开就响',
    palette: { battery: 1, switch: 1, buzzer: 1, resistor: 1 }, defaults: { battery: { cells: 2 } },
    preset: () => createCircuit(), initProgress: noProgress,
    check(progress, ws) {
      const br = brokenSet(ws.damage);
      const batt = ofType(ws.circuit, 'battery')[0];
      const buzzers = ofType(ws.circuit, 'buzzer');
      if (!batt) return result(false, progress);
      for (const s of ofType(ws.circuit, 'switch')) {
        const closed = solve(withParams(ws.circuit, { [s.id]: { closed: true } }), br);
        const open = solve(withParams(ws.circuit, { [s.id]: { closed: false } }), br);
        if (!closed.ok || !open.ok || !(Math.abs(closed.parts[batt.id]?.i ?? Infinity) < PHYS.SHORT_A)) continue;
        if (buzzers.some(z => !buzzerOn(closed, br, z.id) && buzzerOn(open, br, z.id))) return result(true, progress);
      }
      return result(false, progress);
    },
  },
];
