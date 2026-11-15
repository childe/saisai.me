import test from 'node:test';
import assert from 'node:assert/strict';
import { sync } from '../view.js';

// 最小假 DOM：只实现 sync 用到的部分，并记下每次插入。
function fakeGroup() {
  const kids = [];
  const g = {
    namespaceURI: 'svg', inserts: 0, kids,
    get firstChild() { return kids[0] ?? null; },
    insertBefore(el, ref) {
      g.inserts++;
      const i = kids.indexOf(el);
      if (i >= 0) kids.splice(i, 1);
      kids.splice(ref ? kids.indexOf(ref) : kids.length, 0, el);
    },
  };
  return g;
}
globalThis.document = {
  createElementNS: () => {
    const el = {
      setAttribute() {}, innerHTML: '',
      remove() { const i = el.group.kids.indexOf(el); if (i >= 0) el.group.kids.splice(i, 1); },
    };
    Object.defineProperty(el, 'nextSibling', { get: () => el.group.kids[el.group.kids.indexOf(el) + 1] ?? null });
    return el;
  },
};
const items = ids => ids.map(id => ({ id, attrs: {}, html: id }));
const run = (g, cache, ids) => {
  // 新建的元素要知道自己属于哪个 group
  const orig = document.createElementNS;
  document.createElementNS = (...a) => Object.assign(orig(...a), { group: g });
  sync(g, cache, items(ids));
  document.createElementNS = orig;
};

test('sync leaves elements in place when order is unchanged (CSS animations keep running)', () => {
  const g = fakeGroup(), cache = new Map();
  run(g, cache, ['a', 'b', 'c']);
  assert.equal(g.inserts, 3);
  run(g, cache, ['a', 'b', 'c']);
  assert.equal(g.inserts, 3);
});

test('sync reorders and removes elements to match items', () => {
  const g = fakeGroup(), cache = new Map();
  run(g, cache, ['a', 'b', 'c']);
  run(g, cache, ['c', 'a']);
  assert.deepEqual(g.kids.map(el => el.innerHTML), ['c', 'a']);
  run(g, cache, ['c', 'd', 'a']);
  assert.deepEqual(g.kids.map(el => el.innerHTML), ['c', 'd', 'a']);
});
