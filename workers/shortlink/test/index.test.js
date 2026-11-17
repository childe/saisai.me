import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { shortId } from '../index.js';

// 内存版 KV 和限流器，记录写入次数。
function fakeEnv({ allow = true } = {}) {
  const map = new Map();
  const kv = {
    puts: 0,
    get: async k => map.get(k) ?? null,
    put: async (k, v) => { kv.puts++; map.set(k, v); },
  };
  return { map, env: { LINKS: kv, LIMITER: { limit: async () => ({ success: allow }) } } };
}

const post = (body, headers = {}) => new Request('https://saisai.me/s', { method: 'POST', body, headers: { 'CF-Connecting-IP': '1.2.3.4', ...headers } });
const get = path => new Request(`https://saisai.me${path}`);
const CODE = 'q1Yqyy_JzEtXslIyNDBQ0lEqSy0qzszPAwkYGRjoKOUnZqcWAwUNgKKFpakpQB5QdS0A';

test('POST stores the code and returns a short id', async () => {
  const { env, map } = fakeEnv();
  const res = await worker.fetch(post(CODE), env);
  assert.equal(res.status, 200);
  const { id } = await res.json();
  assert.match(id, /^[A-Za-z0-9_-]{8}$/);
  assert.equal(id, await shortId(CODE));
  assert.equal(map.get(id), CODE);
});

test('same code twice gives the same id and writes once', async () => {
  const { env } = fakeEnv();
  const a = await (await worker.fetch(post(CODE), env)).json();
  const b = await (await worker.fetch(post(CODE), env)).json();
  assert.equal(a.id, b.id);
  assert.equal(env.LINKS.puts, 1);
});

test('hash collision falls back to a longer id', async () => {
  const { env, map } = fakeEnv();
  const id8 = await shortId(CODE);
  map.set(id8, 'somethingElse');
  const { id } = await (await worker.fetch(post(CODE), env)).json();
  assert.equal(id.length, 9);
  assert.ok(id.startsWith(id8));
  assert.equal(map.get(id), CODE);
});

test('POST rejects bad codes', async () => {
  const { env } = fakeEnv();
  for (const body of ['', 'has space', 'a+b/c=', 'x'.repeat(16001)]) {
    const res = await worker.fetch(post(body), env);
    assert.equal(res.status, 400, JSON.stringify(body.slice(0, 20)));
  }
  assert.equal(env.LINKS.puts, 0);
});

test('POST is rate limited', async () => {
  const { env } = fakeEnv({ allow: false });
  const res = await worker.fetch(post(CODE), env);
  assert.equal(res.status, 429);
  assert.equal(env.LINKS.puts, 0);
});

test('GET redirects to the circuit page with the code', async () => {
  const { env } = fakeEnv();
  const { id } = await (await worker.fetch(post(CODE), env)).json();
  const res = await worker.fetch(get(`/s/${id}`), env);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), `https://saisai.me/circuit/#c=${CODE}`);
});

test('unknown or malformed id gives 404 page linking back', async () => {
  const { env } = fakeEnv();
  for (const p of ['/s/AAAAAAAA', '/s/bad!id', '/s/', '/s/a/b']) {
    const res = await worker.fetch(get(p), env);
    assert.equal(res.status, 404, p);
    assert.match(await res.text(), /\/circuit\//);
  }
});

test('other methods are refused', async () => {
  const { env } = fakeEnv();
  const res = await worker.fetch(new Request('https://saisai.me/s', { method: 'PUT', body: CODE }), env);
  assert.equal(res.status, 405);
});
