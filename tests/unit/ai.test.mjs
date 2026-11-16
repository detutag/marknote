import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_ACTIONS,
  buildMessages,
  chatCompletion,
  chatCompletionsUrl,
  extractJson,
  normalizeSuggestion,
  sseToTextStream,
  stripThinking,
} from '../../lib/ai.js';

test('chatCompletionsUrl 接受各種 base URL 寫法', () => {
  assert.equal(chatCompletionsUrl('https://api.openai.com/v1'), 'https://api.openai.com/v1/chat/completions');
  assert.equal(chatCompletionsUrl('https://api.openai.com/v1/'), 'https://api.openai.com/v1/chat/completions');
  assert.equal(chatCompletionsUrl('http://localhost:11434/v1/chat/completions'), 'http://localhost:11434/v1/chat/completions');
  assert.throws(() => chatCompletionsUrl(''));
});

test('buildMessages：每個文字動作都產生 system + user', () => {
  for (const action of Object.keys(AI_ACTIONS)) {
    if (action === 'custom') continue;
    const msgs = buildMessages({ action, text: '內容', title: '標題', categories: ['工作'], tags: ['a'] });
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, 'system');
    assert.match(msgs[1].content, /內容/);
  }
  assert.match(buildMessages({ action: 'translate', text: 'x', language: '日文' })[1].content, /日文/);
  assert.match(buildMessages({ action: 'custom', text: 'x', instruction: '改成表格' })[1].content, /改成表格/);
  assert.throws(() => buildMessages({ action: 'custom', text: 'x' }));
  assert.throws(() => buildMessages({ action: 'hack', text: 'x' }));
  assert.match(buildMessages({ action: 'suggest', text: 'x', categories: ['工作', '生活'] })[0].content, /工作、生活/);
});

test('stripThinking 去掉 <think> 與外層 code fence', () => {
  assert.equal(stripThinking('<think>想一想</think>\n\n答案'), '答案');
  assert.equal(stripThinking('```markdown\n# 標題\n內文\n```'), '# 標題\n內文');
  assert.equal(stripThinking('前言\n```js\ncode\n```'), '前言\n```js\ncode\n```');
});

test('extractJson 與 normalizeSuggestion', () => {
  const raw = extractJson('好的：```json\n{"title":"週會","category":"工作","tags":["#會議","會議","MCP"],"summary":"s"}\n```');
  assert.equal(raw.title, '週會');
  const s = normalizeSuggestion(raw, { categories: ['工作'] });
  assert.deepEqual(s, { title: '週會', category: '工作', tags: ['會議', 'MCP'], summary: 's' });
  assert.equal(normalizeSuggestion({ category: '不存在' }, { categories: ['工作'] }).category, '');
  assert.equal(extractJson('沒有 JSON'), null);
});

function streamOf(chunks) {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

async function readAll(stream) {
  return new Response(stream).text();
}

test('sseToTextStream 解析跨 chunk 的 SSE 與多位元組字元', async () => {
  const enc = new TextEncoder();
  const ev = (content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
  const full = `${ev('你好')}: keep-alive\n\n${ev('，世界')}data: {"choices":[{"delta":{"reasoning_content":"略"}}]}\n\n${ev('！')}data: [DONE]\n\n`;
  const bytes = enc.encode(full);
  // 故意在多位元組字元中間切開
  const parts = [bytes.slice(0, 7), bytes.slice(7, 50), bytes.slice(50)];
  const stream = new ReadableStream({
    start(c) {
      for (const p of parts) c.enqueue(p);
      c.close();
    },
  });
  assert.equal(await readAll(sseToTextStream(stream)), '你好，世界！');
  // 最後一個事件沒有結尾空行也要輸出
  assert.equal(await readAll(sseToTextStream(streamOf([ev('A'), 'data: {"choices":[{"delta":{"content":"B"}}]}']))), 'AB');
});

test('chatCompletion：帶金鑰、模型與錯誤訊息', async () => {
  const config = { baseUrl: 'https://example.com/v1', apiKey: 'sk-test', model: 'm1', temperature: 0.3, maxTokens: 100 };
  let seen;
  const okFetch = async (url, init) => {
    seen = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ choices: [{ message: { content: '<think>x</think>結果' } }] }), {
      headers: { 'content-type': 'application/json' },
    });
  };
  const out = await chatCompletion({ config, messages: [{ role: 'user', content: 'hi' }], fetchImpl: okFetch });
  assert.equal(out, '結果');
  assert.equal(seen.url, 'https://example.com/v1/chat/completions');
  assert.equal(seen.init.headers.authorization, 'Bearer sk-test');
  assert.equal(seen.body.model, 'm1');
  assert.equal(seen.body.max_tokens, 100);

  const noKey = await chatCompletion({ config: { ...config, apiKey: '' }, messages: [], fetchImpl: okFetch });
  assert.equal(noKey, '結果');
  assert.equal(seen.init.headers.authorization, undefined);

  const badFetch = async () => new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), { status: 401 });
  await assert.rejects(chatCompletion({ config, messages: [], fetchImpl: badFetch }), (err) => err.status === 401 && /Invalid API key/.test(err.message));
});
