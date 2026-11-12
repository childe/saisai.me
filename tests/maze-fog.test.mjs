import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../maze-gen/maze.html', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found`);
  let i = html.indexOf('{', start) + 1, depth = 1;
  for (; depth > 0; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') depth--; }
  return html.slice(start, i);
}

function fogSection() {
  const m = html.match(/\/\/ ==== fog BEGIN ====([\s\S]*?)\/\/ ==== fog END ====/);
  assert.ok(m, 'fog section markers not found');
  return m[1];
}

function fakeClassList() {
  const s = new Set();
  return {
    add: (n) => s.add(n), remove: (n) => s.delete(n), contains: (n) => s.has(n),
    toggle: (n, force) => { const on = force === undefined ? !s.has(n) : !!force; on ? s.add(n) : s.delete(n); return on; },
  };
}

function createEnv({ size = 10, storage = {}, storageThrows = false } = {}) {
  const cells = Array.from({ length: size * size }, () => ({ classList: fakeClassList() }));
  const els = Object.fromEntries(['fog-toggle', 'fog-minus', 'fog-plus', 'fog-radius-value']
    .map((id) => [id, { id, textContent: '', disabled: false }]));
  const queue = [];
  const ctx = {
    console,
    setTimeout: (fn) => { queue.push(fn); return queue.length; },
    document: {
      querySelectorAll: (sel) => sel === '.cell' ? cells
        : sel === '.player' ? cells.filter((c) => c.classList.contains('player')) : [],
      getElementById: (id) => els[id] || null,
    },
  };
  const store = { ...storage };
  const ls = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  Object.defineProperty(ctx, 'localStorage', {
    get() { if (storageThrows) throw new Error('SecurityError'); return ls; },
  });
  vm.createContext(ctx);
  const src = `let currentSize = ${size}; let playerPosition = { row: 0, col: 0 }; let isMoving = false;\n`
    + fogSection() + '\n' + extractFunction('updatePlayerDisplay') + '\n' + extractFunction('animatePlayerMovement');
  vm.runInContext(src, ctx);
  return {
    cells, els, store,
    run: (code) => vm.runInContext(code, ctx),
    tick: () => { const fn = queue.shift(); if (fn) fn(); },
    flush: () => { let n = 0; while (queue.length && n++ < 1000) queue.shift()(); },
  };
}

test('fog constants and defaults', () => {
  assert.match(html, /const FOG_MIN = 1;/);
  assert.match(html, /const FOG_MAX = 25;/);
  assert.match(html, /let fogRadius = 5;/);
  assert.match(html, /let fogEnabled = true;/);
});

test('isInFogView uses Chebyshev distance', () => {
  const env = createEnv();
  const v = (r, c, pr, pc, n) => env.run(`isInFogView(${r}, ${c}, ${pr}, ${pc}, ${n})`);
  assert.equal(v(5, 10, 5, 5, 5), true);   // 距离恰为 N
  assert.equal(v(5, 11, 5, 5, 5), false);  // N+1
  assert.equal(v(10, 10, 5, 5, 5), true);  // 对角线 (5,5) 仍可见
  assert.equal(v(11, 10, 5, 5, 5), false);
  assert.equal(v(0, 0, 5, 5, 5), true);
  assert.equal(v(5, 5, 5, 5, 1), true);    // 自身
});

test('loadFogSettings reads stored values', () => {
  const env = createEnv({ storage: { 'maze-fog-enabled': 'false', 'maze-fog-radius': '7' } });
  env.run('loadFogSettings()');
  assert.equal(env.run('fogEnabled'), false);
  assert.equal(env.run('fogRadius'), 7);
});

test('loadFogSettings falls back to defaults on missing or invalid radius', () => {
  for (const bad of [undefined, '0', '26', '3.5', 'abc', '']) {
    const storage = bad === undefined ? {} : { 'maze-fog-radius': bad };
    const env = createEnv({ storage });
    env.run('loadFogSettings()');
    assert.equal(env.run('fogRadius'), 5, `radius ${bad}`);
    assert.equal(env.run('fogEnabled'), true);
  }
});

test('localStorage throwing gives defaults and save does not throw', () => {
  const env = createEnv({ storageThrows: true });
  env.run('fogEnabled = false; fogRadius = 9;');
  env.run('loadFogSettings()');
  assert.equal(env.run('fogEnabled'), true);
  assert.equal(env.run('fogRadius'), 5);
  assert.doesNotThrow(() => env.run('saveFogSettings()'));
});

test('saveFogSettings writes both keys', () => {
  const env = createEnv();
  env.run('fogEnabled = false; fogRadius = 3; saveFogSettings();');
  assert.equal(env.store['maze-fog-enabled'], 'false');
  assert.equal(env.store['maze-fog-radius'], '3');
});

const fogged = (env, r, c, size = 10) => env.cells[r * size + c].classList.contains('fog');
function startMove(env, to) {
  env.run(`animatePlayerMovement(playerPosition, ${JSON.stringify(to)}, () => { playerPosition = ${JSON.stringify(to)}; updatePlayerDisplay(); })`);
}

test('fog centers on displayed position when radius changes mid-animation', () => {
  const env = createEnv();
  env.run('updatePlayerDisplay()');
  startMove(env, { row: 0, col: 6 });   // 第 1 步同步画在 (0,1)
  env.tick(); env.tick();               // 画在 (0,3)
  env.run('changeFogRadius(-10)');      // 夹到 1
  assert.equal(env.run('fogRadius'), 1);
  assert.equal(fogged(env, 0, 3), false);
  assert.ok(env.cells[3].classList.contains('player'));
  assert.equal(fogged(env, 0, 4), false);
  assert.equal(fogged(env, 0, 0), true);
  assert.equal(fogged(env, 0, 5), true);
});

test('toggling fog twice mid-animation keeps center on displayed position', () => {
  const env = createEnv();
  env.run('fogRadius = 1; updatePlayerDisplay()');
  startMove(env, { row: 0, col: 6 });
  env.tick(); env.tick();
  env.run('toggleFog(); toggleFog();');
  assert.equal(env.run('fogEnabled'), true);
  assert.equal(fogged(env, 0, 3), false);
  assert.equal(fogged(env, 0, 0), true);
});

test('after animation fog centers on destination', () => {
  const env = createEnv();
  env.run('fogRadius = 1; updatePlayerDisplay()');
  startMove(env, { row: 0, col: 6 });
  env.flush();
  assert.deepEqual(JSON.parse(env.run('JSON.stringify(displayPosition)')), { row: 0, col: 6 });
  assert.equal(fogged(env, 0, 6), false);
  assert.equal(fogged(env, 1, 7), false);
  assert.equal(fogged(env, 0, 4), true);
});

test('fog disabled leaves every cell clear, and radius changes still apply later', () => {
  const env = createEnv();
  env.run('updatePlayerDisplay(); toggleFog(); changeFogRadius(-3);');
  assert.equal(env.cells.some((c) => c.classList.contains('fog')), false);
  assert.equal(env.run('fogRadius'), 2);
  env.run('toggleFog()');
  assert.equal(fogged(env, 2, 2), false);
  assert.equal(fogged(env, 3, 0), true);
});

test('radius larger than maze shows everything', () => {
  const env = createEnv();
  env.run('fogRadius = 25; updatePlayerDisplay()');
  assert.equal(env.cells.some((c) => c.classList.contains('fog')), false);
});

test('radius clamps to [1, 25] and buttons disable at bounds', () => {
  const env = createEnv();
  env.run('changeFogRadius(-1); changeFogRadius(-1); changeFogRadius(-1); changeFogRadius(-1); changeFogRadius(-1);');
  assert.equal(env.run('fogRadius'), 1);
  assert.equal(env.els['fog-minus'].disabled, true);
  assert.equal(env.els['fog-plus'].disabled, false);
  assert.equal(env.els['fog-radius-value'].textContent, '视野 1');
  env.run('changeFogRadius(100)');
  assert.equal(env.run('fogRadius'), 25);
  assert.equal(env.els['fog-plus'].disabled, true);
  assert.equal(env.els['fog-minus'].disabled, false);
  assert.equal(env.store['maze-fog-radius'], '25');
});

test('toggle updates label and storage', () => {
  const env = createEnv();
  env.run('toggleFog()');
  assert.equal(env.els['fog-toggle'].textContent, '迷雾：关');
  assert.equal(env.store['maze-fog-enabled'], 'false');
  env.run('toggleFog()');
  assert.equal(env.els['fog-toggle'].textContent, '迷雾：开');
});

test('regenerating resets fog center to entrance', () => {
  const env = createEnv();
  env.run('fogRadius = 1; updatePlayerDisplay()');
  startMove(env, { row: 0, col: 6 });
  env.flush();
  env.run('playerPosition = { row: 0, col: 0 }; updatePlayerDisplay();'); // 同 generateMaze 的调用顺序
  assert.equal(fogged(env, 0, 0), false);
  assert.equal(fogged(env, 0, 6), true);
});

test('fog controls work when storage throws', () => {
  const env = createEnv({ storageThrows: true });
  assert.doesNotThrow(() => env.run('changeFogRadius(1); toggleFog();'));
  assert.equal(env.run('fogRadius'), 6);
});

test('fog controls markup sits between size controls and maze', () => {
  const sizeIdx = html.indexOf('class="size-controls"');
  const fogIdx = html.indexOf('class="fog-controls"');
  const mazeIdx = html.indexOf('id="maze"');
  assert.ok(sizeIdx >= 0 && fogIdx > sizeIdx && mazeIdx > fogIdx);
  assert.match(html, /<button[^>]*id="fog-toggle"[^>]*onclick="toggleFog\(\)"[^>]*>迷雾：开<\/button>/);
  assert.match(html, /<button[^>]*id="fog-minus"[^>]*onclick="changeFogRadius\(-1\)"[^>]*>−<\/button>/);
  assert.match(html, /<button[^>]*id="fog-plus"[^>]*onclick="changeFogRadius\(1\)"[^>]*>\+<\/button>/);
  assert.match(html, /id="fog-radius-value"[^>]*>视野 5</);
});

test('fog CSS rules', () => {
  assert.match(html, /\.fog\s*\{[^}]*background-color:\s*#444\s*!important/);
  assert.match(html, /\.cell\.fog\s*>\s*\*\s*\{[^}]*visibility:\s*hidden/);
  assert.match(html, /\.cell\.fog\.solution\s*\{[^}]*background-color:\s*#ff0000\s*!important/);
  assert.match(html, /\.fog-controls\s*\{[^}]*display:\s*flex[^}]*\}/);
  assert.match(html, /\.fog-controls\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(html, /\.fog-step\s*\{[^}]*min-width:\s*44px/);
  assert.match(html, /\.fog-step\s*\{[^}]*height:\s*44px/);
});

test('init loads fog settings before generating maze', () => {
  const m = html.match(/addEventListener\('DOMContentLoaded',\s*function\(\)\s*\{([\s\S]*?)\}\);/);
  assert.ok(m);
  const body = m[1];
  const load = body.indexOf('loadFogSettings()');
  const ctrl = body.indexOf('updateFogControls()');
  const gen = body.indexOf('generateMaze()');
  assert.ok(load >= 0 && ctrl > load && gen > ctrl);
});

test('hint mentions fog', () => {
  assert.match(html, /<p>开启迷雾后只能看到小人周围的格子，可用 − \/ \+ 调节视野<\/p>/);
});
