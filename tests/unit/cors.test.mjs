import test from 'node:test';
import assert from 'node:assert/strict';
import { corsAllows, isAutoCorsEnabled, mergeCorsOrigin, normalizeOrigin, requestSiteOrigin } from '../../lib/cors.js';

const h = (o) => new Headers(o);

test('normalizeOrigin', () => {
  assert.equal(normalizeOrigin('https://a.example.com/path?x=1'), 'https://a.example.com');
  assert.equal(normalizeOrigin('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(normalizeOrigin('ftp://x'), '');
  assert.equal(normalizeOrigin('null'), '');
});

test('requestSiteOrigin 只接受與請求主機相同的來源', () => {
  assert.equal(requestSiteOrigin(h({ origin: 'https://note.example.com', host: 'note.example.com' })), 'https://note.example.com');
  assert.equal(requestSiteOrigin(h({ origin: 'https://evil.com', host: 'note.example.com' })), '');
  assert.equal(requestSiteOrigin(h({ origin: 'https://x.vercel.app', host: 'internal', 'x-forwarded-host': 'x.vercel.app' })), 'https://x.vercel.app');
  assert.equal(requestSiteOrigin(h({ host: 'note.example.com' })), '');
});

test('mergeCorsOrigin', () => {
  assert.deepEqual(mergeCorsOrigin([], 'https://a.com')[0].AllowedOrigins, ['https://a.com']);
  const rules = [{ AllowedOrigins: ['http://localhost:3000'], AllowedMethods: ['GET', 'PUT'] }];
  assert.deepEqual(mergeCorsOrigin(rules, 'https://a.com')[0].AllowedOrigins, ['http://localhost:3000', 'https://a.com']);
  assert.equal(mergeCorsOrigin(rules, 'http://localhost:3000'), null);
  assert.equal(mergeCorsOrigin([{ AllowedOrigins: ['*'], AllowedMethods: ['PUT'] }], 'https://a.com'), null);
  const many = [{ AllowedOrigins: ['1', '2', '3'], AllowedMethods: ['PUT'] }];
  assert.deepEqual(mergeCorsOrigin(many, '4', 3)[0].AllowedOrigins, ['2', '3', '4']);
  assert.ok(corsAllows([{ AllowedOrigins: ['https://a.com'], AllowedMethods: ['PUT'] }], 'https://a.com'));
});

test('isAutoCorsEnabled', () => {
  assert.equal(isAutoCorsEnabled({}), true);
  assert.equal(isAutoCorsEnabled({ STORAGE_AUTO_CORS: '0' }), false);
  assert.equal(isAutoCorsEnabled({ STORAGE_AUTO_CORS: 'off' }), false);
});
