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
