/**
 * 登入後要回到的站內路徑。只接受以單一 "/" 開頭的相對路徑，
 * 擋掉 //evil.com、/\evil.com、https://… 等開放重新導向，以及登入頁本身。
 * @param {string|null|undefined} raw
 * @returns {string} 安全的路徑；不合格時回傳 "/"
 */
export function safeNextPath(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  if (/[\u0000-\u001f]/.test(value)) return '/';
  try {
    const url = new URL(value, 'http://local.invalid');
    if (url.origin !== 'http://local.invalid') return '/';
    if (url.pathname === '/login' || url.pathname.startsWith('/login/')) return '/';
    if (url.pathname.startsWith('/api/')) return '/';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/';
  }
}
