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
});
