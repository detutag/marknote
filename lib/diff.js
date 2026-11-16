/**
 * 行為單位的差異比對（LCS），給 AI 結果的「差異預覽」使用。
 * 純函式，前後端與測試共用。
 */

/**
 * @param {string} before
 * @param {string} after
 * @param {{maxCells?: number}} [opts] 超過 maxCells（行數乘積）時退化為整段刪除＋新增，避免卡住畫面
 * @returns {{type: 'same'|'add'|'del', text: string}[]}
 */
export function diffLines(before, after, { maxCells = 4_000_000 } = {}) {
  const a = String(before ?? '').split('\n');
  const b = String(after ?? '').split('\n');

  // 先剝掉頭尾相同的行，縮小矩陣
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  const head = a.slice(0, start).map((text) => ({ type: 'same', text }));
  const tail = a.slice(endA).map((text) => ({ type: 'same', text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  if (midA.length * midB.length > maxCells) {
    return [
      ...head,
      ...midA.map((text) => ({ type: 'del', text })),
      ...midB.map((text) => ({ type: 'add', text })),
      ...tail,
    ];
  }

  const n = midA.length;
  const m = midB.length;
  // dp[i][j] = midA[i..] 與 midB[j..] 的 LCS 長度（一維滾動不易回溯，這裡用 Uint32Array 平面陣列）
  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i * width + j] =
        midA[i] === midB[j] ? dp[(i + 1) * width + j + 1] + 1 : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }

  const middle = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      middle.push({ type: 'same', text: midA[i] });
      i += 1;
      j += 1;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      middle.push({ type: 'del', text: midA[i] });
      i += 1;
    } else {
      middle.push({ type: 'add', text: midB[j] });
      j += 1;
    }
  }
  while (i < n) middle.push({ type: 'del', text: midA[i++] });
  while (j < m) middle.push({ type: 'add', text: midB[j++] });

  return [...head, ...middle, ...tail];
}

/** 統計新增／刪除行數 */
export function diffStats(parts) {
  let added = 0;
  let removed = 0;
  for (const p of parts) {
    if (p.type === 'add') added += 1;
    else if (p.type === 'del') removed += 1;
  }
  return { added, removed };
}

/** 把長段的相同行折疊，只保留變更前後 context 行 */
export function collapseSame(parts, context = 2) {
  const out = [];
  let run = [];
  const flush = (isEnd, isStart) => {
    if (!run.length) return;
    const keepHead = isStart ? 0 : context;
    const keepTail = isEnd ? 0 : context;
    if (run.length <= keepHead + keepTail + 1) {
      out.push(...run);
    } else {
      out.push(...run.slice(0, keepHead));
      out.push({ type: 'skip', text: '', count: run.length - keepHead - keepTail });
      if (keepTail) out.push(...run.slice(-keepTail));
    }
    run = [];
  };
  let seenChange = false;
  for (const p of parts) {
    if (p.type === 'same') {
      run.push(p);
    } else {
      flush(false, !seenChange);
      seenChange = true;
      out.push(p);
    }
  }
  flush(true, !seenChange);
  return out;
}
