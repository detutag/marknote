/**
 * AI 整理／編輯：組 prompt、呼叫 OpenAI 相容的 Chat Completions、解析串流。
 * 本檔不讀環境變數也不碰資料庫（設定由呼叫端傳入），方便單元測試。
 */

/** 可用動作（前端選單與後端驗證共用） */
export const AI_ACTIONS = {
  polish: { label: '潤飾改寫', hint: '讓文字更通順、精準，保留原意' },
  fix: { label: '修正錯字', hint: '只修正錯字、標點與文法' },
  shorten: { label: '精簡', hint: '刪去冗詞，保留重點' },
  expand: { label: '擴寫', hint: '補充細節與說明' },
  organize: { label: '整理結構', hint: '整理成有標題、條列、表格的 Markdown' },
  summarize: { label: '摘要', hint: '產生重點摘要' },
  translate: { label: '翻譯', hint: '翻譯成指定語言' },
  custom: { label: '自訂指令', hint: '依你的指令處理' },
  suggest: { label: '標題／分類／標籤建議', hint: '從現有分類與標籤挑選' },
};

const BASE_RULES = [
  '你是 Markdown 筆記的編輯助手。',
  '只輸出處理後的結果本身：不要前言、不要解釋、不要結語，也不要用 ``` 把整份結果包起來。',
  '保留原有的 Markdown 語法、連結、圖片、HTML 媒體標籤（audio／video／iframe）與程式碼區塊內容。',
  '除非指令要求翻譯，否則使用與原文相同的語言與書寫系統（例如繁體中文維持繁體）。',
].join('\n');

const ACTION_PROMPTS = {
  polish: '潤飾下列內容，讓文字更通順、精準、易讀，保留原意與結構，不要新增原文沒有的事實。',
  fix: '只修正下列內容的錯字、標點與文法錯誤，不要改寫句子或調整結構。',
  shorten: '精簡下列內容：刪去冗詞與重複，保留所有關鍵資訊，長度大約減少一半。',
  expand: '擴寫下列內容：補充細節、例子與說明，維持原有語氣與結構，不要捏造具體數據或來源。',
  organize:
    '把下列內容整理成結構清楚的 Markdown 筆記：依主題分段並加上適當層級的標題（從 ## 開始），' +
    '把並列的資訊改為條列，可比較的資料改為表格，待辦事項改為 - [ ] 清單。保留所有資訊，不要刪減內容。',
  summarize: '為下列內容寫出重點摘要：先用一句話總結，再列出 3 到 7 個重點條列。',
};

/**
 * 組成 Chat Completions 的 messages。
 * @param {{action: string, text: string, title?: string, instruction?: string, language?: string,
 *          categories?: string[], tags?: string[]}} input
 */
export function buildMessages(input = {}) {
  const action = String(input.action || '');
  if (!AI_ACTIONS[action]) throw new Error(`不支援的 AI 動作：${action}`);
  const text = String(input.text ?? '');
  const title = String(input.title ?? '').trim();
  const instruction = String(input.instruction ?? '').trim();

  if (action === 'suggest') {
    const categories = (input.categories || []).map(String).filter(Boolean);
    const tags = (input.tags || []).map(String).filter(Boolean);
    const system = [
      '你是筆記分類助手。閱讀筆記後，只輸出一個 JSON 物件，不要任何其他文字：',
      '{"title": "簡短標題", "category": "分類名稱或空字串", "tags": ["標籤", "..."], "summary": "一句話摘要"}',
      '規則：',
      '- title 不超過 30 字，使用與筆記相同的語言。',
      `- category 只能從現有分類挑選：${categories.length ? categories.join('、') : '（目前沒有分類，請回傳空字串）'}；都不適合就回傳空字串。`,
      `- tags 1 到 5 個，優先使用現有標籤：${tags.length ? tags.join('、') : '（目前沒有標籤）'}；必要時可提出新標籤，每個不超過 20 字，不要加 #。`,
    ].join('\n');
    return [
      { role: 'system', content: system },
      { role: 'user', content: `${title ? `目前標題：${title}\n\n` : ''}筆記內容：\n\n${text}` },
    ];
  }

  let task;
  if (action === 'translate') {
    const lang = String(input.language || '').trim() || '英文';
    task = `把下列內容翻譯成${lang}，保留 Markdown 結構與格式，程式碼與網址不要翻譯。`;
  } else if (action === 'custom') {
    if (!instruction) throw new Error('請輸入自訂指令');
    task = `依照這個指令處理下列內容：${instruction}`;
  } else {
    task = ACTION_PROMPTS[action];
    if (instruction) task += `\n額外要求：${instruction}`;
  }

  return [
    { role: 'system', content: BASE_RULES },
    {
      role: 'user',
      content: `${task}\n\n${title ? `（筆記標題：${title}）\n\n` : ''}<<<內容開始>>>\n${text}\n<<<內容結束>>>`,
    },
  ];
}

/** 把使用者填的 base URL 轉成 chat/completions 端點 */
export function chatCompletionsUrl(baseUrl) {
  const clean = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!clean) throw new Error('尚未設定 AI_BASE_URL');
  if (/\/chat\/completions$/i.test(clean)) return clean;
  return `${clean}/chat/completions`;
}

/**
 * 呼叫 Chat Completions。
 * stream=true 回傳上游 Response（body 為 SSE），否則回傳完整文字。
 */
export async function chatCompletion({ config, messages, stream = false, signal, fetchImpl = fetch, responseFormat }) {
  const headers = { 'content-type': 'application/json', accept: stream ? 'text/event-stream' : 'application/json' };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
  const body = {
    model: config.model,
    messages,
    stream,
    temperature: config.temperature,
  };
  if (config.maxTokens) body.max_tokens = config.maxTokens;
  if (responseFormat) body.response_format = responseFormat;

  const res = await fetchImpl(chatCompletionsUrl(config.baseUrl), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const detail = await safeText(res);
    const err = new Error(`AI 服務回應錯誤（HTTP ${res.status}）${detail ? `：${detail}` : ''}`);
    err.status = res.status;
    throw err;
  }
  if (stream) return res;
  const data = await res.json();
  return stripThinking(data?.choices?.[0]?.message?.content ?? '');
}

async function safeText(res) {
  try {
    const text = await res.text();
    try {
      const parsed = JSON.parse(text);
      return String(parsed?.error?.message || parsed?.error || parsed?.message || text).slice(0, 300);
    } catch {
      return text.slice(0, 300);
    }
  } catch {
    return '';
  }
}

/**
 * 把 OpenAI SSE 串流轉成「純文字增量」串流（UTF-8）。
 * 略過 reasoning／思考內容，只輸出 delta.content。
 */
export function sseToTextStream(body) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  const reader = body.getReader();

  const parseEvents = (controller, flush = false) => {
    let count = 0;
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = flush ? '' : parts.pop();
    for (const part of parts) {
      for (const line of part.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          if (json?.error) {
            controller.enqueue(encoder.encode(`\n\n[AI 錯誤] ${json.error.message || json.error}`));
            count += 1;
            continue;
          }
          const delta = json?.choices?.[0]?.delta?.content ?? json?.choices?.[0]?.text ?? '';
          if (delta) {
            controller.enqueue(encoder.encode(delta));
            count += 1;
          }
        } catch {
          // 非 JSON 的 keep-alive 或註解行，略過
        }
      }
    }
    return count;
  };

  return new ReadableStream({
    async pull(controller) {
      // 一次 pull 至少要輸出一段或結束串流，否則 ReadableStream 不會再呼叫 pull
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          if (buffer.trim()) {
            buffer += '\n\n';
            parseEvents(controller, true);
          }
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        if (parseEvents(controller) > 0) return;
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/** 去掉推理模型（DeepSeek-R1、QwQ…）輸出的 <think>…</think> 區塊，以及包住整份結果的 ``` */
export function stripThinking(text) {
  let out = String(text ?? '');
  out = out.replace(/^\s*<think>[\s\S]*?(<\/think>|$)\s*/i, '');
  const fenced = out.match(/^\s*```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i);
  if (fenced) out = fenced[1];
  return out;
}

/** 從模型輸出中取出第一個 JSON 物件（容忍前後雜訊與 ```json 包裝） */
export function extractJson(text) {
  const clean = stripThinking(text);
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(clean.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** 把建議結果正規化，分類只接受現有名稱 */
export function normalizeSuggestion(raw, { categories = [] } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const title = String(raw.title ?? '').trim().slice(0, 120);
  const wanted = String(raw.category ?? '').trim().toLowerCase();
  const category = categories.find((c) => String(c).toLowerCase() === wanted) || '';
  const tags = [];
  const seen = new Set();
  for (const t of Array.isArray(raw.tags) ? raw.tags : []) {
    const name = String(t ?? '').trim().replace(/^#/, '').slice(0, 40);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    tags.push(name);
    if (tags.length >= 8) break;
  }
  const summary = String(raw.summary ?? '').trim().slice(0, 500);
  return { title, category, tags, summary };
}
