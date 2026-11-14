import test from 'node:test';
import assert from 'node:assert/strict';
import { taskListHtml, taskbarHtml, parseAnswer } from '../lib/taskbar.js';
import { createEditor, reduce } from '../lib/editor.js';

const inTask = index => reduce(reduce(createEditor(), { type: 'setMode', mode: 'task' }), { type: 'chooseTask', index });

test('taskListHtml groups 29 levels under 6 chapter headings', () => {
  const html = taskListHtml();
  assert.equal((html.match(/<h3>/g) || []).length, 6);
  assert.equal((html.match(/data-task=/g) || []).length, 29);
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
