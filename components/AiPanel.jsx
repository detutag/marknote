'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icons';
import { Modal } from './Modal';
import { aiStream, api } from '@/lib/client';
import { stripThinking } from '@/lib/ai';
import { collapseSame, diffLines, diffStats } from '@/lib/diff';

/**
 * AI 整理／編輯面板。
 * 結果先在面板中預覽（可切換差異檢視、可手動修改），按「套用」才寫回筆記。
 */

const TEXT_ACTIONS = [
  { key: 'polish', label: '潤飾', icon: 'sparkle' },
  { key: 'fix', label: '修正錯字', icon: 'check' },
  { key: 'shorten', label: '精簡', icon: 'sort' },
  { key: 'expand', label: '擴寫', icon: 'plus' },
  { key: 'organize', label: '整理結構', icon: 'list' },
  { key: 'summarize', label: '摘要', icon: 'quote' },
  { key: 'translate', label: '翻譯', icon: 'external' },
  { key: 'custom', label: '自訂指令', icon: 'edit' },
];

const LANGUAGES = ['英文', '繁體中文', '簡體中文', '日文', '韓文', '法文', '德文', '西班牙文'];

/** 這些動作的結果通常是「新增」而不是取代原文 */
const INSERT_FIRST = new Set(['summarize']);

export default function AiPanel({ open, onClose, source, model, categories = [], noteTags = [], initialAction, onApply, onApplySuggestion, notify }) {
  const [action, setAction] = useState(initialAction || 'polish');
  const [instruction, setInstruction] = useState('');
  const [language, setLanguage] = useState('英文');
  const [status, setStatus] = useState('idle'); // idle | running | done | error
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [view, setView] = useState('result');
  const [suggestion, setSuggestion] = useState(null);
  const [picks, setPicks] = useState({ title: true, category: true, tags: true });
  const abortRef = useRef(null);
  const resultRef = useRef(null);

  const isSuggest = action === 'suggest';
  const scopeLabel = source?.scope === 'selection' ? '選取的文字' : '整篇筆記';
  const charCount = source?.text?.length || 0;

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  // 關閉時中止進行中的請求
  useEffect(() => {
    if (!open) stop();
    return stop;
  }, [open, stop]);

  const run = useCallback(
    async (nextAction = action) => {
      if (!source?.text?.trim()) {
        setError('沒有可處理的內容');
        setStatus('error');
        return;
      }
      if (nextAction === 'custom' && !instruction.trim()) {
        setError('請先輸入自訂指令');
        setStatus('error');
        return;
      }
      stop();
      const controller = new AbortController();
      abortRef.current = controller;
      setAction(nextAction);
      setError('');
      setResult('');
      setSuggestion(null);
      setView('result');
      setStatus('running');

      try {
        if (nextAction === 'suggest') {
          const res = await api.aiSuggest({ text: source.text, title: source.title }, controller.signal);
          setSuggestion(res.suggestion);
          setPicks({
            title: Boolean(res.suggestion?.title),
            category: Boolean(res.suggestion?.category),
            tags: Boolean(res.suggestion?.tags?.length),
          });
        } else {
          const full = await aiStream(
            { action: nextAction, text: source.text, title: source.title, instruction, language },
            {
              signal: controller.signal,
              onDelta: (_chunk, all) => {
                setResult(stripThinking(all));
                const el = resultRef.current;
                if (el) el.scrollTop = el.scrollHeight;
              },
            },
          );
          const clean = stripThinking(full).replace(/^\n+/, '');
          if (!clean.trim()) throw new Error('AI 沒有回傳任何內容');
          setResult(clean);
        }
        setStatus('done');
      } catch (err) {
        if (err?.name === 'AbortError') {
          setStatus((s) => (s === 'running' ? 'done' : s));
          setResult((r) => stripThinking(r));
          return;
        }
        setError(err?.message || 'AI 處理失敗');
        setStatus('error');
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [action, instruction, language, source, stop],
  );

  // 從選單直接開「建議」時自動開始分析
  const autoRan = useRef(false);
  useEffect(() => {
    if (open && !autoRan.current && initialAction === 'suggest') {
      autoRan.current = true;
      run('suggest');
    }
    return () => {
      // StrictMode 開發模式會先卸載再掛載一次，讓第二次掛載能重新觸發
      autoRan.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialAction]);

  const parts = useMemo(() => {
    if (view !== 'diff' || status !== 'done' || isSuggest) return [];
    return collapseSame(diffLines(source?.text || '', result));
  }, [view, status, isSuggest, source, result]);

  const stats = useMemo(
    () => (status === 'done' && !isSuggest ? diffStats(diffLines(source?.text || '', result)) : null),
    [status, isSuggest, source, result],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result);
      notify?.('已複製 AI 結果', 'success');
    } catch {
      notify?.('瀏覽器不允許複製', 'error');
    }
  };

  const chooseAction = (key) => {
    setAction(key);
    setError('');
    if (status === 'error') setStatus('idle');
    // 需要額外輸入的動作，等使用者按「產生」
    if (key !== 'custom' && key !== 'translate') run(key);
  };

  const applySuggestion = () => {
    if (!suggestion) return;
    const out = {};
    if (picks.title && suggestion.title) out.title = suggestion.title;
    if (picks.category && suggestion.category) out.category = suggestion.category;
    if (picks.tags && suggestion.tags?.length) out.tags = suggestion.tags;
    onApplySuggestion?.(out);
  };

  const running = status === 'running';
  const canApply = status === 'done' && !isSuggest && result.trim();
  const replaceLabel = source?.scope === 'selection' ? '取代選取' : '取代全文';
  const primaryInsert = INSERT_FIRST.has(action);

  const footer = (
    <div className="ai-foot">
      <span className="ai-foot-info">
        {running ? (
          <>
            <span className="spinner" /> 產生中…
          </>
        ) : stats ? (
          <>
            <span className="ai-stat-add">+{stats.added}</span> <span className="ai-stat-del">−{stats.removed}</span> 行
          </>
        ) : null}
      </span>
      <div className="ai-foot-actions">
        {running && (
          <button type="button" className="btn" onClick={stop}>
            停止
          </button>
        )}
        {!running && isSuggest && suggestion && (
          <button type="button" className="btn btn-primary" onClick={applySuggestion} disabled={!picks.title && !picks.category && !picks.tags}>
            套用勾選項目
          </button>
        )}
        {!running && canApply && (
          <>
            <button type="button" className="btn" onClick={copy}>
              <Icon name="copy" size={14} /> 複製
            </button>
            <button type="button" className={`btn ${primaryInsert ? 'btn-primary' : ''}`} onClick={() => onApply?.({ text: result, mode: 'insert' })}>
              插入於下方
            </button>
            <button type="button" className={`btn ${primaryInsert ? '' : 'btn-primary'}`} onClick={() => onApply?.({ text: result, mode: 'replace' })}>
              {replaceLabel}
            </button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={760}
      title={
        <span className="ai-title">
          <Icon name="sparkle" size={16} /> AI 整理
        </span>
      }
      subtitle={`處理範圍：${scopeLabel}（${charCount.toLocaleString()} 字元）${model ? `・模型：${model}` : ''}`}
      footer={footer}
    >
      <div className="ai-panel">
        <div className="ai-actions" role="group" aria-label="AI 動作">
          {TEXT_ACTIONS.map((a) => (
            <button
              key={a.key}
              type="button"
              className={`ai-chip ${action === a.key ? 'is-on' : ''}`}
              disabled={running}
              onClick={() => chooseAction(a.key)}
            >
              <Icon name={a.icon} size={13} />
              {a.label}
            </button>
          ))}
          {source?.scope !== 'selection' && (
            <button
              type="button"
              className={`ai-chip ${isSuggest ? 'is-on' : ''}`}
              disabled={running}
              onClick={() => chooseAction('suggest')}
            >
              <Icon name="tag" size={13} />
              標題／分類／標籤
            </button>
          )}
        </div>

        {!isSuggest && (
          <div className="ai-input-row">
            {action === 'translate' ? (
              <>
                <input
                  className="input"
                  list="ai-languages"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  placeholder="目標語言，例如：英文"
                  aria-label="目標語言"
                />
                <datalist id="ai-languages">
                  {LANGUAGES.map((l) => (
                    <option key={l} value={l} />
                  ))}
                </datalist>
              </>
            ) : (
              <input
                className="input"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    run();
                  }
                }}
                placeholder={action === 'custom' ? '輸入指令，例如：改成會議記錄格式，列出決議與待辦' : '額外要求（選填），例如：語氣正式一點'}
                aria-label="AI 指令"
              />
            )}
            <button type="button" className="btn btn-primary" onClick={() => run()} disabled={running}>
              {status === 'done' || status === 'error' ? '重新產生' : '產生'}
            </button>
          </div>
        )}

        {error && (
          <div className="ai-error" role="alert">
            <Icon name="warning" size={14} /> {error}
          </div>
        )}

        {isSuggest ? (
          <SuggestionView
            suggestion={suggestion}
            picks={picks}
            setPicks={setPicks}
            running={running}
            categories={categories}
            noteTags={noteTags}
          />
        ) : (
          <>
            {status === 'done' && (
              <div className="ai-view-switch" role="tablist">
                <button type="button" className={view === 'result' ? 'is-on' : ''} onClick={() => setView('result')}>
                  結果
                </button>
                <button type="button" className={view === 'diff' ? 'is-on' : ''} onClick={() => setView('diff')}>
                  差異
                </button>
              </div>
            )}
            {view === 'diff' && status === 'done' ? (
              <div className="ai-diff" aria-label="差異預覽">
                {parts.length === 0 || parts.every((p) => p.type === 'skip') ? (
                  <div className="ai-empty">內容沒有變更</div>
                ) : (
                  parts.map((p, i) =>
                    p.type === 'skip' ? (
                      <div key={i} className="ai-diff-skip">
                        ⋯ {p.count} 行未變更
                      </div>
                    ) : (
                      <div key={i} className={`ai-diff-line is-${p.type}`}>
                        <span className="ai-diff-sign">{p.type === 'add' ? '+' : p.type === 'del' ? '−' : ' '}</span>
                        <span>{p.text || ' '}</span>
                      </div>
                    ),
                  )
                )}
              </div>
            ) : (
              <textarea
                ref={resultRef}
                className="ai-result"
                value={result}
                readOnly={running}
                onChange={(e) => setResult(e.target.value)}
                placeholder={running ? '等待 AI 回應…' : '選擇上方的動作開始；結果會先顯示在這裡，確認後再套用到筆記。'}
                aria-label="AI 結果"
                spellCheck="false"
              />
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function SuggestionView({ suggestion, picks, setPicks, running, categories, noteTags }) {
  if (running) {
    return (
      <div className="ai-empty">
        <span className="spinner" /> 分析筆記中…
      </div>
    );
  }
  if (!suggestion) return <div className="ai-empty">AI 會從現有分類與標籤中挑選，並建議標題。</div>;
  const toggle = (key) => setPicks((p) => ({ ...p, [key]: !p[key] }));
  const known = new Set(noteTags.map((t) => t.toLowerCase()));
  const cat = categories.find((c) => c.name === suggestion.category);
  return (
    <div className="ai-suggest">
      <label className={`ai-suggest-row ${suggestion.title ? '' : 'is-empty'}`}>
        <input type="checkbox" checked={picks.title} disabled={!suggestion.title} onChange={() => toggle('title')} />
        <span className="ai-suggest-key">標題</span>
        <span className="ai-suggest-val">{suggestion.title || '（無建議）'}</span>
      </label>
      <label className={`ai-suggest-row ${suggestion.category ? '' : 'is-empty'}`}>
        <input type="checkbox" checked={picks.category} disabled={!suggestion.category} onChange={() => toggle('category')} />
        <span className="ai-suggest-key">分類</span>
        <span className="ai-suggest-val">
          {cat ? `${cat.emoji ? `${cat.emoji} ` : ''}${cat.name}` : '（沒有合適的現有分類）'}
        </span>
      </label>
      <label className={`ai-suggest-row ${suggestion.tags?.length ? '' : 'is-empty'}`}>
        <input type="checkbox" checked={picks.tags} disabled={!suggestion.tags?.length} onChange={() => toggle('tags')} />
        <span className="ai-suggest-key">標籤</span>
        <span className="ai-suggest-val ai-tags">
          {suggestion.tags?.length
            ? suggestion.tags.map((t) => (
                <span key={t} className={`ai-tag ${known.has(t.toLowerCase()) ? 'is-current' : ''}`}>
                  #{t}
                </span>
              ))
            : '（無建議）'}
        </span>
      </label>
      {suggestion.summary && <p className="ai-suggest-summary">{suggestion.summary}</p>}
      <p className="ai-suggest-hint">標籤會加到現有標籤上，不會移除原有標籤。</p>
    </div>
  );
}
