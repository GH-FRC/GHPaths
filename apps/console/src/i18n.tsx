/**
 * i18n —— 三语言机制骨架（ADR-0008 §8.7,Phase 2 收尾就位;全量覆盖等 Phase 3 文案冻结）。
 *
 *  - zh-CN：ui-strings.ts 的 S（单一来源）
 *  - en-US：strings-en.ts 的 EN（手写包）
 *  - zh-TW：OpenCC 从 zh-CN 运行时派生（s2twp 短语级转换）+ 机器人术语表人工校对
 *  - 默认跟随系统（zh-Hant→繁体,zh*→简体,其余→英文）;手动覆盖存 localStorage
 *    （打包后迁 Tauri store——ADR-0008）;数据与 topic/日志字段不翻译
 *
 * 不用 react-i18next：本应用文案是带类型的函数式目录（S 里的 (n)=>`...`）,
 * 自带 Provider/钩子即可保留全量类型检查,依赖更少（ADR 允许"或同级"方案）。
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import * as OpenCC from 'opencc-js';
import { S, type Strings } from './ui-strings';
import { EN } from './strings-en';

export type Lang = 'zh-CN' | 'zh-TW' | 'en-US';
/** 持久化的偏好;'auto' = 跟随系统（默认） */
export type LangPref = Lang | 'auto';

const STORAGE_KEY = 'ghpaths.lang';

/**
 * 机器人术语表（简体原文 → 繁体定稿）。OpenCC 词典对工程口语的取舍不一定合
 * 本项目语境,人工校对项写在这里;键匹配的是 zh-CN 原文（转换前替换）。
 */
const GLOSSARY_ZH_TW: Record<string, string> = {
  // 产品名保持字形稳定（臺/台 均为正体,取与简体同形）
  演控台: '演控台',
  // 「线上空处」的"线上"指路径线段上,非"online"——繁体改写避免歧义
  线上空处: '路徑上空白處',
};

const s2tw = OpenCC.Converter({ from: 'cn', to: 'twp' });

/** 术语表键先经 s2tw 转换,再在转换结果上替换——保证术语穿越转换保持定稿字形 */
const GLOSSARY_CONV: Array<[string, string]> = Object.entries(GLOSSARY_ZH_TW).map(
  ([k, v]) => [s2tw(k), v],
);

const convCache = new Map<string, string>();
function toTrad(text: string): string {
  let out = convCache.get(text);
  if (out === undefined) {
    out = s2tw(text);
    for (const [k, v] of GLOSSARY_CONV) {
      if (out.includes(k)) out = out.split(k).join(v);
    }
    convCache.set(text, out);
  }
  return out;
}

/** 目录级派生：字符串转译;函数包装为"调用后转译结果"（函数体里的简体模板一并转换） */
function deriveZhTW(pack: Strings): Strings {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(pack) as Array<keyof Strings>) {
    const v = pack[key] as unknown;
    if (typeof v === 'function') {
      out[key] = (...args: unknown[]) => toTrad((v as (...a: unknown[]) => string)(...args));
    } else {
      out[key] = toTrad(v as string);
    }
  }
  return out as Strings;
}

const PACKS: Record<Lang, Strings> = {
  'zh-CN': S,
  'zh-TW': deriveZhTW(S),
  'en-US': EN,
};

/** 跟随系统：zh-Hant/zh-TW/zh-HK→繁体;其余 zh*→简体;非中文→英文 */
function systemLang(): Lang {
  const prefs = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [];
  for (const l of prefs) {
    const ll = (l ?? '').toLowerCase();
    if (!ll) continue;
    if (!ll.startsWith('zh')) return 'en-US';
    if (ll.includes('tw') || ll.includes('hk') || ll.includes('mo') || ll.includes('hant')) return 'zh-TW';
    return 'zh-CN';
  }
  return 'zh-CN';
}

function readStoredPref(): LangPref {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'zh-CN' || v === 'zh-TW' || v === 'en-US' || v === 'auto' ? v : 'auto';
  } catch {
    return 'auto'; // localStorage 不可用（隐私模式等）——退跟随系统,不持久化
  }
}

/**
 * 类组件（ErrorBoundary）读取当前语言包的非响应式出口——
 * 语言切换时类组件不重渲（错误页属罕见路径,可接受;注释见 ADR-0008 骨架范围）。
 */
let liveStrings: Strings = PACKS['zh-CN'];
export function getCurrentStrings(): Strings {
  return liveStrings;
}

interface I18nCtx {
  lang: Lang;
  pref: LangPref;
  setPref: (p: LangPref) => void;
  S: Strings;
}

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }): JSX.Element {
  const [pref, setPrefState] = useState<LangPref>(readStoredPref);
  const lang: Lang = pref === 'auto' ? systemLang() : pref;
  const pack = PACKS[lang];

  const setPref = (p: LangPref): void => {
    setPrefState(p);
    try {
      localStorage.setItem(STORAGE_KEY, p);
    } catch {
      /* 持久化失败不阻断切换 */
    }
  };

  useEffect(() => {
    liveStrings = pack;
    document.documentElement.lang = lang;
  }, [pack, lang]);

  return <Ctx.Provider value={{ lang, pref, setPref, S: pack }}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useI18n 必须在 I18nProvider 内使用');
  return ctx;
}
