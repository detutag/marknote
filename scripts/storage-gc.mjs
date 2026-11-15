/**
 * 清理 bucket 裡沒有登記在 files 資料表的孤兒物件
 * （例如上傳成功後網路中斷，POST /api/files 沒送到伺服器）。
 *
 *   npm run storage:gc              # 只列出，不刪除
 *   npm run storage:gc -- --delete  # 實際刪除
 *
 * 只處理超過 24 小時的物件，避免誤刪正在上傳、尚未登記的檔案。
 * 需要 DATABASE_URL 以及物件儲存的環境變數（同 storage:init）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon, neonConfig } from '@neondatabase/serverless';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv() {
  const file = path.join(root, '.env.local');
  const target = fs.existsSync(file) ? file : path.join(root, '.env');
  if (!fs.existsSync(target)) return;
  for (const line of fs.readFileSync(target, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
    if (!m) continue;
    const [, key, rawValue] = m;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, '');
  }
}
loadDotEnv();

const MIN_AGE_MS = 24 * 60 * 60 * 1000;
const doDelete = process.argv.includes('--delete');

const { getStorageConfig } = await import('../lib/config.js');
const { listObjects, deleteObjects } = await import('../lib/storage.js');

const dbUrl = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
if (!dbUrl) {
  console.error('✗ 尚未設定 DATABASE_URL');
  process.exit(1);
}
if (!getStorageConfig().configured) {
  console.error('✗ 尚未設定物件儲存（S3_ENDPOINT、S3_ACCESS_KEY_ID、S3_SECRET_ACCESS_KEY、S3_REGION、STORAGE_BUCKET）');
  process.exit(1);
}
if (process.env.NEON_FETCH_ENDPOINT) neonConfig.fetchEndpoint = process.env.NEON_FETCH_ENDPOINT;

try {
  const sql = neon(dbUrl);
  const rows = await sql.query('SELECT object_key FROM files');
  const registered = new Set(rows.map((r) => r.object_key));
  const now = Date.now();

  const objects = await listObjects('files/');
  const orphans = objects.filter(
    (o) => !registered.has(o.key) && o.lastModified && now - o.lastModified.getTime() > MIN_AGE_MS,
  );

  console.log(`bucket 物件 ${objects.length} 個，已登記 ${registered.size} 筆，超過 24 小時的孤兒 ${orphans.length} 個`);
  for (const o of orphans) console.log(`  ${o.key}  （${o.lastModified.toISOString()}）`);

  if (!orphans.length) process.exit(0);
  if (!doDelete) {
    console.log('只列出未刪除。確認無誤後執行：npm run storage:gc -- --delete');
    process.exit(0);
  }
  await deleteObjects(orphans.map((o) => o.key));
  console.log(`✓ 已刪除 ${orphans.length} 個孤兒物件`);
} catch (err) {
  console.error('✗ 清理失敗：', err?.message || err);
  process.exit(1);
}
