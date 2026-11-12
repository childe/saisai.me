// 10 个小任务：元件栏、预置电路、按物理结果判定。
import { PHYS } from './parts.js';
import { solve } from './solve.js';
import { brokenSet } from './damage.js';
import { createCircuit, addPart, addWire, cloneCircuit } from './circuit.js';

export function lampLit(result, broken, id) {
  const r = result?.parts?.[id];
  return !!r && !broken.has(id) && r.p >= PHYS.LAMP_LIT_P;
}

export function ledLit(result, broken, id) {
  const r = result?.parts?.[id];
  return !!r && !broken.has(id) && r.i >= PHYS.LED_LIT_A;
}

export function withParams(circuit, changes) {
  const c = cloneCircuit(circuit);
  for (const p of c.parts) if (changes[p.id]) Object.assign(p.params, changes[p.id]);
  return c;
}

const ofType = (c, type) => c.parts.filter(p => p.type === type);
const result = (passed, progress, hint = null) => ({ progress, passed, hint });
const noProgress = () => ({});

// 用给定元件和导线搭一个预置电路，全部元件标 preset。
function presetCircuit(parts, wires) {
  let c = createCircuit();
  const ids = {};
  for (const [name, type, x, y] of parts) {
    const r = addPart(c, type, x, y);
    c = r.circuit;
    ids[name] = r.id;
  }
  c = { ...c, parts: c.parts.map(p => ({ ...p, preset: true })) };
  for (const [a, b] of wires) {
    const [pa, ta] = a.split('.'), [pb, tb] = b.split('.');
    c = addWire(c, { part: ids[pa], term: ta }, { part: ids[pb], term: tb }).circuit;
  }
  return c;
}

const HINT3 = '试试另一种接法，亮度有什么不同？';

export const TASKS = [
  {
    id: 1, name: '点亮一盏灯', goal: '让灯亮起来', palette: { battery: 1, lamp: 1 },
    preset: createCircuit, initProgress: noProgress,
    check(progress, ws) {
      const br = brokenSet(ws.damage);
      return result(ofType(ws.circuit, 'lamp').some(l => lampLit(ws.result, br, l.id)), progress);
    },
  },
  {
    id: 2, name: '加个开关', goal: '用开关控制灯', palette: { battery: 1, lamp: 1, switch: 1 },
    preset: createCircuit, initProgress: noProgress,
    check(progress, ws) {
      const br = brokenSet(ws.damage);
      const lamps = ofType(ws.circuit, 'lamp');
      for (const s of ofType(ws.circuit, 'switch')) {
        const on = solve(withParams(ws.circuit, { [s.id]: { closed: true } }), br);
        const off = solve(withParams(ws.circuit, { [s.id]: { closed: false } }), br);
        if (!on.ok || !off.ok) continue;
        if (lamps.some(l => lampLit(on, br, l.id) && !lampLit(off, br, l.id))) return result(true, progress);
      }
      return result(false, progress);
    },
  },
  {
    id: 3, name: '串联和并联', goal: '两种接法都试，比一比亮度', palette: { battery: 1, lamp: 2 },
    defaults: { battery: { cells: 2 } }, locked: { battery: ['cells'] },
    preset: createCircuit, initProgress: () => ({ first: null }),
    check(progress, ws) {
      const br = brokenSet(ws.damage);
      const lamps = ofType(ws.circuit, 'lamp');
      const bothLit = lamps.length >= 2 && lamps.every(l => lampLit(ws.result, br, l.id));
      const hint = progress.first ? HINT3 : null;
      if (!bothLit) return result(false, progress, hint);
      const powers = Object.fromEntries(lamps.map(l => [l.id, ws.result.parts[l.id].p]));
      if (!progress.first) return result(false, { first: { topoRev: ws.result.topoRev, powers } }, HINT3);
      if (ws.result.topoRev === progress.first.topoRev) return result(false, progress, HINT3);
      const now = Object.values(powers).sort((a, b) => a - b);
      const before = Object.values(progress.first.powers).sort((a, b) => a - b);
      if (now.length !== before.length) return result(false, progress, HINT3);
      const differ = now.every((p, i) => Math.max(p, before[i]) / Math.min(p, before[i]) >= 2);
      return result(differ, progress, differ ? null : HINT3);
    },
  },
  {
    id: 4, name: '一个亮一个灭', goal: '一个开关只控制其中一个灯', palette: { battery: 1, lamp: 2, switch: 1 },
    preset: createCircuit, initProgress: noProgress,
    check(progress, ws) {
      const br = brokenSet(ws.damage);
      const lamps = ofType(ws.circuit, 'lamp');
      if (lamps.length < 2) return result(false, progress);
      for (const s of ofType(ws.circuit, 'switch')) {
        const on = solve(withParams(ws.circuit, { [s.id]: { closed: true } }), br);
        const off = solve(withParams(ws.circuit, { [s.id]: { closed: false } }), br);
        if (!on.ok || !off.ok) continue;
        const litOff = lamps.filter(l => lampLit(off, br, l.id)).length;
        const allOn = lamps.every(l => lampLit(on, br, l.id));
        if (litOff === 1 && allOn) return result(true, progress);
      }
      return result(false, progress);
    },
  },
  {
    id: 5, name: '让 LED 亮起来', goal: '点亮 LED，别烧坏它', palette: { battery: 2, led: 1, resistor: 1 },
    preset: createCircuit, initProgress: noProgress,
    check(progress, ws) {
      const br = brokenSet(ws.damage);
      return result(ofType(ws.circuit, 'led').some(d => ledLit(ws.result, br, d.id)), progress);
    },
  },
  {
    id: 6, name: '调光台灯', goal: '用变阻器调灯的亮度', palette: { battery: 1, lamp: 1, rheostat: 1 },
    preset: createCircuit, initProgress: noProgress,
    check(progress, ws) {
      const br = brokenSet(ws.damage);
      const lamps = ofType(ws.circuit, 'lamp').filter(l => !br.has(l.id));
      for (const r of ofType(ws.circuit, 'rheostat')) {
        const lo = solve(withParams(ws.circuit, { [r.id]: { pos: 0 } }), br);
        const hi = solve(withParams(ws.circuit, { [r.id]: { pos: 1 } }), br);
        if (!lo.ok || !hi.ok) continue;
        for (const l of lamps) {
          const a = lo.parts[l.id].p, b = hi.parts[l.id].p;
          if (a > 1e-4 && b > 1e-4 && Math.max(a, b) >= 2 * Math.min(a, b)) return result(true, progress);
        }
      }
      return result(false, progress);
    },
  },
  {
    id: 7, name: '让风扇反转', goal: '让风扇反着转', palette: {},
    preset: () => presetCircuit([['B', 'battery', 6, 8], ['M', 'motor', 14, 8]], [['B.p', 'M.a'], ['M.b', 'B.n']]),
    initProgress: noProgress,
    check(progress, ws) {
      return result(ofType(ws.circuit, 'motor').some(m => ws.result.parts[m.id]?.v < -0.5), progress);
    },
  },
  {
    id: 8, name: '楼梯灯', goal: '楼上楼下都能开关同一盏灯', palette: { battery: 1, lamp: 1, spdt: 2 },
    preset: createCircuit, initProgress: noProgress,
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
    id: 9, name: '量一量', goal: '测出灯泡的电流和电压', palette: { battery: 1, lamp: 1, ammeter: 1, voltmeter: 1 },
    preset: createCircuit, initProgress: noProgress,
    check(progress, ws) {
      const br = brokenSet(ws.damage);
      const P = ws.result.parts;
      for (const l of ofType(ws.circuit, 'lamp')) {
        if (!lampLit(ws.result, br, l.id)) continue;
        const li = Math.abs(P[l.id].i), lv = Math.abs(P[l.id].v);
        for (const a of ofType(ws.circuit, 'ammeter')) for (const v of ofType(ws.circuit, 'voltmeter')) {
          const ai = Math.abs(P[a.id].i), vv = Math.abs(P[v.id].v);
          if (ai >= 0.01 && vv >= 0.1 && Math.abs(ai - li) <= 0.05 * li && Math.abs(vv - lv) <= 0.05 * lv) {
            return result(true, progress);
          }
        }
      }
      return result(false, progress);
    },
  },
  {
    id: 10, name: '保险丝救场', goal: '用保险丝保护短路的电池', palette: { fuse: 1 },
    preset: () => presetCircuit([['B', 'battery', 6, 8], ['L', 'lamp', 14, 8]], [['B.p', 'L.a'], ['L.b', 'B.n'], ['B.p', 'B.n']]),
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
];

export function evaluateTask(task, progress, ws) {
  if (!ws.result.ok) return { progress, passed: false, hint: null };
  return task.check(progress, ws);
}

export function remainingPalette(task, circuit) {
  const out = {};
  for (const [type, n] of Object.entries(task.palette)) {
    const used = circuit.parts.filter(p => p.type === type && !p.preset).length;
    out[type] = Math.max(0, n - used);
  }
  return out;
}
