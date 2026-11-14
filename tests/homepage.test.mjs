import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function cards() {
  const out = [];
  const re = /<a class="card"([^>]*)>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const body = m[2];
    const pick = (r) => { const x = body.match(r); return x ? x[1].trim() : ''; };
    out.push({
      tool: (attrs.match(/data-tool="([^"]*)"/) || [])[1],
      href: (attrs.match(/href="([^"]*)"/) || [])[1],
      title: pick(/<span class="card-title">([\s\S]*?)<\/span>/),
      desc: pick(/<span class="card-desc">([\s\S]*?)<\/span>/),
      svg: (body.match(/<svg[\s\S]*?<\/svg>/) || [''])[0],
    });
  }
  return out;
}

function visibleText() {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]*>/g, ' ');
}

function mediaBlock(query) {
  const start = html.indexOf(`@media ${query} {`);
  if (start < 0) return '';
  let i = html.indexOf('{', start) + 1;
  const begin = i;
  let depth = 1;
  for (; i < html.length && depth > 0; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') depth--;
  }
  return html.slice(begin, i - 1);
}

const EXPECTED = [
  ['pinyin',   'pinyin/index.html',                '学拼音'],
  ['english',  'english-audio/index.html',         '英语听力'],
  ['equation', 'solve-equation/index.html',        '解方程'],
  ['plotter',  'x-y-line/coordinate-plotter.html', '坐标绘图器'],
  ['maze',     'maze-gen/maze.html',               '迷宫生成器'],
  ['jump',     'tiao-yi-tiao/game.html',           '跳一跳'],
  ['maze3d',   'maze-3d/index.html',               '3D 迷宫'],
  ['circuit',  'circuit/index.html',              '电路实验室'],
  ['sudoku',   'sudoku/index.html',               '数独'],
];

test('viewport meta kept', () => {
  assert.match(html, /<meta\s+name="viewport"\s+content="width=device-width,\s*initial-scale=1(\.0)?"/);
});

test('lang and title', () => {
  assert.match(html, /<html[^>]*lang="zh-CN"/);
  assert.match(html, /<title>赛赛的工具箱<\/title>/);
  assert.match(html, /<h1[^>]*>[\s\S]*赛赛的工具箱[\s\S]*<\/h1>/);
});

test('nine cards in order with fixed links and titles', () => {
  const c = cards();
  assert.equal(c.length, 9);
  assert.deepEqual(c.map(x => [x.tool, x.href, x.title]), EXPECTED);
});

test('cards have the agreed descriptions', () => {
  assert.deepEqual(cards().map(x => x.desc), [
    '声母 韵母 四声调', '一年级上册', '一元一次方程求解',
    '描点 连成线', '从起点走到终点', '按住蓄力 跳过去',
    '立体迷宫 走出去', '连电线 点亮小灯', '学技巧 练推理',
  ]);
});

test('every card has an aria-hidden svg', () => {
  for (const c of cards()) assert.match(c.svg, /^<svg[^>]*aria-hidden="true"/);
});

test('no folder/file icons or english dir names in visible text', () => {
  assert.doesNotMatch(html, /📁|📄/);
  const t = visibleText();
  for (const n of ['x-y-line','maze-gen','jump-game','solve-equation','english-audio','pinyin','tiao-yi-tiao','maze-3d'])
    assert.ok(!t.includes(n), n);
});

test('no external requests and no script', () => {
  const h = html.replace(/xmlns(:\w+)?="http:\/\/www\.w3\.org\/[^"]*"/g, '');
  assert.doesNotMatch(h, /https?:\/\//);
  assert.doesNotMatch(h, /(src|href)="\/\//);
  assert.doesNotMatch(h, /<script|<link|<img|<iframe|@import|@font-face/i);
  assert.doesNotMatch(h, /url\(\s*['"]?(https?:)?\/\//);
});

test('system font stack', () => {
  assert.match(html, /font-family:[^;]*"PingFang SC"[^;]*"Microsoft YaHei"[^;]*sans-serif/);
});

test('breakpoints 900 and 360', () => {
  assert.match(html, /grid-template-columns:\s*repeat\(3,/);
  assert.match(mediaBlock('(max-width: 899px)'), /grid-template-columns:\s*repeat\(2,/);
  assert.match(mediaBlock('(max-width: 359px)'), /grid-template-columns:\s*(1fr\s*[;}]|repeat\(1,)/);
});
// 实际列数以浏览器核对脚本的 cols= 为准（Task 3 Step 5）。

test('grid items can shrink', () => {
  assert.match(html, /\.card\s*\{[^}]*min-width:\s*0/);
  assert.match(html, /\.card-title\s*\{[^}]*font-size:\s*clamp\(/);
});

test('hover effect is gated by hover media query', () => {
  assert.match(html, /@media\s*\(hover:\s*hover\)[^{]*\{[^}]*\.card:hover/);
  assert.match(html, /\.card:active/);
});

test('focus-visible outline exists', () => {
  assert.match(html, /\.card:focus-visible\s*\{[^}]*outline:\s*[1-9]/);
});

test('reduced motion disables transitions', () => {
  assert.match(html, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?(transition:\s*none|transition-duration:\s*0)/);
});

test('no dark mode', () => {
  assert.doesNotMatch(html, /prefers-color-scheme/);
});

const svgOf = tool => cards().find(c => c.tool === tool).svg;
const shapeCount = s => (s.match(/<(path|rect|circle|ellipse|line|polyline|polygon|text)\b/g) || []).length;

test('every svg has viewBox and no fixed size', () => {
  for (const c of cards()) {
    assert.match(c.svg, /^<svg[^>]*viewBox="0 0 200 150"/);
    assert.doesNotMatch(c.svg.match(/^<svg[^>]*>/)[0], /\s(width|height)="/);
  }
});

test('pinyin art shows tone-marked letters', () => {
  const s = svgOf('pinyin');
  for (const ch of ['ā', 'á', 'ǎ', 'à']) assert.ok(s.includes(ch), ch);
  assert.ok(shapeCount(s) >= 5);
});

test('english art shows headphones and ABC', () => {
  const s = svgOf('english');
  assert.match(s, /ABC|>A<[\s\S]*>B<[\s\S]*>C</);
  assert.ok(shapeCount(s) >= 6);
});

test('equation art shows x = ?', () => {
  const s = svgOf('equation');
  assert.match(s, /x\s*(=|＝)\s*\?|x\s*(=|＝)\s*？/);
  assert.ok(shapeCount(s) >= 5);
});

test('maze3d art is isometric', () => {
  const s = svgOf('maze3d');
  assert.ok((s.match(/<polygon\b/g) || []).length >= 6);
  assert.ok(shapeCount(s) >= 8);
});

test('sudoku art shows a grid with bold box lines and digits', () => {
  const s = svgOf('sudoku');
  assert.ok((s.match(/<text\b/g) || []).length >= 3);
  assert.ok((s.match(/<line\b/g) || []).length >= 6);
  assert.ok(shapeCount(s) >= 10);
});

test('no placeholder-only svg remains', () => {
  for (const c of cards()) assert.ok(shapeCount(c.svg) >= 5, c.tool);
});

const hexLum = hex => {
  const v = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [hexLum(a), hexLum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

test('card titles use a fixed dark text color with >= 4.5:1 contrast on white', () => {
  const rule = html.match(/\.card-title\s*\{([^}]*)\}/)[1];
  const m = rule.match(/(?:^|[\s;])color:\s*(#[0-9a-fA-F]{6})\s*;/);
  assert.ok(m, 'card-title color must be a literal hex, not var(--accent)');
  assert.ok(contrast(m[1], '#ffffff') >= 4.5, `contrast ${contrast(m[1], '#ffffff').toFixed(2)}`);
});

// 把只含 M/H/V 的 path 拆成轴对齐线段
function segments(d) {
  const segs = [];
  let x = 0, y = 0;
  for (const [, cmd, nums] of d.matchAll(/([MHV])\s*([-\d.\s,]+)/g)) {
    const n = nums.trim().split(/[\s,]+/).map(Number);
    if (cmd === 'M') { [x, y] = n; continue; }
    const [nx, ny] = cmd === 'H' ? [n[0], y] : [x, n[0]];
    segs.push([x, y, nx, ny]);
    [x, y] = [nx, ny];
  }
  return segs;
}

test('maze dashed solution path never crosses a wall', () => {
  const s = svgOf('maze');
  const sol = s.match(/<path d="([^"]*)"[^>]*stroke-dasharray/);
  if (!sol) return; // 虚线路径可选
  const walls = [...s.match(/<g[^>]*>([\s\S]*?)<\/g>/)[1].matchAll(/<path d="([^"]*)"/g)]
    .flatMap(m => segments(m[1]));
  const within = (v, a, b) => v >= Math.min(a, b) && v <= Math.max(a, b);
  for (const p of segments(sol[1])) {
    for (const w of walls) {
      const pH = p[1] === p[3], wH = w[1] === w[3];
      if (pH === wH) continue;
      const [h, v] = pH ? [p, w] : [w, p];
      assert.ok(!(within(v[0], h[0], h[2]) && within(h[1], v[1], v[3])),
        `solution ${p} crosses wall ${w}`);
    }
  }
});
