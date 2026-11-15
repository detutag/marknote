/**
 * 自動維護 bucket CORS 的純函式（不碰網路，方便單元測試）。
 *
 * 瀏覽器用 presigned PUT 直接上傳到 bucket，bucket 必須允許網站來源。
 * 為了不必每換一次網域就手動跑 `npm run storage:init`，
 * 取得上傳網址時會把「目前網站的來源」自動加進 CORS（見 lib/storage.js）。
 */

export const MAX_CORS_ORIGINS = 50;

export const CORS_RULE_DEFAULTS = {
  AllowedMethods: ['GET', 'PUT', 'HEAD'],
  AllowedHeaders: ['*'],
  ExposeHeaders: ['ETag', 'Content-Length', 'Content-Range'],
  MaxAgeSeconds: 3600,
};

/** 是否啟用自動 CORS（STORAGE_AUTO_CORS=0／false／off 可關閉） */
export function isAutoCorsEnabled(env = process.env) {
  const v = String(env.STORAGE_AUTO_CORS ?? '').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(v);
}

/** 正規化成 scheme://host[:port]；不合法回空字串 */
export function normalizeOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const u = new URL(value.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    return u.origin;
  } catch {
    return '';
  }
}

/**
 * 從請求取出「本站」來源：只有當 Origin 的主機等於請求本身的主機時才採用，
 * 避免任何人藉由偽造 Origin 把別的網域塞進 CORS。
 * @param {Headers} headers
 */
export function requestSiteOrigin(headers) {
  const origin = normalizeOrigin(headers.get('origin') || '');
  if (!origin) return '';
  const host = (headers.get('x-forwarded-host') || headers.get('host') || '').split(',')[0].trim().toLowerCase();
  if (!host) return '';
  return new URL(origin).host.toLowerCase() === host ? origin : '';
}

/** 規則裡是否已允許該來源（含 "*"） */
export function corsAllows(rules, origin) {
  return (rules || []).some((r) =>
    (r.AllowedOrigins || []).some((o) => o === '*' || o === origin) &&
    (r.AllowedMethods || []).includes('PUT'),
  );
}

/**
 * 把來源加進既有規則，回傳新的規則陣列；已允許則回 null（不需更新）。
 * 其他規則原樣保留；超過上限時丟掉最舊的自動來源。
 */
export function mergeCorsOrigin(rules, origin, max = MAX_CORS_ORIGINS) {
  const list = Array.isArray(rules) ? rules.map((r) => ({ ...r })) : [];
  if (corsAllows(list, origin)) return null;
  const idx = list.findIndex((r) => (r.AllowedMethods || []).includes('PUT'));
  if (idx === -1) {
    list.push({ ...CORS_RULE_DEFAULTS, AllowedOrigins: [origin] });
    return list;
  }
  const origins = [...(list[idx].AllowedOrigins || []), origin];
  list[idx] = { ...list[idx], AllowedOrigins: origins.slice(-max) };
  return list;
}
