import { test } from 'node:test';
import assert from 'node:assert';
import {
  resampleTraj, speakerStats, applyStats, zScores, fuseZ, stars, TRAJ_FRAMES,
} from '../lib/similarity.js';

const traj = (vals) => vals.map((v) => [v]);

test('重采样到固定帧数，端点保持不变', () => {
  const out = resampleTraj(traj([0, 1, 2, 3]), 7);
  assert.equal(out.length, 7);
  assert.equal(out[0][0], 0);
  assert.equal(out[6][0], 3);
});

test('重采样对单帧输入不崩，铺满 n 帧', () => {
  const out = resampleTraj(traj([5]), TRAJ_FRAMES);
  assert.equal(out.length, TRAJ_FRAMES);
  assert.ok(out.every((f) => f[0] === 5));
});

test('重采样对空输入返回空', () => {
  assert.deepEqual(resampleTraj([]), []);
});

test('说话人归一后整体均值约 0、方差约 1', () => {
  const sets = [traj([1, 2, 3]), traj([5, 6, 7])];
  const stats = speakerStats(sets);
  const all = sets.flatMap((s) => applyStats(s, stats)).map((f) => f[0]);
  const m = all.reduce((s, v) => s + v, 0) / all.length;
  const sd = Math.sqrt(all.reduce((s, v) => s + (v - m) ** 2, 0) / all.length);
  assert.ok(Math.abs(m) < 1e-9);
  assert.ok(Math.abs(sd - 1) < 1e-9);
});

test('常数维不除零', () => {
  const stats = speakerStats([traj([3, 3, 3])]);
  const out = applyStats(traj([3]), stats);
  assert.ok(Number.isFinite(out[0][0]));
});

/** 造一组候选：目标和探测音一样，其它候选依次拉远。 */
function fixture() {
  const probe = resampleTraj(traj([0, 0, 0]));
  const refs = new Map();
  refs.set('target', resampleTraj(traj([0, 0, 0])));
  refs.set('near', resampleTraj(traj([1, 1, 1])));
  for (let i = 0; i < 8; i++) {
    refs.set(`far${i}`, resampleTraj(traj([5 + i, 5 + i, 5 + i])));
  }
  return { probe, refs };
}

test('z：对上的候选为正，远的为负', () => {
  const { probe, refs } = fixture();
  const z = zScores(probe, refs);
  assert.ok(z.get('target') > 1, `target z=${z.get('target')}`);
  assert.ok(z.get('target') > z.get('near'));
  assert.ok(z.get('far7') < 0);
});

test('z 对整体缩放不变 —— 说话人、音量的差异就是这么被抵消的', () => {
  const { probe, refs } = fixture();
  const base = zScores(probe, refs);

  const scaled = new Map();
  for (const [k, v] of refs) scaled.set(k, v.map((f) => [f[0] * 3]));
  const z2 = zScores(probe.map((f) => [f[0] * 3]), scaled);

  for (const k of refs.keys()) {
    assert.ok(Math.abs(base.get(k) - z2.get(k)) < 1e-6,
      `${k}: ${base.get(k)} vs ${z2.get(k)}`);
  }
});

test('候选不足 2 个时不产生 NaN', () => {
  const z = zScores(resampleTraj(traj([0])), new Map([['only', resampleTraj(traj([1]))]]));
  assert.ok(Number.isFinite(z.get('only')));
});

test('融合取平均，忽略缺失项', () => {
  const a = new Map([['x', 1], ['y', -1]]);
  const b = new Map([['x', 3], ['y', NaN]]);
  const f = fuseZ([a, b]);
  assert.equal(f.get('x'), 2);
  assert.equal(f.get('y'), -1);
});

test('融合对空输入返回空', () => {
  assert.equal(fuseZ([]).size, 0);
  assert.equal(fuseZ([null, new Map()]).size, 0);
});

test('星级在两端饱和，不越界', () => {
  assert.equal(stars(-5), 0);
  assert.equal(stars(99), 10);
  assert.equal(stars(NaN), 0);
  const mid = stars(0.85);
  assert.ok(mid > 0 && mid < 10);
});
