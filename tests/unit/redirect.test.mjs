import test from 'node:test';
import assert from 'node:assert/strict';
import { safeNextPath } from '../../lib/redirect.js';

test('safeNextPath：保留站內路徑與查詢字串', () => {
  assert.equal(safeNextPath('/notes/abc?tab=edit'), '/notes/abc?tab=edit');
  assert.equal(safeNextPath('/files'), '/files');
});

test('safeNextPath：擋下開放重新導向與無效值', () => {
  for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'evil.com', '', null, undefined, '/login', '/login?next=/x', '/api/notes', '/%0d%0aSet-Cookie:x', '/\tevil']) {
    const out = safeNextPath(bad);
    // 結果一定是單一 "/" 開頭的站內路徑，且不含原始控制字元（%0d%0a 這類編碼後的字元無害）
    assert.ok(out.startsWith('/') && !out.startsWith('//') && !/[\u0000-\u001f]/.test(out), `${bad} → ${out}`);
    if (['//evil.com', '/\\evil.com', 'https://evil.com', '/login', '/api/notes', '/\tevil'].includes(bad)) assert.equal(out, '/');
  }
});
