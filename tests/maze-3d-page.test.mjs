import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'maze-3d');
const read = (name) => readFileSync(join(dir, name), 'utf8');
const OWN = [
  'index.html',
  'main.js',
  'maze-core.js',
  'game-logic.js',
  'themes.js',
  'wall-geometry.js',
  'movement.js',
  'effects.js',
  'gameplay.js',
  'README.md',
];

test('no external references', () => {
  for (const name of OWN) {
    const src = read(name);
    assert.doesNotMatch(src, /https?:\/\//, name);
    assert.doesNotMatch(src, /(src|href)\s*=\s*["']\/\//, name);
    assert.doesNotMatch(src, /from\s*['"]\/\//, name);
    assert.doesNotMatch(src, /import\(\s*['"](https?:)?\/\//, name);
    assert.doesNotMatch(src, /url\(\s*['"]?(https?:)?\/\//, name);
  }
  const specifiers = (src) => {
    const out = [];
    for (const m of src.matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
    for (const m of src.matchAll(/import\(\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
    return out;
  };
  const mod = specifiers(read('vendor/three.module.js'));
  assert.ok(mod.length >= 1, 'three.module.js should import three.core.js');
  for (const s of mod) assert.equal(s, './three.core.js');
  assert.deepEqual(specifiers(read('vendor/three.core.js')), []);
});

test('vendor three r187', () => {
  assert.match(read('vendor/three.core.js'), /REVISION\s*=\s*['"]187['"]/);
  assert.ok(existsSync(join(dir, 'vendor', 'LICENSE')));
  assert.match(read('vendor/LICENSE'), /MIT/);
  assert.match(read('main.js'), /from\s*['"]\.\/vendor\/three\.module\.js['"]/);
});

test('page has all controls', () => {
  const html = read('index.html');
  const needles = [
    'id="size-10"',
    'id="size-15"',
    'id="size-20"',
    'id="view-btn"',
    'id="fog-btn"',
    'id="regen-btn"',
    'id="show-path-btn"',
    'id="hide-path-btn"',
    'id="win"',
    '恭喜！你成功走出了迷宫！',
    '再来一局',
    '<title>3D 迷宫</title>',
    '<script type="module" src="main.js">',
  ];
  for (const n of needles) assert.ok(html.includes(n), n);
  assert.match(html, /id="fog-minus"[^>]*>−</);
  assert.match(html, /id="fog-plus"[^>]*>\+</);
  for (const name of OWN) assert.ok(!read(name).includes('alert('), name);
  assert.ok(!html.includes('class="dpad"'));
});

test('webgl fallback', () => {
  const html = read('index.html');
  assert.ok(html.includes('这个设备不支持 3D，可以玩 2D 迷宫'));
  assert.ok(html.includes('href="../maze-gen/maze.html"'));
  assert.ok(read('main.js').includes('no-webgl'));
});

test('stage disables touch gestures', () => {
  const m = read('index.html').match(/#stage\s*\{([^}]*)\}/);
  assert.ok(m, '#stage rule');
  assert.match(m[1], /touch-action\s*:\s*none/);
});

test('main uses shared size constants', () => {
  const src = read('main.js');
  const m = src.match(/import\s*\{([^}]*)\}\s*from\s*['"]\.\/movement\.js['"]/);
  assert.ok(m, 'imports ./movement.js');
  for (const name of ['WALL_LENGTH', 'WALL_HEIGHT', 'WALL_THICKNESS', 'PLAYER_RADIUS']) {
    assert.match(m[1], new RegExp(`\\b${name}\\b`), name);
  }
  assert.ok(!src.includes('BoxGeometry(1.1'));
});

test('viewport meta', () => {
  assert.ok(
    read('index.html').includes(
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
    ),
  );
});

test('theme buttons', () => {
  const html = read('index.html');
  const ids = ['garden', 'brick', 'blocks', 'castle'];
  const labels = ['🌳 花园', '🧱 砖墙', '🧸 积木', '🏰 城堡'];
  const last = html.indexOf('id="view-row"');
  assert.ok(last > 0);
  const rowAt = html.indexOf('id="theme-row"');
  assert.ok(rowAt > last);
  ids.forEach((id, i) => {
    const re = new RegExp(`<button class="theme-btn" id="theme-${id}" data-theme="${id}">${labels[i]}</button>`);
    const m = html.match(re);
    assert.ok(m, id);
    assert.ok(m.index > rowAt);
  });
  const rule = html.match(/\.theme-btn\s*\{([^}]*)\}/);
  assert.ok(rule && /min-height\s*:\s*(4[4-9]|[5-9]\d)px/.test(rule[1]), 'min-height >= 44px');
  assert.match(html, /\.theme-btn\.active/);
});

test('no image files in maze-3d', () => {
  const walk = (d) =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [e.name]));
  const imgs = walk(dir).filter((n) => /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(n));
  assert.deepEqual(imgs, []);
});

test('joystick overlay does not take pointer events', () => {
  const html = read('index.html');
  assert.ok(html.includes('id="stick"') && html.includes('id="stick-knob"'));
  const m = html.match(/#stick\s*\{([^}]*)\}/);
  assert.ok(m && /pointer-events\s*:\s*none/.test(m[1]));
  // #stick 直接位于 #stage 内：stage 开标签与 #stick 之间没有闭合标签，#stick 闭合后紧跟 stage 闭合
  assert.match(
    html,
    /<div id="stage">(?:(?!<\/div>)[\s\S])*<div id="stick"[^>]*>\s*<div id="stick-knob"><\/div>\s*<\/div>\s*<\/div>/,
  );
});

test('fullscreen button and two hint texts', () => {
  const html = read('index.html');
  assert.match(html, /id="fullscreen-btn"[^>]*hidden[^>]*>全屏</);
  assert.ok(html.includes('WASD / 方向键移动，拖动鼠标转视角'));
  assert.ok(html.includes('左边拖动走路，右边拖动转视角'));
  assert.match(html, /@media\s*\(pointer:\s*coarse\)/);
});
