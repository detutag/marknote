import { fail, guard, readBody, route } from '@/lib/api';
import { getAiConfig } from '@/lib/config';
import { listCategories, listTags } from '@/lib/data';
import { AI_ACTIONS, buildMessages, chatCompletion, extractJson, normalizeSuggestion, sseToTextStream } from '@/lib/ai';

/**
 * AI 整理／編輯代理：前端 → 本路由 → 自訂 OpenAI 相容端點。
 * 金鑰只留在伺服器；需登入（cookie session）。
 *
 * GET  /api/ai  → { enabled, model, actions }
 * POST /api/ai  { action, text, title?, instruction?, language? }
 *   - 一般動作：回傳 text/plain 串流（逐字輸出）
 *   - action = "suggest"：回傳 JSON { suggestion: { title, category, tags, summary } }
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (req) => {
  const denied = await guard(req);
  if (denied) return denied;
  const cfg = getAiConfig();
  return Response.json({
    enabled: cfg.configured,
    model: cfg.configured ? cfg.model : '',
    actions: Object.entries(AI_ACTIONS).map(([key, v]) => ({ key, ...v })),
  });
});

export const POST = route(async (req) => {
  const denied = await guard(req);
  if (denied) return denied;

  const cfg = getAiConfig();
  if (!cfg.configured) return fail('AI 功能尚未設定：請設定 AI_BASE_URL 與 AI_MODEL', 503);

  const body = await readBody(req);
  if (!body) return fail('請求內容不是合法的 JSON', 400);

  const action = String(body.action || '');
  if (!AI_ACTIONS[action]) return fail('不支援的 AI 動作', 400);
  const text = String(body.text ?? '');
  if (!text.trim()) return fail('沒有可處理的內容', 400);
  if (text.length > cfg.maxInputChars) {
    return fail(`內容太長（${text.length} 字元），上限 ${cfg.maxInputChars}；請先選取部分段落`, 413);
  }

  const timeout = AbortSignal.timeout(cfg.timeoutMs);
  const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;

  if (action === 'suggest') {
    const [categories, tags] = await Promise.all([listCategories(), listTags()]);
    const categoryNames = (categories || []).map((c) => c.name);
    const messages = buildMessages({
      action,
      text: text.slice(0, 20000),
      title: body.title,
      categories: categoryNames,
      tags: (tags || []).map((t) => t.name),
    });
    const raw = await callAi(() => chatCompletion({ config: cfg, messages, signal }));
    if (raw instanceof Response) return raw;
    const suggestion = normalizeSuggestion(extractJson(raw), { categories: categoryNames });
    if (!suggestion) return fail('AI 回傳的格式無法解析，請重試', 502, { raw: String(raw).slice(0, 500) });
    return Response.json({ suggestion });
  }

  let messages;
  try {
    messages = buildMessages({
      action,
      text,
      title: body.title,
      instruction: String(body.instruction ?? '').slice(0, 2000),
      language: String(body.language ?? '').slice(0, 40),
    });
  } catch (err) {
    return fail(err.message, 400);
  }

  const upstream = await callAi(() => chatCompletion({ config: cfg, messages, stream: true, signal }));
  if (!(upstream instanceof Response) || !upstream.ok) return upstream;
  if (upstream.headers.get('content-type')?.includes('application/json')) {
    // 有些相容服務忽略 stream:true，直接回完整 JSON
    const data = await upstream.json();
    const content = data?.choices?.[0]?.message?.content ?? '';
    return new Response(content, { headers: textHeaders(cfg.model) });
  }
  return new Response(sseToTextStream(upstream.body), { headers: textHeaders(cfg.model) });
});

function textHeaders(model) {
  return {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store, no-transform',
    'x-accel-buffering': 'no',
    'x-ai-model': encodeURIComponent(model),
  };
}

/** 呼叫上游，把常見錯誤轉成給使用者看的訊息 */
async function callAi(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err?.name === 'TimeoutError') return fail('AI 服務逾時，請縮短內容或稍後再試', 504);
    if (err?.name === 'AbortError') return fail('已取消', 499);
    if (err?.status) {
      const status = err.status === 401 || err.status === 403 ? 502 : err.status === 429 ? 429 : 502;
      return fail(err.message, status);
    }
    console.error('[ai error]', err);
    return fail(`無法連線到 AI 服務：${err?.message || err}`, 502);
  }
}
