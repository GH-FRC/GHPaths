/**
 * FieldMapDialog —— 场地地图管理窗口（ADR-0008 §8.8）。
 * 自包含：头部「场地」按钮 + 模态（Esc/遮罩关闭）。
 *  - 导入 JSON：GHPaths 场地包（含底图）或 WPILib AprilTagFieldLayout（官方格式,按内容嗅探）
 *  - 导入 PNG：先读像素尺寸 → 表单收集场地米尺寸（满铺映射）→ 生成本地场地包
 *  - 导出 AprilTag 布局（WPILib 格式,给机器人侧 PhotonVision——单一事实来源）
 *  - 恢复默认舞台
 */
import { useEffect, useRef, useState } from 'react';
import { useI18n } from './i18n';
import type { FieldMapApi } from './useFieldMap';

function downloadText(text: string, name: string, mime: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function FieldMapDialog({ fieldMap }: { fieldMap: FieldMapApi }): JSX.Element {
  const { S } = useI18n();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pngDraft, setPngDraft] = useState<{ dataUrl: string; w: number; h: number } | null>(null);
  const [sizeW, setSizeW] = useState('12');
  const [sizeD, setSizeD] = useState('8');
  const jsonRef = useRef<HTMLInputElement | null>(null);
  const pngRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { setOpen(false); setPngDraft(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const doImportJson = async (text: string): Promise<void> => {
    const err = fieldMap.importJson(text);
    setMsg(err ? { ok: false, text: S.fmBadJson(err) } : { ok: true, text: S.fmImported(fieldMap.map.name) });
  };

  const onJsonFile = async (f: File): Promise<void> => {
    try {
      await doImportJson(await f.text());
    } catch (e) {
      setMsg({ ok: false, text: S.fmBadJson(String(e)) });
    }
  };

  const onPngFile = (f: File): void => {
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = (): void => {
      // data URL 化（持久化需要;object URL 刷新即失效）
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      setPngDraft({ dataUrl: canvas.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = (): void => {
      URL.revokeObjectURL(url);
      setMsg({ ok: false, text: S.fmBadJson('PNG') });
    };
    img.src = url;
  };

  const confirmPng = (): void => {
    if (!pngDraft) return;
    const err = fieldMap.importPng(pngDraft.dataUrl, pngDraft.w, pngDraft.h, Number(sizeW), Number(sizeD));
    if (err) {
      setMsg({ ok: false, text: S.fmBadJson(err) });
      return;
    }
    setMsg({ ok: true, text: S.fmImported(`PNG ${sizeW}×${sizeD}m`) });
    setPngDraft(null);
  };

  const doExportTags = (): void => {
    const json = fieldMap.exportTags();
    if (!json) {
      setMsg({ ok: false, text: S.fmNoTags });
      return;
    }
    downloadText(json, 'field-apriltags.json', 'application/json');
  };

  const map = fieldMap.map;

  return (
    <>
      <button className="field-btn" onClick={() => { setOpen(true); setMsg(null); }}>
        {S.fmButton}
      </button>
      {open && (
        <div className="prefs-overlay" onClick={() => { setOpen(false); setPngDraft(null); }}>
          <div
            className="prefs-card field-card"
            role="dialog"
            aria-modal="true"
            aria-label={S.fmTitle}
            onClick={(e) => e.stopPropagation()}
          >
            <h2>{S.fmTitle}</h2>
            <p className="prefs-section">{S.fmCurrent}</p>
            <p className="field-info">
              {map.name} · {S.fmSize(map.sizeM.widthM, map.sizeM.depthM)} · {S.fmTags(map.tags.length)} ·{' '}
              {map.image ? S.fmImageYes : S.fmImageNo}
            </p>
            <div className="prefs-options">
              <button onClick={() => jsonRef.current?.click()}>{S.fmImportJson}</button>
              <button onClick={() => pngRef.current?.click()}>{S.fmImportPng}</button>
              <button onClick={doExportTags}>{S.fmExportTags}</button>
              <button onClick={() => { fieldMap.reset(); setMsg(null); }}>{S.fmReset}</button>
            </div>
            <input
              ref={jsonRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) await onJsonFile(f);
                e.target.value = '';
              }}
            />
            <input
              ref={pngRef}
              type="file"
              accept=".png,image/png"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPngFile(f);
                e.target.value = '';
              }}
            />
            {pngDraft && (
              <div className="field-png-form">
                <p className="prefs-section">{S.fmPngTitle}</p>
                <p className="prefs-hint">{S.fmPngHint(pngDraft.w, pngDraft.h)}</p>
                <div className="field-size-inputs">
                  <label>
                    {S.fmWidthM}
                    <input type="number" min="0.5" max="100" step="0.1" value={sizeW}
                      onChange={(e) => setSizeW(e.target.value)} />
                  </label>
                  <label>
                    {S.fmDepthM}
                    <input type="number" min="0.5" max="100" step="0.1" value={sizeD}
                      onChange={(e) => setSizeD(e.target.value)} />
                  </label>
                </div>
                <div className="prefs-options">
                  <button onClick={confirmPng}>{S.fmOk}</button>
                  <button onClick={() => setPngDraft(null)}>{S.fmCancel}</button>
                </div>
              </div>
            )}
            {fieldMap.storeWarning && <p className="prefs-hint stat-bad">{fieldMap.storeWarning}</p>}
            {msg && <p className={`prefs-hint ${msg.ok ? 'stat-ok' : 'stat-bad'}`}>{msg.text}</p>}
            <p className="prefs-hint dim">{S.prefCloseHint}</p>
          </div>
        </div>
      )}
    </>
  );
}
