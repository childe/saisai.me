// 盘面几何、解析与候选计算。格子编号 cell = row * size + col。
const cache = new Map();

export function getSpec(size) {
  if (size !== 6 && size !== 9) throw new Error(`unsupported size ${size}`);
  if (cache.has(size)) return cache.get(size);
  const boxRows = size === 6 ? 2 : 3;
  const boxCols = 3;
  const cells = size * size;
  const units = [];
  for (let r = 0; r < size; r++) {
    units.push({ kind: 'row', index: r, cells: Array.from({ length: size }, (_, c) => r * size + c) });
  }
  for (let c = 0; c < size; c++) {
    units.push({ kind: 'col', index: c, cells: Array.from({ length: size }, (_, r) => r * size + c) });
  }
  const boxesPerRow = size / boxCols;
  const boxCount = size;
  for (let b = 0; b < boxCount; b++) {
    const r0 = Math.floor(b / boxesPerRow) * boxRows;
    const c0 = (b % boxesPerRow) * boxCols;
    const cs = [];
    for (let r = 0; r < boxRows; r++) for (let c = 0; c < boxCols; c++) cs.push((r0 + r) * size + c0 + c);
    units.push({ kind: 'box', index: b, cells: cs });
  }
  const unitsOf = Array.from({ length: cells }, () => []);
  units.forEach((u, i) => u.cells.forEach(cell => unitsOf[cell].push(i)));
  const peers = unitsOf.map((us, cell) => {
    const set = new Set();
    for (const i of us) for (const p of units[i].cells) if (p !== cell) set.add(p);
    return [...set].sort((a, b) => a - b);
  });
  const spec = { size, boxRows, boxCols, cells, units, unitsOf, peers };
  cache.set(size, spec);
  return spec;
}

export function parse(str) {
  return [...str].map(ch => (ch === '.' ? 0 : Number(ch)));
}

export function format(values) {
  return values.map(v => (v === 0 ? '.' : String(v))).join('');
}

// 每格候选位掩码（第 d 位表示数字 d）；已填格为 0
export function candidates(values, spec, eliminated = new Set()) {
  const full = ((1 << (spec.size + 1)) - 1) & ~1;
  return values.map((v, cell) => {
    if (v) return 0;
    let mask = full;
    for (const p of spec.peers[cell]) if (values[p]) mask &= ~(1 << values[p]);
    for (let d = 1; d <= spec.size; d++) if (eliminated.has(`${cell}:${d}`)) mask &= ~(1 << d);
    return mask;
  });
}

export function bits(mask) {
  const out = [];
  for (let d = 1; mask >> d; d++) if (mask & (1 << d)) out.push(d);
  return out;
}
