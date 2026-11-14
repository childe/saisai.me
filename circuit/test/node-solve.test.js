import test from 'node:test';
import assert from 'node:assert/strict';
import { solve } from '../lib/solve.js';
import { settle } from '../lib/engine.js';
import { createDamage } from '../lib/damage.js';
import { PARTS, PART_TYPES, PHYS, wireR } from '../lib/parts.js';
import { cloneCircuit } from '../lib/circuit.js';
import { build, loop } from './helpers.js';

const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), 1e-12);
const sameReadings = (r0, r1, ids, tol) => {
  for (const id of ids) for (const k of ['v', 'i', 'p'])
    assert.ok(rel(r0.parts[id][k], r1.parts[id][k]) <= tol, `${id}.${k} ${r0.parts[id][k]} vs ${r1.parts[id][k]}`);
};
// B.p → N.o → X.<t0>，两段各 R/2；X.<t1> → B.n
const viaNode = (xType, t0, t1) => {
  const c = build({ parts: { B: ['battery'], N: ['node'], X: [xType] }, wires: [['B.p', 'N.o'], ['N.o', `X.${t0}`], [`X.${t1}`, 'B.n']] });
  c.parts[1].y = 9; // 节点不与任何端点重合
  c.wires[0].r = PHYS.R_WIRE / 2; c.wires[1].r = PHYS.R_WIRE / 2;
  return c;
};

test('node part is a hidden one-terminal type', () => {
  assert.deepEqual(PARTS.node.terms, ['o']);
  assert.deepEqual(PARTS.node.termPos.o, [0, 0]);
  assert.equal(PART_TYPES.includes('node'), false);
  assert.equal(PART_TYPES.length, 16);
});

test('wire resistance defaults to R_WIRE and r is used by the solver', () => {
  assert.equal(wireR({}), PHYS.R_WIRE);
  assert.equal(wireR({ r: 0.25 }), 0.25);
  const c = loop({ B: ['battery'], L: ['lamp'] }, ['B.p', 'L.a', 'L.b', 'B.n']);
  c.wires[0].r = 1;
  const r = solve(c);
  assert.ok(rel(r.parts.L.i, 1.5 / (PHYS.R_CELL + PHYS.LAMP_R + 1 + PHYS.R_WIRE)) < 1e-6);
  assert.ok(rel(r.wires.w1.i, r.parts.L.i) < 1e-6);
});

test('a node on a wire changes nothing (lamp loop and low-resistance ammeter loop)', () => {
  const lamp0 = solve(loop({ B: ['battery'], X: ['lamp'] }, ['B.p', 'X.a', 'X.b', 'B.n']));
  const lamp1 = solve(viaNode('lamp', 'a', 'b'));
  sameReadings(lamp0, lamp1, ['B', 'X'], 1e-9);
  assert.deepEqual(lamp1.parts.N, { v: 0, i: 0, p: 0 });
  const am0 = solve(loop({ B: ['battery'], X: ['ammeter'] }, ['B.p', 'X.p', 'X.n', 'B.n']));
  assert.ok(Math.abs(am0.parts.X.i - 13.39) < 0.01);
  sameReadings(am0, solve(viaNode('ammeter', 'p', 'n')), ['B', 'X'], 1e-9);
});

test('parallel through nodes matches parallel from one terminal (1e-3)', () => {
  const direct = build({ parts: { B: ['battery'], L1: ['lamp'], L2: ['lamp'] },
    wires: [['B.p', 'L1.a'], ['B.p', 'L2.a'], ['L1.b', 'B.n'], ['L2.b', 'B.n']] });
  const nodes = build({ parts: { B: ['battery'], N1: ['node'], N2: ['node'], L1: ['lamp'], L2: ['lamp'] },
    wires: [['B.p', 'N1.o'], ['N1.o', 'L1.a'], ['N1.o', 'L2.a'], ['L1.b', 'N2.o'], ['L2.b', 'N2.o'], ['N2.o', 'B.n']] });
  nodes.parts[1].y = 12; nodes.parts[2].y = 14;
  const a = solve(direct), b = solve(nodes);
  for (const id of ['L1', 'L2']) {
    assert.ok(rel(a.parts[id].p, b.parts[id].p) <= 1e-3);
    assert.ok(b.parts[id].p >= PHYS.LAMP_LIT_P);
  }
  assert.deepEqual(settle(nodes, createDamage()).damage.broken, {});
});

test('node coincident with a terminal is connected', () => {
  // L.a 在 (13,5)；把 N 放到同一格点，N.o—B.p 一根导线即可点亮灯
  const c = build({ parts: { B: ['battery'], N: ['node'], L: ['lamp'] }, wires: [['B.p', 'N.o'], ['L.b', 'B.n']] });
  c.parts[1].x = 13; c.parts[1].y = 5; c.parts[2].x = 15; c.parts[2].y = 5;
  assert.ok(solve(c).parts.L.p >= PHYS.LAMP_LIT_P);
});

test('cloneCircuit keeps via mode and r', () => {
  const c = loop({ B: ['battery'], L: ['lamp'] }, ['B.p', 'L.a', 'L.b', 'B.n']);
  c.wires[0].via = [[3, 8]]; c.wires[0].r = 0.0005;
  const k = cloneCircuit(c);
  assert.deepEqual(k.wires[0].via, [[3, 8]]);
  assert.equal(k.wires[0].r, 0.0005);
  assert.equal('via' in k.wires[1], false);
  k.wires[0].via[0][0] = 99;
  assert.equal(c.wires[0].via[0][0], 3);
  c.wires[1].via = [];
  assert.deepEqual(cloneCircuit(c).wires[1].via, []);
});
