import test from 'node:test';
import assert from 'node:assert/strict';
import { pickVoice, voiceBaseUrl } from '../lib/voice.js';

const DATA = {
  baseUrl: 'https://cdn/pinyin/',
  defaultVoice: 'aitong',
  voices: [
    { id: 'aitong', label: '童声' },
    { id: 'xiaoyun', label: '女声' },
    { id: 'xiaogang', label: '男声' },
  ],
};

test('没有存过时用默认音色', () => {
  assert.equal(pickVoice(DATA, null, ''), 'aitong');
});

test('用存下来的选择', () => {
  assert.equal(pickVoice(DATA, 'xiaogang', ''), 'xiaogang');
});

test('存的音色不在表里就回到默认', () => {
  // 以后删掉某个音色，老浏览器里存的值不能让页面放不出声
  assert.equal(pickVoice(DATA, 'laowang', ''), 'aitong');
});

test('?voice= 覆盖存下来的选择', () => {
  assert.equal(pickVoice(DATA, 'aitong', '?voice=xiaoyun'), 'xiaoyun');
});

test('?voice= 给了不存在的值也回到默认', () => {
  assert.equal(pickVoice(DATA, 'xiaoyun', '?voice=nobody'), 'aitong');
});

test('默认音色缺失时退回第一个', () => {
  const d = { ...DATA, defaultVoice: 'gone' };
  assert.equal(pickVoice(d, null, ''), 'aitong');
});

test('没有 voices 字段时返回空串，调用方退回旧路径', () => {
  assert.equal(pickVoice({ baseUrl: 'https://cdn/pinyin/' }, 'x', ''), '');
});

test('音色拼进 URL 前缀', () => {
  assert.equal(voiceBaseUrl('https://cdn/pinyin/', 'xiaoyun'), 'https://cdn/pinyin/xiaoyun/');
});

test('baseUrl 没有结尾斜杠也补上', () => {
  assert.equal(voiceBaseUrl('https://cdn/pinyin', 'aitong'), 'https://cdn/pinyin/aitong/');
});

test('音色为空时不改 baseUrl', () => {
  assert.equal(voiceBaseUrl('https://cdn/pinyin/', ''), 'https://cdn/pinyin/');
});
