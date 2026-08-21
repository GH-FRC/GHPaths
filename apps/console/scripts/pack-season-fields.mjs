/**
 * pack-season-fields —— 赛季场地打包（ADR-0008 §8.8：随版本内置,运行期离线）。
 *
 * 源资产在 scripts/season-fields-src/（已提交,离线可复现）：
 *   - WPILib 官方 AprilTagFieldLayout JSON（allwpilib v2026.2.2,2026-rebuilt 两变体）
 *   - 官方 fieldImages 配置（像素角点标定,foot 单位）+ 场地 PNG
 * 转换产出（生成物,同样提交——构建不依赖网络）：
 *   - public/fields/*.png —— 底图（Vite 原样托管,URL 引用而非 data URL,不占 localStorage）
 *   - src/fields/builtin-fields.ts —— 内置 FieldMap 清单（FieldMapDialog 消费）
 *
 * 尺寸口径：场地尺寸取 AprilTag 布局的 field.length/width（米）——标签坐标系为准;
 *          底图角点标定映射到同一矩形（官方 fieldImages 尺寸与布局差 ~2cm,渲染不可见）。
 *
 * 换赛季：把新资产按同名规则放进 season-fields-src/（--fetch 可自动拉取当前配置的
 * tag 下同名文件）,跑 npm run fields:pack 重新生成。
 * 运行：npm run fields:pack（esbuild bundle 后 node——与 scripts/ 各检查脚本同套路）
 */
import { parseAprilTagLayout } from '@ghpaths/field-model';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'season-fields-src');
const CONSOLE = dirname(HERE);
const PUB = join(CONSOLE, 'public', 'fields');
const OUT_TS = join(CONSOLE, 'src', 'fields', 'builtin-fields.ts');

/** 打包条目：赛季内置场地（布局变体共享同一底图与标定） */
const ENTRIES = [
  {
    season: '2026',
    variant: 'andymark',
    layout: '2026-rebuilt-andymark.json',
    label: 'FRC 2026 Rebuilt（Andymark 场）',
  },
  {
    season: '2026',
    variant: 'welded',
    layout: '2026-rebuilt-welded.json',
    label: 'FRC 2026 Rebuilt（Welded 场）',
  },
];

const IMAGE_PNG = '2026-field.png';
const IMAGE_CFG = '2026-rebuilt.json';

/** 官方 fieldImages 配置（像素角点 + foot 尺寸）——本脚本只取角点像素,尺寸用布局口径 */
function readImageConfig() {
  const cfg = JSON.parse(readFileSync(join(SRC, IMAGE_CFG), 'utf8'));
  return { corners: { tl: cfg['field-corners']['top-left'], br: cfg['field-corners']['bottom-right'] }, png: cfg['field-image'] };
}

/** PNG 像素尺寸（IHDR 前八字节,无需图像库） */
function pngSize(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const imgCfg = readImageConfig();
const pngBuf = readFileSync(join(SRC, imgCfg.png));
const { w: widthPx, h: heightPx } = pngSize(pngBuf);

mkdirSync(PUB, { recursive: true });
mkdirSync(dirname(OUT_TS), { recursive: true });
cpSync(join(SRC, imgCfg.png), join(PUB, imgCfg.png));

const maps = ENTRIES.map((e) => {
  const layoutJson = readFileSync(join(SRC, e.layout), 'utf8');
  const { sizeM, tags } = parseAprilTagLayout(layoutJson);
  const { widthM: L, depthM: W } = sizeM;
  const map = {
    id: `builtin-${e.season}-${e.variant}`,
    name: e.label,
    sizeM,
    // 底图走打包 URL（/fields/*.png）;满铺标定 = 官方角点像素 ↔ ±size/2 世界角
    image: {
      url: `/fields/${imgCfg.png}`,
      widthPx,
      heightPx,
      calibration: [
        { px: imgCfg.corners.tl[0], py: imgCfg.corners.tl[1], xM: -L / 2, yM: W / 2 },
        { px: imgCfg.corners.br[0], py: imgCfg.corners.br[1], xM: L / 2, yM: -W / 2 },
      ],
    },
    tags,
  };
  return map;
});

const ts = `/* eslint-disable */
/**
 * builtin-fields —— 赛季内置场地清单（由 scripts/pack-season-fields.mjs 生成,勿手改）。
 * 来源：WPILib allwpilib v2026.2.2 官方资产（BSD-3;AprilTagFieldLayout + fieldImages）。
 * 重新生成：npm run fields:pack。自用无版权障碍;公开发布前复查当赛季素材条款（ADR-0008）。
 */
import type { FieldMap } from '@ghpaths/field-model';

export interface BuiltinField {
  /** 展示分组（赛季） */
  season: string;
  map: FieldMap;
}

export const BUILTIN_FIELDS: BuiltinField[] = [
${maps.map((m) => `  { season: '${m.id.replace(/^builtin-(\d+)-.*$/, '$1')}', map: ${JSON.stringify(m, null, 2).replace(/\n/g, '\n  ')} },`).join('\n')}
];
`;

writeFileSync(OUT_TS, ts);
console.log(`生成 ${maps.length} 个内置场地 → src/fields/builtin-fields.ts`);
for (const m of maps) {
  console.log(`  - ${m.name}: ${m.sizeM.widthM}×${m.sizeM.depthM}m, ${m.tags.length} 标签, 底图 ${widthPx}×${heightPx}px`);
}
console.log(`底图 → public/fields/${imgCfg.png}`);
