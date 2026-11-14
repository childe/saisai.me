import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const exists = f => fs.existsSync(path.join(root, f));

test('index.html wiring', () => {
  const html = read('index.html');
  assert.match(html, /<title>解方程学习<\/title>/);
  assert.match(html, /<script type="module" src="app\.js">/);
  assert.match(html, /href="\.\.\/index\.html"/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test('every relative import resolves and nothing is fetched from the network', () => {
  const files = ['app.js', ...fs.readdirSync(path.join(root, 'lib')).map(f => `lib/${f}`)];
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /https?:\/\//, f);
    assert.doesNotMatch(src, /\bfetch\(/, f);
    assert.doesNotMatch(src, /console\.log/, f);
    for (const [, spec] of src.matchAll(/from\s*'(\.[^']+)'/g))
      assert.ok(exists(path.join(path.dirname(f), spec)), `${f} -> ${spec}`);
  }
});
