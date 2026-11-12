import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { MazeGenerator } from '../maze-3d/maze-core.js';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'maze-gen', 'maze.html'), 'utf8');

// 从 marker 所在位置起，按花括号配对截取到匹配的 `}`
export function extractBlock(src, marker) {
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`marker not found: ${JSON.stringify(marker)}`);
  const open = src.indexOf('{', start + marker.trimEnd().length - 1);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced block: ${marker}`);
}

export function load2D() {
  const src =
    extractBlock(html, 'class SeededRandom {') +
    '\n' +
    extractBlock(html, 'class MazeGenerator {') +
    ';({SeededRandom, MazeGenerator})';
  return vm.runInContext(src, vm.createContext({ console: { log() {} } }));
}

const TwoD = load2D();

const SEEDS = [1, 42, 12345, 987654321, 1700000000000];
test('maze-core generator equals 2D generator', () => {
  for (const seed of SEEDS)
    for (const size of [10, 15, 20]) {
      const a = new TwoD.MazeGenerator(size, size, seed).generate();
      const b = new MazeGenerator(size, size, seed).generate();
      assert.deepEqual(
        JSON.parse(JSON.stringify(b)),
        JSON.parse(JSON.stringify(a)),
        `seed=${seed} size=${size}`,
      );
    }
});

test('extractBlock finds both classes', () => {
  assert.match(extractBlock(html, 'class MazeGenerator {'), /generate\(\)/);
  assert.ok(extractBlock(html, 'class MazeGenerator {').trim().endsWith('}'));
  assert.match(extractBlock(html, 'class SeededRandom {'), /shuffle\(/);
});
