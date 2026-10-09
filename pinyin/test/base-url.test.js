import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBaseUrl } from '../lib/base-url.js';

const OSS = 'https://ohsaisai.oss-cn-shanghai.aliyuncs.com/pinyin/';

test('默认用 manifest 里的地址', () => {
  assert.equal(resolveBaseUrl(OSS, ''), OSS);
  assert.equal(resolveBaseUrl(OSS, '?foo=1'), OSS);
});

test('?audio=local 指向同源的 audio/ 目录', () => {
  // OSS 的跨域规则只放行 saisai.me，本地 HTTPS 测试取不到音频。
  assert.equal(resolveBaseUrl(OSS, '?audio=local'), 'audio/');
});

test('?audio=<地址> 直接当作 baseUrl', () => {
  assert.equal(resolveBaseUrl(OSS, '?audio=https://cdn.example/x/'),
    'https://cdn.example/x/');
});

test('给的地址没有结尾斜杠也补上', () => {
  assert.equal(resolveBaseUrl(OSS, '?audio=https://cdn.example/x'),
    'https://cdn.example/x/');
  assert.equal(resolveBaseUrl(OSS, '?audio=audio'), 'audio/');
});

test('空值退回 manifest 的地址', () => {
  assert.equal(resolveBaseUrl(OSS, '?audio='), OSS);
});
