/**
 * Preferences —— 偏好设置窗口（ADR-0008 §8.7 骨架）。
 * 自包含：头部 ⚙ 按钮 + ⌘,（macOS 惯例）打开;Esc/遮罩点击关闭。
 * 首选项：语言（跟随系统 / 简体中文 / 繁體中文 / English,立即生效并持久化）。
 * Phase 3 扩展位：team 号、默认场地、演出参数等——都挂到本窗口。
 */
import { useEffect, useState } from 'react';
import { useI18n, type LangPref } from './i18n';

interface LangOption {
  value: LangPref;
  /** 选项文案;具体语言用各自原生名（业界惯例,不随当前语言翻译） */
  label: string | null; // null → 取 S.prefLangAuto
}

const OPTIONS: LangOption[] = [
  { value: 'auto', label: null },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en-US', label: 'English' },
];

export function Preferences(): JSX.Element {
  const { pref, setPref, S } = useI18n();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === ',' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        className="prefs-btn"
        title={`${S.prefs} (⌘,)`}
        aria-label={S.prefs}
        onClick={() => setOpen(true)}
      >
        ⚙
      </button>
      {open && (
        <div className="prefs-overlay" onClick={() => setOpen(false)}>
          <div
            className="prefs-card"
            role="dialog"
            aria-modal="true"
            aria-label={S.prefTitle}
            onClick={(e) => e.stopPropagation()}
          >
            <h2>{S.prefTitle}</h2>
            <p className="prefs-section">{S.prefLanguage}</p>
            <div className="prefs-options" role="radiogroup" aria-label={S.prefLanguage}>
              {OPTIONS.map((o) => (
                <button
                  key={o.value}
                  role="radio"
                  aria-checked={pref === o.value}
                  className={pref === o.value ? 'active' : ''}
                  onClick={() => setPref(o.value)}
                >
                  {o.label ?? S.prefLangAuto}
                </button>
              ))}
            </div>
            <p className="prefs-hint">{S.prefLangHint}</p>
            <p className="prefs-hint dim">{S.prefCloseHint}</p>
          </div>
        </div>
      )}
    </>
  );
}
