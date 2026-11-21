import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from './helpers.js';
import { packCircuit, encodeCircuit, decodeCircuit, shareUrl, codeFromHash, shortLink } from '../lib/share.js';

// 直接把任意对象压成链接数据，用来造坏数据。
async function raw(obj) {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
  const buf = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
  return Buffer.from(buf).toString('base64url');
}

function sample() {
  const c = build({
    parts: {
      p1: ['battery', { cells: 3 }, { rot: 1 }],
      p2: ['lamp'],
      p3: ['rheostat', { pos: 0.25 }],
      p4: ['node'],
      p5: ['button', { pressed: true }],
    },
    wires: [['p1.p', 'p2.a'], ['p2.b', 'p4.o'], ['p4.o', 'p3.a'], ['p3.b', 'p5.a'], ['p5.b', 'p1.n']],
  });
  c.wires[0].via = [[5, 2], [9, 2]];
  c.wires[1].r = 0.0005;
  c.nextId = 20;
  return c;
}

const good = () => packCircuit(sample());

test('round trip keeps parts and wires', async () => {
  const c = sample();
  const d = await decodeCircuit(await encodeCircuit(c));
  const released = c.parts.map(p => (p.type === 'button' ? { ...p, params: { pressed: false } } : p));
  assert.deepEqual(d, { rev: 0, topoRev: 0, nextId: 20, parts: released, wires: c.wires });
});

test('pack releases pressed buttons', async () => {
  const d = await decodeCircuit(await encodeCircuit(sample()));
  assert.equal(d.parts.find(p => p.type === 'button').params.pressed, false);
});

test('encoded string is url safe', async () => {
  assert.match(await encodeCircuit(sample()), /^[A-Za-z0-9_-]+$/);
});

test('decode rejects garbage without throwing', async () => {
  const bad = [];
  const mut = fn => { const o = good(); fn(o); return o; };
  bad.push(mut(o => { o.v = 2; }));
  bad.push(mut(o => { o.p[1][1] = 'toaster'; }));
  bad.push(mut(o => { o.p[1][4] = 4; }));
  bad.push(mut(o => { o.p[1][2] = 1.5; }));
  bad.push(mut(o => { o.p[1][2] = 999; }));
  bad.push(mut(o => { o.p[0][5] = { cells: 11 }; }));
  bad.push(mut(o => { o.p[1][5] = { color: 'red' }; }));
  bad.push(mut(o => { o.p[1][0] = 'p1'; }));
  bad.push(mut(o => { o.p[1][0] = 'p20'; }));
  bad.push(mut(o => { o.w[0][1] = 'p99'; }));
  bad.push(mut(o => { o.w[0][2] = 'zz'; }));
  bad.push(mut(o => { o.w[0][3] = 'p1'; o.w[0][4] = 'p'; }));
  bad.push(mut(o => { o.w[0][5] = [[1.5, 2]]; }));
  bad.push(mut(o => { o.w[1][6] = -1; }));
  const codes = ['', '!!!', 'abc', await raw('not json'), ...(await Promise.all(bad.map(raw)))];
  for (const [i, s] of codes.entries()) assert.equal(await decodeCircuit(s), null, `case ${i}`);
});

test('shareUrl replaces existing hash', () => {
  assert.equal(shareUrl('https://saisai.me/circuit/#c=old', 'NEW'), 'https://saisai.me/circuit/#c=NEW');
  assert.equal(shareUrl('https://saisai.me/circuit/', 'NEW'), 'https://saisai.me/circuit/#c=NEW');
});

test('codeFromHash', () => {
  assert.equal(codeFromHash('#c=abc'), 'abc');
  for (const h of ['', '#', '#c=', '#x=1']) assert.equal(codeFromHash(h), null, h);
});

test('copyLink uses ClipboardItem with a pending url when available', async () => {
  const { copyLink } = await import('../lib/share.js');
  let written = null;
  class Item { constructor(data) { this.data = data; } }
  const env = { ClipboardItem: Item, clipboard: { write: async items => { written = await (await items[0].data['text/plain']).text(); } } };
  assert.equal(await copyLink(env, Promise.resolve('U')), true);
  assert.equal(written, 'U');
});

test('copyLink falls back to writeText, and reports failure instead of throwing', async () => {
  const { copyLink } = await import('../lib/share.js');
  let text = null;
  assert.equal(await copyLink({ clipboard: { writeText: async t => { text = t; } } }, Promise.resolve('U')), true);
  assert.equal(text, 'U');
  assert.equal(await copyLink({ clipboard: { writeText: () => Promise.reject(new Error('denied')) } }, Promise.resolve('U')), false);
  assert.equal(await copyLink({}, Promise.resolve('U')), false);
  assert.equal(await copyLink({ clipboard: { writeText: async () => {} } }, Promise.reject(new Error('no stream'))), false);
});

test('canShare depends on CompressionStream support', async () => {
  const { canShare } = await import('../lib/share.js');
  assert.equal(canShare(), true);
  const saved = globalThis.CompressionStream;
  try {
    delete globalThis.CompressionStream;
    assert.equal(canShare(), false);
  } finally {
    globalThis.CompressionStream = saved;
  }
});

test('shortLink posts the code and builds a short url', async () => {
  const calls = [];
  const fetchFn = async (url, opts) => {
    calls.push([url, opts.method, opts.body]);
    return new Response(JSON.stringify({ id: 'Ab3_x-9Z' }), { status: 200 });
  };
  assert.equal(await shortLink('https://saisai.me', 'CODE', fetchFn), 'https://saisai.me/s/Ab3_x-9Z');
  assert.deepEqual(calls, [['https://saisai.me/s', 'POST', 'CODE']]);
});

test('shortLink returns null on any failure', async () => {
  const cases = [
    async () => { throw new TypeError('offline'); },
    async () => new Response('nope', { status: 404 }),
    async () => new Response('not json', { status: 200 }),
    async () => new Response(JSON.stringify({ id: '../evil' }), { status: 200 }),
    async () => new Response(JSON.stringify({}), { status: 200 }),
  ];
  for (const f of cases) assert.equal(await shortLink('https://saisai.me', 'CODE', f), null);
});

test('shortLink gives up after the timeout', async () => {
  const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  const t = Date.now();
  assert.equal(await shortLink('https://saisai.me', 'CODE', hang, 50), null);
  assert.ok(Date.now() - t < 1000);
});
