import test from 'node:test';
import assert from 'node:assert/strict';
import { wireItems } from '../view.js';
import { build } from './helpers.js';

test('handles are drawn only on the selected wire, one per segment midpoint', () => {
  const c = build({ parts: { B: ['battery'], L: ['lamp'] }, wires: [['B.p', 'L.a']] });
  c.parts[0].x = 5; c.parts[0].y = 5; c.parts[1].x = 15; c.parts[1].y = 10;
  const space = { circuit: c };
  assert.doesNotMatch(wireItems({ selection: null }, space)[0].html, /class="handle"/);
  const html = wireItems({ selection: { kind: 'wire', id: 'w1' } }, space)[0].html;
  const hs = [...html.matchAll(/class="handle" cx="([\d.]+)" cy="([\d.]+)"/g)].map(m => [Number(m[1]), Number(m[2])]);
  assert.deepEqual(hs, [[320, 200], [520, 300]]);
});
