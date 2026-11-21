import test from 'node:test';
import assert from 'node:assert/strict';
import { PARTS, PHYS, defaultParams, isValidParam } from '../lib/parts.js';
import { drawPart } from '../lib/drawings.js';
import { partVisual } from '../lib/viewmodel.js';
import { createDamage } from '../lib/damage.js';
import { solve } from '../lib/solve.js';
import { paramHtml } from '../view.js';
import { loop } from './helpers.js';

const vis = (o = {}) => ({ glow: 0, burnt: false, alarm: false, spin: 0, volume: 0, text: null, stale: false, ...o });
const bat = (cells, rot = 0) => ({ id: 'B', type: 'battery', x: 0, y: 0, rot, params: { cells } });
const mk = type => ({ id: 'X', type, x: 0, y: 0, rot: 0, params: defaultParams(type) });

test('battery cells: any whole number 1–100', () => {
  for (const v of [1, 2, 7, 25, 99, 100]) assert.equal(isValidParam('battery', 'cells', v), true, v);
  for (const v of [0, 101, 2.5, -1, '3', NaN]) assert.equal(isValidParam('battery', 'cells', v), false, String(v));
  assert.deepEqual(PARTS.battery.params.cells.presets, [1, 2, 4, 10, 50, 100]);
});

test('battery looks: cells, box, power box', () => {
  for (let cells = 1; cells <= 100; cells++) for (const style of ['cartoon', 'symbol']) {
    const s = drawPart(bat(cells), style, vis());
    assert.doesNotMatch(s, /NaN|undefined|Infinity|width="-/, `${cells}/${style}`);
    if (style === 'symbol' || cells > 4) assert.match(s, new RegExp(`${cells}(节|×1.5V)`), `${cells}/${style} label`);
  }
  const look = c => drawPart(bat(c), 'cartoon', vis()).match(/data-look="(\w+)"/)?.[1];
  assert.equal(look(4), 'cells');
  assert.equal(look(5), 'box');
  assert.equal(look(20), 'box');
  assert.equal(look(21), 'power');
  assert.match(drawPart(bat(100), 'cartoon', vis()), /150V/);
});

test('high-voltage sign above 36V', () => {
  for (const style of ['cartoon', 'symbol']) {
    assert.doesNotMatch(drawPart(bat(24), style, vis()), /高压危险/);
    assert.match(drawPart(bat(25), style, vis()), /高压危险/);
  }
});

test('power box shakes while current flows', () => {
  const d = createDamage();
  assert.equal(partVisual(bat(100), { v: 140, i: 1, p: 140 }, d, true).energized, true);
  assert.equal(partVisual(bat(100), { v: 150, i: 0, p: 0 }, d, true).energized, false);
  assert.match(drawPart(bat(100), 'cartoon', vis({ energized: true })), /class="shake"/);
  assert.doesNotMatch(drawPart(bat(100), 'cartoon', vis()), /class="shake"/);
});

test('burnt lamp, LED and fuse go 砰', () => {
  for (const t of ['lamp', 'led', 'fuse']) for (const style of ['cartoon', 'symbol']) {
    assert.match(drawPart(mk(t), style, vis({ burnt: true })), /class="bubble boom"[\s\S]*砰！/, `${t}/${style}`);
    assert.doesNotMatch(drawPart(mk(t), style, vis()), /砰/);
  }
});

test('fan speed is capped so 150V does not flicker', () => {
  const v = partVisual({ id: 'M', type: 'motor', params: {} }, { v: 50, i: 10, p: 500 }, createDamage(), true);
  assert.ok(v.spin <= 12 && v.spin > 5);
});

test('100 cells solve: lamp overloads, LED burns, short stays at 15A', () => {
  const lamp = solve(loop({ B: ['battery', { cells: 100 }], L: ['lamp'] }, ['B.p', 'L.a', 'L.b', 'B.n']));
  assert.ok(lamp.ok && lamp.parts.L.p > PHYS.LAMP_BURN_P);
  const led = solve(loop({ B: ['battery', { cells: 100 }], R: ['resistor', { ohms: 220 }], D: ['led'] }, ['B.p', 'R.a', 'R.b', 'D.a', 'D.k', 'B.n']));
  assert.ok(led.ok && led.parts.D.i > PHYS.LED_BURN_A);
  for (const cells of [1, 100]) {
    const short = solve(loop({ B: ['battery', { cells }] }, ['B.p', 'B.n']));
    assert.ok(Math.abs(Math.abs(short.parts.B.i) - 15) < 0.2, `${cells}: ${short.parts.B.i}`);
  }
});

test('cells panel: stepper and presets', () => {
  const def = PARTS.battery.params.cells;
  const h = paramHtml('cells', def, 12);
  assert.match(h, /data-value='11'[^>]*>−</);
  assert.match(h, /data-value='13'[^>]*>\+</);
  assert.match(h, /12 节/);
  for (const v of def.presets) assert.match(h, new RegExp(`data-value='${v}'`));
  assert.match(paramHtml('cells', def, 1), /data-value='1' disabled>−/);
  assert.match(paramHtml('cells', def, 100), /data-value='100' disabled>\+/);
  assert.match(paramHtml('cells', def, 4), /class="btn on"[^>]*data-value='4'>4</);
});

test('upright power box stacks its two labels along the long side', () => {
  for (const rot of [0, 1, 2, 3]) {
    const s = drawPart(bat(100, rot), 'cartoon', vis());
    const at = t => s.match(new RegExp(`<text x="(-?[\\d.]+)" y="(-?[\\d.]+)"[^>]*>${t}<`)).slice(1).map(Number);
    const [vx, vy] = at('150V'), [cx, cy] = at('100节');
    if (rot % 2) {
      assert.equal(vy, cy, `rot ${rot} same row`);
      assert.ok(Math.abs(vx - cx) >= 22, `rot ${rot} apart`);
    } else assert.equal(vx, cx, `rot ${rot} same column`);
  }
});
