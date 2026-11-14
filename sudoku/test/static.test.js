import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const exists = f => fs.existsSync(path.join(root, f));

test('index.html wiring', () => {
  const html = read('index.html');
  assert.match(html, /user-scalable=no/);
  assert.match(html, /<script type="module" src="app\.js">/);
  assert.match(html, /href="\.\.\/index\.html"/);
  assert.match(html, /<title>数独 - SaiSai\.me<\/title>/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test('every relative import resolves and nothing is fetched from the network', () => {
  const sub = d => fs.readdirSync(path.join(root, d), { withFileTypes: true })
    .flatMap(e => (e.isDirectory() ? sub(`${d}/${e.name}`) : [`${d}/${e.name}`]));
  const page = ['app.js', 'view.js'];
  for (const f of page) assert.ok(exists(f), `${f} missing`);
  const files = [...page, ...sub('lib'), ...sub('data')].filter(f => f.endsWith('.js'));
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /https?:\/\//, f);
    assert.doesNotMatch(src, /\bfetch\(/, f);
    for (const [, spec] of src.matchAll(/(?:from|import)\s*\(?\s*'(\.[^']+)'/g))
      assert.ok(exists(path.join(path.dirname(f), spec)), `${f} -> ${spec}`);
  }
});

test('styles use toolbox background and block text selection', () => {
  const css = read('styles.css');
  assert.match(css, /#fff8ec/);
  assert.match(css, /user-select:\s*none/);
});

test('page layer leaves game rules to act()', () => {
  const app = read('app.js');
  assert.match(app, /from '\.\/lib\/game\.js'/);
  assert.match(app, /\bact\(/);
  assert.match(app, /location\.hash/);
  assert.match(app, /hashchange/);
  assert.match(app, /saveStars\(/);
  assert.match(app, /generateFree\(/);
  // 只有区块、数对两章自动显示候选
  assert.match(app, /autoCandidates/);
  assert.doesNotMatch(read('view.js'), /localStorage/);
});
