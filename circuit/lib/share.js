// 分享链接：电路 ⇄ 紧凑 JSON ⇄ 压缩后的 base64url；载入时逐项校验，不信任链接里的数据。
import { PARTS, defaultParams, isValidParam } from './parts.js';
import { BOARD } from './geometry.js';

const VERSION = 1;

// 紧凑格式：{ v, n: nextId, p: [[id, type, x, y, rot, params]], w: [[id, aPart, aTerm, bPart, bTerm, via?, r?]] }。
// 按钮一律记成松开。
export function packCircuit(c) {
  return {
    v: VERSION,
    n: c.nextId,
    p: c.parts.map(p => [p.id, p.type, p.x, p.y, p.rot, p.type === 'button' ? { ...p.params, pressed: false } : p.params]),
    w: c.wires.map(w => {
      const row = [w.id, w.a.part, w.a.term, w.b.part, w.b.term];
      if (w.r !== undefined) row.push(w.via ?? null, w.r);
      else if (w.via !== undefined) row.push(w.via);
      return row;
    }),
  };
}

const isInt = v => Number.isInteger(v);
const inBoard = (x, y) => isInt(x) && isInt(y) && x >= 0 && x <= BOARD.w && y >= 0 && y <= BOARD.h;
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const idOk = (id, prefix, n) => typeof id === 'string' && new RegExp(`^${prefix}\\d+$`).test(id) && Number(id.slice(1)) < n;

function unpackPart(row, n) {
  if (!Array.isArray(row) || row.length !== 6) return null;
  const [id, type, x, y, rot, params] = row;
  if (!idOk(id, 'p', n) || !Object.hasOwn(PARTS, type) || !inBoard(x, y) || ![0, 1, 2, 3].includes(rot) || !isObj(params)) return null;
  for (const [k, v] of Object.entries(params)) if (!isValidParam(type, k, v)) return null;
  return { id, type, x, y, rot, params: { ...defaultParams(type), ...params } };
}

function unpackWire(row, n, parts) {
  if (!Array.isArray(row) || row.length < 5 || row.length > 7) return null;
  const [id, ap, at, bp, bt, via, r] = row;
  if (!idOk(id, 'w', n)) return null;
  const termOk = (p, t) => parts.has(p) && PARTS[parts.get(p).type].terms.includes(t);
  if (!termOk(ap, at) || !termOk(bp, bt) || (ap === bp && at === bt)) return null;
  const wire = { id, a: { part: ap, term: at }, b: { part: bp, term: bt } };
  if (via !== undefined && via !== null) {
    if (!Array.isArray(via) || !via.every(pt => Array.isArray(pt) && pt.length === 2 && inBoard(pt[0], pt[1]))) return null;
    wire.via = via.map(pt => [pt[0], pt[1]]);
  }
  if (row.length === 7) {
    if (typeof r !== 'number' || !Number.isFinite(r) || r <= 0) return null;
    wire.r = r;
  }
  return wire;
}

export function unpackCircuit(obj) {
  if (!isObj(obj) || obj.v !== VERSION || !isInt(obj.n) || obj.n < 1 || !Array.isArray(obj.p) || !Array.isArray(obj.w)) return null;
  const parts = new Map();
  for (const row of obj.p) {
    const p = unpackPart(row, obj.n);
    if (!p || parts.has(p.id)) return null;
    parts.set(p.id, p);
  }
  const wires = [];
  const wireIds = new Set();
  for (const row of obj.w) {
    const w = unpackWire(row, obj.n, parts);
    if (!w || wireIds.has(w.id)) return null;
    wireIds.add(w.id);
    wires.push(w);
  }
  return { rev: 0, topoRev: 0, nextId: obj.n, parts: [...parts.values()], wires };
}

const toB64url = bytes => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0));

const pipe = async (data, stream) => new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(stream)).arrayBuffer());

export async function encodeCircuit(c) {
  return toB64url(await pipe(JSON.stringify(packCircuit(c)), new CompressionStream('deflate-raw')));
}

export async function decodeCircuit(s) {
  try {
    if (typeof s !== 'string' || !/^[A-Za-z0-9_-]+$/.test(s)) return null;
    const bytes = await pipe(fromB64url(s), new DecompressionStream('deflate-raw'));
    return unpackCircuit(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

export function shareUrl(href, code) {
  return `${href.split('#')[0]}#c=${code}`;
}

// 请站点上的短链服务（workers/shortlink）把压缩码换成 /s/<id>。离线、本地开发、超时或返回异常都给 null，由调用方退回长链接。
export async function shortLink(origin, code, fetchFn = globalThis.fetch, timeoutMs = 4000) {
  try {
    const res = await fetchFn(`${origin}/s`, { method: 'POST', body: code, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const { id } = await res.json();
    return typeof id === 'string' && /^[A-Za-z0-9_-]{8,43}$/.test(id) ? `${origin}/s/${id}` : null;
  } catch {
    return null;
  }
}

export function codeFromHash(hash) {
  const m = /^#c=(.+)$/.exec(hash ?? '');
  return m ? m[1] : null;
}

// 老浏览器（如 iPadOS 15）没有 CompressionStream，既不能生成也不能打开分享链接。
export const canShare = () => typeof globalThis.CompressionStream === 'function';

// 复制链接。必须在点击回调里同步调用：Safari 只在用户手势当下允许写剪贴板，
// 所以优先把「还没算完的链接」直接交给 ClipboardItem。成功返回 true，任何失败返回 false，不抛异常。
export async function copyLink({ clipboard, ClipboardItem: Item } = {}, urlPromise) {
  try {
    if (clipboard?.write && Item) {
      await clipboard.write([new Item({ 'text/plain': urlPromise.then(u => new Blob([u], { type: 'text/plain' })) })]);
      return true;
    }
    if (!clipboard?.writeText) return false;
    await clipboard.writeText(await urlPromise);
    return true;
  } catch {
    return false;
  }
}
