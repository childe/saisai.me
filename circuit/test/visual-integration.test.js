// 求解 → 视觉映射 → 绘图 的端到端用例：保证教学表达（灯亮/灯灭）与物理结果一致。
import test from 'node:test';
import assert from 'node:assert/strict';
import { solve } from '../lib/solve.js';
import { partVisual } from '../lib/viewmodel.js';
import { drawPart } from '../lib/drawings.js';
import { createDamage } from '../lib/damage.js';
import { build, loop } from './helpers.js';

const STYLES = ['cartoon', 'symbol'];

function lampArt(circuit, id) {
  const r = solve(circuit);
  assert.equal(r.ok, true);
  const part = circuit.parts.find(p => p.id === id);
  const vis = partVisual(part, r.parts[id], createDamage(), r.ok);
  return { vis, art: Object.fromEntries(STYLES.map(s => [s, drawPart(part, s, vis)])) };
}

function assertDark({ vis, art }) {
  assert.equal(vis.glow, 0);
  for (const s of STYLES) assert.doesNotMatch(art[s], /class="glow"/, s);
  assert.doesNotMatch(art.cartoon, /#fff4b0/);
}

test('voltmeter in series with lamp: lamp drawn dark', () => {
  assertDark(lampArt(loop({ B: ['battery'], V: ['voltmeter'], L: ['lamp'] },
    ['B.p', 'V.p', 'V.n', 'L.a', 'L.b', 'B.n']), 'L'));
});

test('voltmeter across open switch: lamp drawn dark', () => {
  assertDark(lampArt(build({ parts: { B: ['battery'], S: ['switch'], L: ['lamp'], V: ['voltmeter'] },
    wires: [['B.p', 'S.a'], ['S.b', 'L.a'], ['L.b', 'B.n'], ['V.p', 'S.a'], ['V.n', 'S.b']] }), 'L'));
});

test('lamp on one cell: lamp drawn lit in both styles', () => {
  const { vis, art } = lampArt(loop({ B: ['battery'], L: ['lamp'] }, ['B.p', 'L.a', 'L.b', 'B.n']), 'L');
  assert.ok(vis.glow > 0);
  for (const s of STYLES) assert.match(art[s], /class="glow"/, s);
  assert.match(art.cartoon, /#fff4b0/);
});
