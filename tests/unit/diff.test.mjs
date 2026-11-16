import test from 'node:test';
import assert from 'node:assert/strict';
import { collapseSame, diffLines, diffStats } from '../../lib/diff.js';

const render = (parts) => parts.map((p) => (p.type === 'add' ? `+${p.text}` : p.type === 'del' ? `-${p.text}` : p.type === 'skip' ? `~${p.count}` : ` ${p.text}`));

test('diffLines 基本比對', () => {
  assert.deepEqual(render(diffLines('a\nb\nc', 'a\nB\nc')), [' a', '-b', '+B', ' c']);
  assert.deepEqual(render(diffLines('', 'x')), ['-', '+x']);
  assert.deepEqual(diffStats(diffLines('a\nb', 'a\nb\nc')), { added: 1, removed: 0 });
  assert.deepEqual(diffStats(diffLines('same', 'same')), { added: 0, removed: 0 });
});

test('超過上限時退化為整段替換', () => {
  const parts = diffLines('1\n2\n3', '4\n5\n6', { maxCells: 1 });
  assert.deepEqual(diffStats(parts), { added: 3, removed: 3 });
});

test('collapseSame 折疊未變更的長段', () => {
  const before = Array.from({ length: 20 }, (_, i) => `L${i}`).join('\n');
  const after = before.replace('L10', 'X');
  const out = render(collapseSame(diffLines(before, after), 2));
  assert.deepEqual(out, ['~8', ' L8', ' L9', '-L10', '+X', ' L11', ' L12', '~7']);
});
