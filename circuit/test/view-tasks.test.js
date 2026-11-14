import test from 'node:test';
import assert from 'node:assert/strict';
import { taskListHtml, taskbarHtml, parseAnswer } from '../lib/taskbar.js';
import { createEditor, reduce } from '../lib/editor.js';

const inTask = index => reduce(reduce(createEditor(), { type: 'setMode', mode: 'task' }), { type: 'chooseTask', index });

test('taskListHtml groups 36 levels under 7 chapter headings', () => {
  const html = taskListHtml();
  assert.equal((html.match(/<h3>/g) || []).length, 7);
  assert.equal((html.match(/data-task=/g) || []).length, 36);
  assert.ok(html.includes('第 7 章 · 逻辑与加法器'));
  assert.ok(html.includes('第 3 章 · 电表'));
  assert.ok(html.includes('第 6 关 · LED 能受多大电流'));
  assert.ok(html.includes('data-task="15"'));
});

test('taskbarHtml: predict level shows answer row, disabled after submit', () => {
  const s = inTask(11);
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

test('taskbarHtml: accuse button disabled until measured and a preset item is selected', () => {
  const s = inTask(20);
  const html = taskbarHtml(s);
  assert.match(html, /<button[^>]*data-task-action="accuse"[^>]*disabled/);
  assert.ok(html.includes('就是它坏了！'));
});

const play = (s, ...as) => as.reduce(reduce, s);
const across = (s, e1, e2) => {
  if (!s.task.circuit.parts.some(p => p.type === 'voltmeter')) s = play(s, { type: 'place', partType: 'voltmeter', x: 12, y: 18 });
  for (const w of s.task.circuit.wires.filter(x => !x.preset)) s = play(s, { type: 'deleteWire', id: w.id });
  const m = s.task.circuit.parts.find(p => p.type === 'voltmeter');
  return play(s, { type: 'connect', from: { part: m.id, term: 'p' }, to: e1 }, { type: 'connect', from: { part: m.id, term: 'n' }, to: e2 });
};
const accuseBtn = html => html.match(/<button[^>]*data-task-action="accuse"[^>]*>/)[0];

test('taskbarHtml: accuse needs the selected item probed; disabled after passing', () => {
  let s = inTask(20);
  const bat = s.task.circuit.parts.find(p => p.type === 'battery');
  const lamp = s.task.circuit.parts.find(p => p.type === 'lamp' && p.fault);
  s = across(s, { part: bat.id, term: 'p' }, { part: bat.id, term: 'n' });
  assert.equal(s.task.progress.measured, true);
  s = play(s, { type: 'select', target: { kind: 'part', id: lamp.id } });
  let html = taskbarHtml(s);
  assert.match(accuseBtn(html), /disabled/);
  assert.ok(html.includes('先把电压表接在它两端量一量'));
  s = across(s, { part: lamp.id, term: 'a' }, { part: lamp.id, term: 'b' });
  s = play(s, { type: 'select', target: { kind: 'part', id: lamp.id } });
  html = taskbarHtml(s);
  assert.doesNotMatch(accuseBtn(html), /disabled/);
  assert.ok(!html.includes('先把电压表接在它两端量一量'));
  const passed = { ...s, task: { ...s.task, passed: true } };
  assert.match(accuseBtn(taskbarHtml(passed)), /disabled/);
});

test('taskbarHtml: answer row disabled once passed (level 16)', () => {
  const s = inTask(15);
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
