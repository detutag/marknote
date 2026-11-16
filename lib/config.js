/**
 * 集中管理環境變數與預設值。
 * 所有可調參數都在這裡，方便在 Netlify 環境變數中一次設定。
 */

/** 應用程式名稱（顯示於登入頁、側邊欄、PWA manifest） */
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME?.trim() || 'MarkNote';

/** Neon / PostgreSQL 連線字串 */
export function getDatabaseUrl() {
  const url = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || '';
  return url.trim();
}

/** 單一登入密碼（自用設計，無使用者註冊） */
export function getAppPassword() {
  return process.env.APP_PASSWORD || '';
}

/** session JWT 簽章金鑰 */
export function getAuthSecret() {
  return process.env.AUTH_SECRET || '';
}

/** session 有效秒數 */
export function getSessionMaxAge() {
  const days = Number.parseInt(process.env.SESSION_MAX_AGE_DAYS || '7', 10);
  const safe = Number.isFinite(days) && days > 0 ? days : 7;
  return Math.round(safe * 24 * 60 * 60);
}

/**
 * cookie 是否只走 HTTPS。
 * auto：production 視為 https（Netlify 一定 https），本機開發走 http。
 */
export function isSecureCookie() {
  const flag = (process.env.COOKIE_SECURE || 'auto').toLowerCase();
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

/** session cookie 名稱；HTTPS 環境使用 __Host- 前綴綁定來源 */
export function getSessionCookieName() {
  const base = process.env.SESSION_COOKIE_NAME?.trim() || 'mn_session';
  return isSecureCookie() ? `__Host-${base}` : base;
}

/** 閱讀模式允許内嵌 iframe 的網域白名單 */
export const DEFAULT_EMBED_HOSTS = [
  'www.youtube.com',
  'youtube.com',
  'www.youtube-nocookie.com',
  'youtube-nocookie.com',
  'player.vimeo.com',
  'vimeo.com',
  'player.bilibili.com',
];

export function getEmbedAllowlist() {
  const raw = process.env.EMBED_ALLOWLIST;
  if (raw === undefined) return DEFAULT_EMBED_HOSTS;
  return raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/** 環境變數體檢：回傳缺少的必要項目（用於登入頁／健康檢查） */
export function checkRequiredEnv() {
  const missing = [];
  if (!getDatabaseUrl()) missing.push('DATABASE_URL');
  if (!getAppPassword()) missing.push('APP_PASSWORD');
  if (!getAuthSecret()) missing.push('AUTH_SECRET');
  return missing;
}

/**
 * S3 相容物件儲存設定（Neon Object Storage、R2、B2、AWS S3…）。
 * 只讀 S3_* 變數，外加桶名 STORAGE_BUCKET；不使用 AWS_*，避免與
 * Netlify／Vercel 等平台執行環境自帶的 AWS_* 變數混淆。
 */
export function getStorageConfig() {
  const pick = (...keys) => {
    for (const k of keys) {
      const v = (process.env[k] || '').trim();
      if (v) return v;
    }
    return '';
  };
  const endpoint = pick('S3_ENDPOINT');
  const region = pick('S3_REGION') || 'us-east-1';
  const accessKeyId = pick('S3_ACCESS_KEY_ID');
  const secretAccessKey = pick('S3_SECRET_ACCESS_KEY');
  const bucket = (process.env.STORAGE_BUCKET || process.env.NEON_STORAGE_BUCKET || '').trim();
  const configured = Boolean(endpoint && accessKeyId && secretAccessKey && bucket);
  return { configured, endpoint, region, accessKeyId, secretAccessKey, bucket };
}

/** 檔案庫是否已設定（未設定時筆記功能仍可正常使用） */
export function isStorageConfigured() {
  return getStorageConfig().configured;
}

/** 單檔上傳上限（位元組），預設 200 MiB */
export function getMaxUploadBytes() {
  const mb = Number.parseInt(process.env.STORAGE_MAX_UPLOAD_MB || '200', 10);
  const safe = Number.isFinite(mb) && mb > 0 ? Math.min(mb, 5120) : 200;
  return safe * 1024 * 1024;
}

/** 允許匿名讀取的網域？目前一律走應用程式代理，不回傳公開網址 */
export function getStorageBucket() {
  return getStorageConfig().bucket;
}

// ── MCP（給外部 AI agent 使用的 Model Context Protocol 端點） ─────────────

/** MCP 存取權杖；未設定時 /api/mcp 整個停用 */
export function getMcpToken() {
  return (process.env.MCP_TOKEN || '').trim();
}

/** MCP 是否只開放讀取工具（MCP_READONLY=1） */
export function isMcpReadonly() {
  return /^(1|true|yes|on)$/i.test((process.env.MCP_READONLY || '').trim());
}

// ── AI（自訂 OpenAI 相容端點） ──────────────────────────────────────────

/**
 * AI 模型設定。任何實作 OpenAI Chat Completions 的服務都可使用：
 * OpenAI、DeepSeek、通義千問、OpenRouter、Groq、Ollama、LM Studio…
 * 金鑰只在伺服器端使用，不會傳到瀏覽器。
 */
export function getAiConfig() {
  const baseUrl = (process.env.AI_BASE_URL || '').trim();
  const apiKey = (process.env.AI_API_KEY || '').trim();
  const model = (process.env.AI_MODEL || '').trim();
  const num = (key, fallback, min, max) => {
    const v = Number.parseFloat(process.env[key] ?? '');
    return Number.isFinite(v) ? Math.min(Math.max(v, min), max) : fallback;
  };
  return {
    configured: Boolean(baseUrl && model),
    baseUrl,
    apiKey,
    model,
    temperature: num('AI_TEMPERATURE', 0.3, 0, 2),
    maxTokens: Math.round(num('AI_MAX_TOKENS', 0, 0, 200000)) || undefined,
    maxInputChars: Math.round(num('AI_MAX_INPUT_CHARS', 60000, 1000, 1000000)),
    timeoutMs: Math.round(num('AI_TIMEOUT_MS', 120000, 5000, 900000)),
  };
}

/** AI 功能是否已設定 */
export function isAiConfigured() {
  return getAiConfig().configured;
}
