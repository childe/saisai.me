/** 选择题的干扰项抽取。纯函数，rng 可注入以便测试。 */

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 按优先级凑够 count 个干扰项：
 *   1. 同一基础韵母的其他声调
 *   2. confusions 列出的同伴的各声调
 *   3. 同组内其余条目
 * 候选不足时返回实际能给的数量，绝不重复、绝不含正确答案。
 */
export function pickDistractors(target, pool, confusions, count, rng = Math.random) {
  const taken = new Set([target.id]);
  const shown = new Set([target.display]);
  const out = [];

  const add = (candidates) => {
    for (const c of shuffle(candidates, rng)) {
      if (out.length >= count) return;
      if (taken.has(c.id) || shown.has(c.display)) continue;
      taken.add(c.id);
      shown.add(c.display);
      out.push(c);
    }
  };

  const base = target.base || target.id;

  // 1. 同族其他声调
  add(pool.filter((p) => (p.base || p.id) === base));

  // 2. confusions 同伴
  const peers = new Set(confusions[base] || []);
  add(pool.filter((p) => peers.has(p.base || p.id)));

  // 3. 同组兜底
  add(pool.filter((p) => p.group === target.group));

  return out;
}

/** 组装一道题。候选不足时缩减选项数，而不是塞重复项。 */
export function buildQuestion(target, pool, confusions, optionCount, rng = Math.random) {
  const distractors = pickDistractors(target, pool, confusions, optionCount - 1, rng);
  return { target, options: shuffle([target, ...distractors], rng) };
}
