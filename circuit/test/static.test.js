import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('index.html wiring', () => {
  const html = read('index.html');
  assert.match(html, /user-scalable=no/);
  assert.match(html, /<script type="module" src="app\.js">/);
  assert.match(html, /<svg[^>]*id="board"/);
  for (const id of ['palette', 'panel', 'banner', 'confirm', 'taskbar']) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /https?:\/\//);
});

test('every relative import resolves and nothing is fetched from the network', () => {
  const sub = d => fs.readdirSync(path.join(root, d), { withFileTypes: true })
    .flatMap(e => (e.isDirectory() ? sub(`${d}/${e.name}`) : [`${d}/${e.name}`]));
  const files = ['app.js', 'view.js', 'sound.js', ...sub('lib')].filter(f => fs.existsSync(path.join(root, f)));
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /https?:\/\/|localStorage|indexedDB/, f);
    for (const [, spec] of src.matchAll(/from\s+'(\.[^']+)'/g))
      assert.ok(fs.existsSync(path.join(root, path.dirname(f), spec)), `${f} -> ${spec}`);
  }
});

test('styles use toolbox background and block text selection', () => {
  const css = read('styles.css');
  assert.match(css, /#fff8ec/i);
  assert.match(css, /touch-action:\s*none/);
  assert.match(css, /user-select:\s*none/);
});

test('effects and task UI are wired', () => {
  const app = read('app.js');
  assert.match(app, /requestAnimationFrame/);
  assert.match(app, /type:\s*'tick'/);
  assert.match(read('sound.js'), /export function createBuzzer/);
  const css = read('styles.css');
  assert.match(css, /@keyframes/);
  assert.match(css, /\.flow/);
  const html = read('index.html');
  assert.match(html, /暂时无法计算/);
});

test('button press gesture and relay click are wired', () => {
  const app = read('app.js');
  assert.match(app, /type:\s*'press'/);
  assert.match(app, /type:\s*'release'/);
  assert.match(app, /relays\.flips/);
  assert.match(app, /'lostpointercapture',\s*e => endGesture\(e, true\)/);
  assert.match(app, /\.click\(state\.muted\)/);
  assert.match(read('sound.js'), /function click\(muted\)/);
});
