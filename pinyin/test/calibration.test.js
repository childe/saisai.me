import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scorePronunciation } from '../lib/score.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

if (files.length === 0) {
  // 还没采样本。不让它变成红的，但要在输出里看得见这个缺口。
  test.skip('阈值校准：尚无真实录音样本，见 test/fixtures/README.md', () => {});
} else {
  test('样本数够一轮校准', () => {
    assert.ok(files.length >= 12, '只有 ' + files.length + ' 条样本');
  });

  for (const f of files) {
    const fx = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    test(`真实样本：${fx.label}`, () => {
      const r = scorePronunciation(fx.input);
      if (fx.expectStars === null) {
        assert.equal(r.stars, null);
        return;
      }
      const [lo, hi] = fx.expectStars;
      assert.ok(r.stars >= lo && r.stars <= hi,
        `${fx.label} 得了 ${r.stars} 星，期望 ${lo}–${hi}`);
      if (fx.expectTone) assert.equal(r.tone.detected, fx.expectTone);
    });
  }
}
