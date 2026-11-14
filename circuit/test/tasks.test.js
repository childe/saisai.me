import test from 'node:test';
import assert from 'node:assert/strict';
import { TASKS, CHAPTERS, evaluateTask, remainingPalette, goalText, chapterIndex } from '../lib/tasks.js';
import { settle } from '../lib/engine.js';
import { createDamage } from '../lib/damage.js';
import { addPart } from '../lib/circuit.js';
import { build } from './helpers.js';

const T = id => TASKS.find(t => t.id === id);
const run = (id, c, progress = T(id).initProgress()) => evaluateTask(T(id), progress, settle(c, createDamage()));

test('remainingPalette counts non-preset parts on canvas', () => {
  const t = T(1);
  let c = t.preset();
  assert.deepEqual(remainingPalette(t, c), { battery: 1, lamp: 1 });
  c = addPart(c, 'lamp', 5, 5).circuit;
  assert.deepEqual(remainingPalette(t, c), { battery: 1, lamp: 0 });
  assert.deepEqual(remainingPalette(T(4), T(4).preset()), {});
});

test('chapters and ids line up', () => {
  assert.equal(CHAPTERS.length, 7);
  assert.ok(TASKS.every(t => t.chapter >= 1 && t.chapter <= 7));
  assert.equal(new Set(TASKS.map(t => t.id)).size, TASKS.length);
  assert.deepEqual(TASKS.map(t => t.id), [...TASKS.map(t => t.id)].sort((a, b) => a - b));
});

test('tasks in curriculum order', () => {
  assert.deepEqual(TASKS.map(t => t.name), ['点亮一盏灯', '加个开关', '门铃', '让风扇反转', '让 LED 亮起来',
    '串联和并联', '一个亮一个灭', '保险箱', '前门后门', '总开关',
    '量一量', '串联电流', '串联分压', '并联干路', '精确调电流', 'LED 能受多大电流',
    '主灯和小灯', '混联电流', '越灭越亮', '一盏调光一盏不变',
    '哪盏灯坏了', '断掉的导线', '失灵的开关',
    '楼梯灯', '保险丝救场', '红绿灯', '两档风扇', '防盗报警', '风扇和灯',
    '认识数字显示器', '半加器', '认识继电器', '继电器非门', '继电器与门 / 或门', '自制电铃', '全加器']);
  assert.deepEqual(TASKS.map(t => t.id), Array.from({ length: 36 }, (_, i) => i + 1));
  const per = [1, 2, 3, 4, 5, 6, 7].map(n => TASKS.filter(t => t.chapter === n).length);
  assert.deepEqual(per, [5, 5, 6, 4, 3, 6, 7]);
});

test('existing tasks keep curriculum ids and names', () => {
  const names = Object.fromEntries(TASKS.map(t => [t.id, t.name]));
  assert.deepEqual(names, { 1: '点亮一盏灯', 2: '加个开关', 3: '门铃', 4: '让风扇反转', 5: '让 LED 亮起来',
    6: '串联和并联', 7: '一个亮一个灭', 8: '保险箱', 9: '前门后门', 10: '总开关', 11: '量一量', 12: '串联电流', 13: '串联分压', 14: '并联干路', 15: '精确调电流', 16: 'LED 能受多大电流',
    17: '主灯和小灯', 18: '混联电流', 19: '越灭越亮', 20: '一盏调光一盏不变',
    21: '哪盏灯坏了', 22: '断掉的导线', 23: '失灵的开关', 24: '楼梯灯', 25: '保险丝救场', 26: '红绿灯', 27: '两档风扇', 28: '防盗报警', 29: '风扇和灯',
    30: '认识数字显示器', 31: '半加器', 32: '认识继电器', 33: '继电器非门', 34: '继电器与门 / 或门',
    35: '自制电铃', 36: '全加器' });
});

test('task 25 preset: battery (9,12), lamp (9,5)', () => {
  const c = T(25).preset();
  const at = type => c.parts.find(p => p.type === type);
  assert.deepEqual([at('battery').x, at('battery').y], [9, 12]);
  assert.deepEqual([at('lamp').x, at('lamp').y], [9, 5]);
});

test('goalText takes string or function goals; chapterIndex counts within chapter', () => {
  assert.equal(goalText(T(1), null), '让灯亮起来');
  assert.equal(goalText({ goal: v => `第 ${v} 题` }, 3), '第 3 题');
  assert.equal(chapterIndex(T(1)), 1);
  assert.equal(chapterIndex(T(5)), 5);
  assert.equal(chapterIndex(T(6)), 1);
  assert.equal(chapterIndex(T(24)), 1);
  assert.equal(chapterIndex(T(29)), 6);
});
