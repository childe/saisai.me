// 第 6 章：挑战。
import { PHYS } from '../parts.js';
import { solve } from '../solve.js';
import { brokenSet } from '../damage.js';
import { createCircuit } from '../circuit.js';
import { lampLit, ledLit, motorOn, buzzerOn, withParams, ofType, result, noProgress, anySwitchPair, truth, presetCircuit } from '../task-kit.js';

export const CH6 = [
  {
    id: 24, chapter: 6, name: '楼梯灯', goal: '楼上楼下都能开关同一盏灯', palette: { battery: 1, lamp: 1, spdt: 2 },
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
  {
    id: 25, chapter: 6, name: '保险丝救场', goal: '用保险丝保护短路的电池', palette: { fuse: 1 },
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
    id: 26, chapter: 6, name: '红绿灯', goal: '拨一下开关，两盏 LED 换着亮', palette: { battery: 2, resistor: 1, spdt: 1, led: 2 },
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
    id: 27, chapter: 6, name: '两档风扇', goal: '总开关管通断，另一个开关拨一下换快慢档',
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
    id: 28, chapter: 6, name: '防盗报警', goal: '门关着时蜂鸣器不响，门一打开就响',
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
  {
    id: 29, chapter: 6, name: '风扇和灯', goal: '一个开关管灯，另一个开关管风扇', palette: { battery: 1, lamp: 1, motor: 1, switch: 2 },
    preset: () => createCircuit(), initProgress: noProgress,
    check(progress, ws) {
      const lamps = ofType(ws.circuit, 'lamp');
      const motors = ofType(ws.circuit, 'motor');
      return result(anySwitchPair(ws, (t, br) =>
        lamps.some(l => truth(k => lampLit(t[k], br, l.id), ['tt', 'tf'])) &&
        motors.some(m => truth(k => motorOn(t[k], br, m.id), ['tt', 'ft']))), progress);
    },
  },
];
