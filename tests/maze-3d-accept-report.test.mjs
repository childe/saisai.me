import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const script = readFileSync(join(here, 'browser', 'maze3d_accept.py'), 'utf8');

test('acceptance report labels automated result separately from manual check', () => {
  assert.match(script, /f"自动检查：\{'PASS' if all_ok else 'FAIL'\}"/);
  assert.doesNotMatch(script, /总体：/);
  assert.match(script, /人工检查：/);
});
