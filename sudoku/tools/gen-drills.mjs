// 生成技巧小题题库 sudoku/data/drills.js：node sudoku/tools/gen-drills.mjs
// 每组（章 × 尺寸）拆成若干分片，每个分片有固定种子和固定成功数，由 worker 并行跑；
// 结果按分片编号合并，所以输出与机器快慢、调度顺序无关。
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rng } from '../lib/generate.js';
import { makeDrill } from '../lib/drill-gen.js';

const SEED = 20261114;
const VARIANTS = 4;
const SIZES = [6, 6, 6, 9, 9, 9, 9, 9];
// 放宽级别来自实测（见提交信息）：
// 唯一余数 6×6 至少要 12 个空格才可能开局没有排除法可用；
// 区块、数对 6×6 用第 1 级放宽（空格上限 16），无需换成 9×9。
const CHAPTERS = [
  { id: 'hidden', name: '排除法', maxEmpty: { 6: 10, 9: 20 }, relax: '无' },
  { id: 'naked', name: '唯一余数', maxEmpty: { 6: 12, 9: 20 }, relax: '无（6×6 空格上限 12）' },
  { id: 'locked', name: '区块', maxEmpty: { 6: 16, 9: 20 }, relax: '第 1 级：6×6 空格上限 16' },
  { id: 'pair', name: '数对', maxEmpty: { 6: 16, 9: 20 }, relax: '第 1 级：6×6 空格上限 16' },
];
const slow = id => id === 'locked' || id === 'pair';

function runShard({ size, technique, maxEmpty, seed, count, fillTries }) {
  const random = rng(seed);
  const out = [];
  let tries = 0;
  while (out.length < count) {
    tries++;
    const d = makeDrill(size, technique, random, { maxEmpty, fillTries });
    if (d) out.push(d);
  }
  return { drills: out, tries };
}

if (!isMainThread) {
  parentPort.on('message', task => parentPort.postMessage({ id: task.id, ...runShard(task) }));
} else {
  const t0 = Date.now();
  const groups = [];
  const tasks = [];
  CHAPTERS.forEach((ch, ci) => {
    for (const size of [6, 9]) {
      const need = SIZES.filter(s => s === size).length * VARIANTS;
      // 慢的组每片只要 1 题，便于均衡分摊；快的组多生成一倍候选再挑
      const want = slow(ch.id) ? need + 2 : need * 2;
      const per = slow(ch.id) ? 1 : want;
      const g = { ch, size, need, shards: [] };
      for (let k = 0; k * per < want; k++) {
        const id = tasks.length;
        g.shards.push(id);
        tasks.push({
          id, size, technique: ch.id, maxEmpty: ch.maxEmpty[size],
          seed: SEED + ci * 100003 + size * 1009 + k * 7919, count: per, fillTries: slow(ch.id) ? 3 : 1,
        });
      }
      groups.push(g);
    }
  });

  const results = new Array(tasks.length);
  const queue = tasks.slice().sort((a, b) => b.size - a.size || (slow(b.technique) - slow(a.technique)));
  const nWorkers = Math.min(availableParallelism(), queue.length);
  await new Promise((resolve, reject) => {
    let done = 0;
    for (let w = 0; w < nWorkers; w++) {
      const worker = new Worker(fileURLToPath(import.meta.url));
      const feed = () => (queue.length ? worker.postMessage(queue.shift()) : worker.terminate());
      worker.on('message', msg => {
        results[msg.id] = msg;
        if (++done === tasks.length) resolve();
        feed();
      });
      worker.on('error', reject);
      feed();
    }
  });

  const empties = s => [...s].filter(x => x === '.').length;
  const seen = new Set();
  const chapters = CHAPTERS.map(ch => ({ id: ch.id, name: ch.name, slots: [] }));
  for (const g of groups) {
    const pool = [];
    let tries = 0;
    for (const id of g.shards) {
      tries += results[id].tries;
      for (const d of results[id].drills) if (!seen.has(d.puzzle)) { seen.add(d.puzzle); pool.push(d); }
    }
    if (pool.length < g.need) throw new Error(`${g.ch.id} ${g.size}: only ${pool.length} drills`);
    pool.sort((a, b) => a.uses - b.uses || empties(a.puzzle) - empties(b.puzzle) || (a.puzzle < b.puzzle ? -1 : 1));
    // 从排好序的候选里等距挑 need 个，再按顺序每 4 个分成一个题位
    const picked = Array.from({ length: g.need }, (_, i) => pool[Math.floor((i * pool.length) / g.need)]);
    const ch = chapters.find(c => c.id === g.ch.id);
    for (let i = 0; i < picked.length; i += VARIANTS) ch.slots.push(picked.slice(i, i + VARIANTS));
    const e = picked.map(d => empties(d.puzzle)), u = picked.map(d => d.uses);
    console.log(
      `${g.ch.name}(${g.ch.id}) ${g.size}×${g.size}: 候选 ${pool.length}/${tries} 次尝试，` +
        `空格 ${Math.min(...e)}–${Math.max(...e)}，本章技巧次数 ${Math.min(...u)}–${Math.max(...u)}`,
    );
  }
  for (const ch of CHAPTERS) console.log(`${ch.name}：放宽 ${ch.relax}`);

  const lines = ['// 由 tools/gen-drills.mjs 生成，勿手改', 'export const CHAPTERS = ['];
  for (const ch of chapters) {
    lines.push(`  { id: '${ch.id}', name: '${ch.name}', slots: [`);
    for (const slot of ch.slots) {
      lines.push('    [');
      for (const d of slot) {
        const size = Math.sqrt(d.puzzle.length);
        lines.push(`      { size: ${size}, puzzle: '${d.puzzle}', solution: '${d.solution}' },`);
      }
      lines.push('    ],');
    }
    lines.push('  ] },');
  }
  lines.push('];', '');
  writeFileSync(new URL('../data/drills.js', import.meta.url), lines.join('\n'));
  console.log(`写出 sudoku/data/drills.js，用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
}
