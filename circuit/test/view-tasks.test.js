import test from 'node:test';
import assert from 'node:assert/strict';
import { taskListHtml, taskbarHtml, parseAnswer } from '../lib/taskbar.js';
import { createEditor, reduce } from '../lib/editor.js';
import { TASKS } from '../lib/tasks.js';

const T = id => TASKS.find(t => t.id === id);
const inTask = index => reduce(reduce(createEditor(), { type: 'setMode', mode: 'task' }), { type: 'chooseTask', index });
const inLevel = id => inTask(TASKS.indexOf(T(id)));

test('taskListHtml groups 48 levels under 7 chapter headings', () => {
  const html = taskListHtml();
  assert.equal((html.match(/<h3>/g) || []).length, 7);
  assert.equal((html.match(/data-task=/g) || []).length, 48);
  assert.ok(html.includes('第 7 章 · 电容与定时'));
  assert.ok(html.includes('第 6 章 · 逻辑与加法器'));
  assert.ok(html.includes('第 5 章 · 单刀双掷开关与保险丝'));
  assert.ok(html.includes('第 3 章 · 电表'));
  assert.ok(html.includes('第 6 关 · LED 能受多大电流'));
  assert.ok(html.includes('data-task="15"'));
  // 第 3 章末尾是教学关「断开的地方」，第 5 章第 2 关是挪过来的「失灵的开关」
  const at = s => html.indexOf(s);
  assert.ok(at('第 3 章 · 电表') < at('第 7 关 · 断开的地方') && at('第 7 关 · 断开的地方') < at('第 4 章 · 混联'));
  assert.ok(at('第 5 章 · 单刀双掷开关与保险丝') < at('第 2 关 · 失灵的开关') && at('第 2 关 · 失灵的开关') < at('第 6 章 · 逻辑与加法器'));
});

test('taskbarHtml: predict level shows answer row, disabled after submit', () => {
  const s = inLevel(12);
  const html = taskbarHtml(s);
  assert.ok(html.includes('第 3 章 · 第 2 关 · 串联电流'));
  assert.ok(html.includes('answerInput'));
  assert.ok(html.includes('我猜好了'));
  assert.doesNotMatch(html, /disabled/);
  const s2 = reduce(s, { type: 'submitAnswer', value: 0.15 });
  assert.equal(s2.task.progress.answer, 0.15);
  const h2 = taskbarHtml(s2);
  assert.match(h2, /disabled/);
  assert.ok(h2.includes('value="0.15"'));
});

test('taskbarHtml: accuse button disabled with a prompt while nothing is selected', () => {
  const s = inLevel(21);
  const html = taskbarHtml(s);
  assert.match(html, /<button[^>]*data-task-action="accuse"[^>]*disabled/);
  assert.ok(html.includes('就是它坏了！'));
  assert.ok(html.includes('点一下你觉得坏的那个，再按这里'));
});

test('taskbarHtml: how line shows for fault levels only', () => {
  const html = taskbarHtml(inLevel(21));
  assert.ok(html.includes('<div class="task-how">'));
  assert.ok(html.includes('读到 3 V 的就是它'));
  assert.ok(html.includes('第 3 章 · 第 8 关 · 哪盏灯坏了：找出坏掉的那一盏灯'));
  assert.ok(!taskbarHtml(inTask(0)).includes('task-how'));
});

const play = (s, ...as) => as.reduce(reduce, s);
const across = (s, e1, e2) => {
  if (!s.task.circuit.parts.some(p => p.type === 'voltmeter')) s = play(s, { type: 'place', partType: 'voltmeter', x: 12, y: 18 });
  for (const w of s.task.circuit.wires.filter(x => !x.preset)) s = play(s, { type: 'deleteWire', id: w.id });
  const m = s.task.circuit.parts.find(p => p.type === 'voltmeter');
  return play(s, { type: 'connect', from: { part: m.id, term: 'p' }, to: e1 }, { type: 'connect', from: { part: m.id, term: 'n' }, to: e2 });
};
const accuseBtn = html => html.match(/<button[^>]*data-task-action="accuse"[^>]*>/)[0];

const TIPS = ['点一下你觉得坏的那个，再按这里', '这关坏的是灯，不是它', '先把电压表接在它两端量一量'];

test('taskbarHtml: accuse states — non-suspect, unprobed suspect, probed suspect, passed', () => {
  let s = inLevel(21);
  const bat = s.task.circuit.parts.find(p => p.type === 'battery');
  const lamp = s.task.circuit.parts.find(p => p.type === 'lamp' && p.fault);
  s = across(s, { part: bat.id, term: 'p' }, { part: bat.id, term: 'n' });
  assert.ok(s.task.progress.probed.includes(`part:${bat.id}`));
  // 选中电池：量过了，但这关坏的是灯
  s = play(s, { type: 'select', target: { kind: 'part', id: bat.id } });
  let html = taskbarHtml(s);
  assert.match(accuseBtn(html), /disabled/);
  assert.ok(html.includes('这关坏的是灯，不是它'));
  // 选中没量过的坏灯
  s = play(s, { type: 'select', target: { kind: 'part', id: lamp.id } });
  html = taskbarHtml(s);
  assert.match(accuseBtn(html), /disabled/);
  assert.ok(html.includes('先把电压表接在它两端量一量'));
  // 量过坏灯再选中：可点，没有说明
  s = across(s, { part: lamp.id, term: 'a' }, { part: lamp.id, term: 'b' });
  s = play(s, { type: 'select', target: { kind: 'part', id: lamp.id } });
  html = taskbarHtml(s);
  assert.doesNotMatch(accuseBtn(html), /disabled/);
  assert.ok(TIPS.every(tip => !html.includes(tip)));
  const passed = { ...s, task: { ...s.task, passed: true } };
  const h = taskbarHtml(passed);
  assert.match(accuseBtn(h), /disabled/);
  assert.ok(TIPS.every(tip => !h.includes(tip)));
});

test('taskbarHtml: selecting your own voltmeter counts as nothing selected', () => {
  let s = inLevel(21);
  const bat = s.task.circuit.parts.find(p => p.type === 'battery');
  s = across(s, { part: bat.id, term: 'p' }, { part: bat.id, term: 'n' });
  const m = s.task.circuit.parts.find(p => p.type === 'voltmeter');
  s = play(s, { type: 'select', target: { kind: 'part', id: m.id } });
  const html = taskbarHtml(s);
  assert.match(accuseBtn(html), /disabled/);
  assert.ok(html.includes('点一下你觉得坏的那个，再按这里'));
});

test('taskbarHtml: answer row disabled once passed (level 16)', () => {
  const s = inLevel(16);
  assert.doesNotMatch(taskbarHtml(s), /disabled/);
  const html = taskbarHtml({ ...s, task: { ...s.task, passed: true } });
  assert.match(html, /<input id="answerInput"[^>]*disabled/);
  assert.match(html, /<button[^>]*data-task-action="submit"[^>]*disabled/);
});

test('taskbarHtml: plain level has no answer row or accuse', () => {
  const html = taskbarHtml(inTask(0));
  assert.doesNotMatch(html, /answerInput|就是它坏了/);
});

test('parseAnswer', () => {
  assert.equal(parseAnswer('0.15'), 0.15);
  assert.equal(parseAnswer(' 1.5 '), 1.5);
  assert.equal(parseAnswer('0'), 0);
  for (const bad of ['', 'abc', '-1', '  ', 'Infinity']) assert.equal(parseAnswer(bad), null);
});
