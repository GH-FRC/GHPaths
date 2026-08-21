/**
 * 导出↔回放 往返 GUI 验证（playwright-core + 系统 Chrome）——清偿 IAB 环境受限项。
 * 真实手势链：开演（自动录制）→ 结束 → 导出 JSONL/WPILOG（捕获真实下载事件）→
 *            回放日志（真实文件上传,fire change 事件）→ 播放/拖动 → 退出回放。
 * 运行前置：dev(5173) + npm run sim + npm run ds 均已启动。
 * 运行：node scripts/export-replay-roundtrip.mjs
 */
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, statSync } from 'node:fs';

const BASE = 'http://localhost:5173/';
const OUT = '/tmp/ghpaths-export-test';
mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ acceptDownloads: true });
// 界面固定中文（顺带验证 zh-CN 持久化生效于流程文案）
await ctx.addInitScript(() => localStorage.setItem('ghpaths.lang', 'zh-CN'));
const page = await ctx.newPage();
await page.goto(BASE);
await page.locator('h1').waitFor();

// ---- 1. 在线就绪（NT 连接建立需数秒——轮询等待而非立即读取） ----
let onlineBadge = '';
for (let i = 0; i < 30; i++) {
  onlineBadge = (await page.locator('header .badge').first().textContent()) ?? '';
  if (/6\/6/.test(onlineBadge)) break;
  await page.waitForTimeout(500);
}
ok('机器人在线（6/6）', /6\/6/.test(onlineBadge), `badge="${onlineBadge}"`);
await page.locator('text=multi-DS 已连').waitFor({ timeout: 5000 });
ok('multi-DS 已连', true);

// ---- 2. 开演 → 自动录制 ----
await page.getByRole('button', { name: '启动演出' }).click();
await page.locator('.badge.rec').waitFor({ timeout: 3000 });
ok('开演后录制徽章出现', true);
const rec1 = Number((await page.locator('.badge.rec').textContent())?.replace(/\D/g, '') ?? 0);
await page.waitForTimeout(5000);
const rec2 = Number((await page.locator('.badge.rec').textContent())?.replace(/\D/g, '') ?? 0);
ok(`录制行数增长（${rec1} → ${rec2}）`, rec2 > rec1 && rec2 > 50, `rec=${rec2}`);

// ---- 3. 结束演出 → 导出按钮出现 ----
await page.getByRole('button', { name: '结束演出' }).click();
await page.getByRole('button', { name: '导出日志' }).waitFor({ timeout: 3000 });
ok('结束后出现导出按钮', true);

// ---- 4. 导出 JSONL（真实下载事件） ----
const dl1 = page.waitForEvent('download', { timeout: 5000 });
await page.getByRole('button', { name: '导出日志' }).click();
const jsonlDl = await dl1;
const jsonlPath = OUT + '/showlog-test.jsonl';
await jsonlDl.saveAs(jsonlPath);
const jsonlBytes = statSync(jsonlPath).size;
const jsonlText = readFileSync(jsonlPath, 'utf8');
const jsonlLines = jsonlText.trim().split('\n').length;
ok(`导出 JSONL（${(jsonlBytes / 1024).toFixed(0)}KB, ${jsonlLines} 行）`, jsonlBytes > 1000 && jsonlLines > 50);
ok('JSONL 首行可解析为 JSON', (() => { try { JSON.parse(jsonlText.split('\n')[0]); return true; } catch { return false; } })());

// ---- 5. 导出 WPILOG（真实下载事件 + 魔数校验） ----
const dl2 = page.waitForEvent('download', { timeout: 5000 });
await page.getByRole('button', { name: '导出 WPILOG' }).click();
const wpiDl = await dl2;
const wpiPath = OUT + '/showlog-test.wpilog';
await wpiDl.saveAs(wpiPath);
const wpiHead = readFileSync(wpiPath).subarray(0, 6).toString('latin1');
ok(`导出 WPILOG（${(statSync(wpiPath).size / 1024).toFixed(0)}KB）`, statSync(wpiPath).size > 1000);
ok('WPILOG 魔数 = "WPILOG"', wpiHead === 'WPILOG', `head="${wpiHead}"`);

// ---- 6. 回放：真实文件上传（setInputFiles 触发 change,等价手选文件） ----
await page.getByRole('button', { name: '回放日志' }).waitFor({ timeout: 3000 });
const fileInput = page.locator('input[type="file"][accept*="jsonl"]');
ok('回放文件输入存在', await fileInput.count() === 1);
await fileInput.setInputFiles(jsonlPath);
await page.locator('.replay-bar').waitFor({ timeout: 5000 });
ok('上传后进入回放模式（回放条出现）', true);
await page.locator('header .badge:has-text("回放中")').waitFor({ timeout: 3000 });
ok('头部"回放中"徽章', true);
const statsText = await page.locator('.replay-stats').textContent();
ok(`回放统计含最窄间距（${statsText?.trim().slice(0, 40)}）`, /最窄间距/.test(statsText ?? ''));

// ---- 7. 回放播放与进度 ----
await page.getByRole('button', { name: '暂停回放' }).waitFor({ timeout: 3000 }).catch(() => {});
const t1 = await page.locator('.replay-time').textContent();
await page.getByRole('button', { name: /播放回放|继续/ }).click().catch(() => {});
await page.waitForTimeout(2000);
const t2 = await page.locator('.replay-time').textContent();
ok(`播放中时间推进（${t1?.slice(0, 8)} → ${t2?.slice(0, 8)}）`, t1 !== t2, `t1=${t1} t2=${t2}`);

// ---- 8. 退出回放 → 回到就绪态 ----
await page.getByRole('button', { name: '退出回放' }).click();
await page.locator('.replay-bar').waitFor({ state: 'hidden', timeout: 3000 });
await page.locator('text=就绪').waitFor({ timeout: 3000 }).catch(() => {});
ok('退出回放回到就绪态', !(await page.locator('.replay-bar').isVisible().catch(() => false)));

await browser.close();
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
console.log(`产物: ${jsonlPath} (${jsonlLines} 行) | ${wpiPath}`);
process.exit(fail > 0 ? 1 : 0);
