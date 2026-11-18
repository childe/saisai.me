// 电路分享短链：POST /s 存压缩码换短 id，GET /s/<id> 跳回 /circuit/#c=<压缩码>。
// 只挂在 saisai.me/s* 路由上，其余页面仍由 GitHub Pages 提供。压缩码本身由前端载入时校验，这里只查字符和长度。

const CODE_RE = /^[A-Za-z0-9_-]{1,16000}$/;
const ID_RE = /^[A-Za-z0-9_-]{8,43}$/;
const ID_LEN = 8;

// id 取压缩码 SHA-256 的 base64url 前缀：同一个电路总是同一个 id，重复分享不再写 KV。
export async function shortId(code, len = ID_LEN) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code)));
  let s = '';
  for (const b of hash) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, len);
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

const notFound = () => new Response(
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
  '<title>链接不存在</title><p style="font:18px sans-serif;padding:24px">这个分享链接不存在。<a href="/circuit/">去电路实验室</a></p>',
  { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
);

async function create(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') ?? '';
  const { success } = await env.LIMITER.limit({ key: ip });
  if (!success) return json({ error: 'rate limited' }, 429);
  const code = await request.text();
  if (!CODE_RE.test(code)) return json({ error: 'bad code' }, 400);
  // 前缀撞上别的电路就加长一位，直到空位或同一个电路。
  for (let len = ID_LEN; len <= 43; len++) {
    const id = await shortId(code, len);
    const old = await env.LINKS.get(id);
    if (old === code) return json({ id });
    if (old === null) {
      await env.LINKS.put(id, code);
      return json({ id });
    }
  }
  return json({ error: 'no id' }, 500);
}

async function open(id, request, env) {
  if (!ID_RE.test(id)) return notFound();
  const code = await env.LINKS.get(id, { cacheTtl: 86400 });
  if (code === null) return notFound();
  return Response.redirect(new URL(`/circuit/#c=${code}`, request.url).href, 302);
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/s') {
      return request.method === 'POST' ? create(request, env) : json({ error: 'method not allowed' }, 405);
    }
    if (pathname.startsWith('/s/') && (request.method === 'GET' || request.method === 'HEAD')) {
      return open(pathname.slice(3), request, env);
    }
    return notFound();
  },
};
