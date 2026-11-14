import test from 'node:test';
import assert from 'node:assert/strict';
import { drawPart } from '../lib/drawings.js';
import { PART_TYPES, PARTS, defaultParams } from '../lib/parts.js';

const vis = (o = {}) => ({ glow: 0, burnt: false, alarm: false, spin: 0, volume: 0, text: null, stale: false, ...o });
const mk = (type, params = {}) => ({ id: 'X', type, x: 0, y: 0, rot: 0, params: { ...defaultParams(type), ...params } });

test('every type renders in both styles with all terminals and no NaN', () => {
  for (const t of PART_TYPES) for (const style of ['cartoon', 'symbol']) {
    const s = drawPart(mk(t), style, vis({ text: '--' }));
    for (const term of PARTS[t].terms) assert.match(s, new RegExp(`data-term="${term}"`), `${t}/${style}/${term}`);
    assert.doesNotMatch(s, /NaN|undefined|Infinity/);
    assert.equal(/class="lever"/.test(s), PARTS[t].lever, `${t}/${style} lever`);
  }
});

test('state shows up in drawing', () => {
  assert.match(drawPart(mk('lamp'), 'cartoon', vis({ glow: 1 })), /class="glow"/);
  assert.doesNotMatch(drawPart(mk('lamp'), 'cartoon', vis({ glow: 1, burnt: true })), /class="glow"/);
  assert.match(drawPart(mk('battery'), 'symbol', vis({ alarm: true })), /短路啦！/);
  assert.match(drawPart(mk('ammeter'), 'symbol', vis({ text: '0.15 A' })), /0\.15 A/);
  assert.notEqual(drawPart(mk('switch', { closed: true }), 'symbol', vis()), drawPart(mk('switch'), 'symbol', vis()));
  assert.notEqual(drawPart(mk('spdt', { to: 'b' }), 'cartoon', vis()), drawPart(mk('spdt'), 'cartoon', vis()));
  assert.match(drawPart(mk('resistor', { ohms: 220 }), 'cartoon', vis()), /red/);
  assert.notEqual(drawPart(mk('relay'), 'cartoon', vis({ on: true })), drawPart(mk('relay'), 'cartoon', vis()));
  assert.notEqual(drawPart(mk('relay'), 'symbol', vis({ on: true })), drawPart(mk('relay'), 'symbol', vis()));
  assert.notEqual(drawPart(mk('button', { pressed: true }), 'symbol', vis()), drawPart(mk('button'), 'symbol', vis()));
  assert.notEqual(drawPart(mk('button', { pressed: true }), 'cartoon', vis()), drawPart(mk('button'), 'cartoon', vis()));
  assert.notEqual(drawPart(mk('dpdt', { to: 'b' }), 'cartoon', vis()), drawPart(mk('dpdt'), 'cartoon', vis()));
  assert.notEqual(drawPart(mk('dpdt', { to: 'b' }), 'symbol', vis()), drawPart(mk('dpdt'), 'symbol', vis()));
  assert.match(drawPart(mk('display'), 'symbol', vis({ text: '7' })), />7</);
  assert.match(drawPart(mk('display'), 'cartoon', vis({ text: '-' })), />-</);
  const two = drawPart(mk('display'), 'cartoon', vis({ text: '13' }));
  assert.match(two, />1<\/text>/);
  assert.match(two, />3<\/text>/);
  assert.equal((two.match(/class="ghost"/g) || []).length, 2);
});

test('text stays upright when the part is rotated', () => {
  for (const rot of [1, 2, 3]) {
    const s = drawPart({ ...mk('battery'), rot }, 'cartoon', vis({ alarm: true }));
    // 气泡整体转回来，气泡里的文字不再单独转。
    const bubble = s.match(/<g transform="rotate\(([-\d]+)\)[^"]*"><g class="bubble">[\s\S]*?<\/g><\/g>/);
    assert.ok(bubble, s);
    assert.equal(Number(bubble[1]), -rot * 90);
    assert.doesNotMatch(bubble[0], /<text[^>]*transform=/);
    const texts = s.replace(bubble[0], '').match(/<text\b[^>]*>/g);
    assert.ok(texts.length >= 2);
    for (const t of texts) assert.match(t, new RegExp(`transform="[^"]*rotate\\(${-rot * 90} `), t);
  }
  assert.doesNotMatch(drawPart(mk('battery'), 'cartoon', vis({ alarm: true })), /<text[^>]*transform=/);
  // 新元件上的字（显示器数字、继电器常开常闭）也跟着转回来。
  for (const t of ['relay', 'display']) for (const style of ['cartoon', 'symbol']) {
    const s = drawPart({ ...mk(t), rot: 1 }, style, vis({ text: '5' }));
    const texts = s.match(/<text\b[^>]*>/g);
    assert.ok(texts?.length >= 2, `${t}/${style}`);
    for (const x of texts) assert.match(x, /transform="[^"]*rotate\(-90 /, `${t}/${style}`);
  }
});

test('relay contacts are labelled 常开 / 常闭, display inputs 1 2 4 8', () => {
  for (const style of ['cartoon', 'symbol']) {
    const r = drawPart(mk('relay'), style, vis());
    assert.match(r, />常开</);
    assert.match(r, />常闭</);
    const d = drawPart(mk('display'), style, vis({ text: '-' }));
    for (const k of ['1', '2', '4', '8']) assert.match(d, new RegExp(`>${k}<`), `${style}/${k}`);
  }
});

test('tagged switch and relay draw their tag upright, untagged ones and other types do not', () => {
  for (const type of ['switch', 'relay']) for (const style of ['cartoon', 'symbol']) for (const rot of [0, 1, 2, 3]) {
    const tagged = drawPart({ ...mk(type), rot, tag: 'A7' }, style, vis());
    const t = tagged.match(/<text\b[^>]*class="label tag"[^>]*>A7</);
    assert.ok(t, `${type}/${style}/${rot}`);
    if (rot) assert.match(t[0], new RegExp(`rotate\\(${-rot * 90} `), `${type}/${style}/${rot} upright`);
    assert.doesNotMatch(tagged, /NaN|undefined|Infinity/);
    assert.doesNotMatch(drawPart({ ...mk(type), rot }, style, vis()), /class="label tag"/);
  }
  assert.doesNotMatch(drawPart({ ...mk('lamp'), tag: 'L' }, 'cartoon', vis()), />L</);
});

test('node renders as a dot in both styles and stays out of the palette', () => {
  for (const [style, r] of [['cartoon', 7], ['symbol', 5]]) {
    const s = drawPart(mk('node'), style, vis());
    assert.match(s, new RegExp(`class="node-dot"[^>]*r="${r}"`));
    assert.match(s, /data-term="o"/);
    assert.doesNotMatch(s, /NaN|undefined|Infinity|class="term"/);
  }
  assert.equal(PART_TYPES.includes('node'), false);
});

test('dpdt lever knob is drawn in its own lever rect, clear of the upper blade', () => {
  for (const style of ['cartoon', 'symbol']) {
    const s = drawPart(mk('dpdt'), style, vis());
    const rect = s.match(/<g class="lever"><rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/);
    assert.ok(rect, style);
    const [x, y, w, h] = rect.slice(1).map(Number);
    assert.deepEqual([x, y, w, h], [PARTS.dpdt.leverRect.x0 * 40, PARTS.dpdt.leverRect.y0 * 40,
      (PARTS.dpdt.leverRect.x1 - PARTS.dpdt.leverRect.x0) * 40, (PARTS.dpdt.leverRect.y1 - PARTS.dpdt.leverRect.y0) * 40]);
    // 上下两组触点都在 y = ±40 以外，拨片区不碰到它们。
    assert.ok(y > -40 && y + h < 40, style);
  }
});
