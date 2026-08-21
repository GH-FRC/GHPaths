/**
 * i18n GUI 冒烟（playwright-core + 系统 Chrome,headless）——ADR-0008 §8.7 骨架验证。
 * 覆盖：默认跟随系统（en-US 环境）→ ⌘, 开 Preferences → 三语言切换即时生效 →
 *       localStorage 持久化（reload 保持）→ 跟随系统恢复 → Esc 关闭。
 * 运行：node scripts/i18n-gui-smoke.mjs（需 dev server 在 5173）
 */
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:5173/';
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ locale: 'en-US' }); // 模拟英文系统 → 默认应 en-US
const page = await ctx.newPage();
await page.goto(BASE);
await page.waitForLoadState('domcontentloaded');

// ---- 1. 跟随系统：en-US 环境默认英文 ----
let h1 = await page.locator('h1').textContent();
ok('跟随系统:en-US 环境默认英文标题', h1 === 'GHPaths Show Console', `h1="${h1}"`);

// ---- 2. ⌘, 打开 Preferences ----
await page.keyboard.press('Meta+,');
const dialog = page.locator('.prefs-card');
await dialog.waitFor({ state: 'visible', timeout: 3000 });
ok('⌘, 打开 Preferences', await dialog.isVisible());
let prefTitle = await dialog.locator('h2').textContent();
ok('Preferences 标题随语言(英文)', prefTitle === 'Settings', `title="${prefTitle}"`);

// ---- 3. 切简体:立即生效 ----
await dialog.getByRole('radio', { name: '简体中文' }).click();
h1 = await page.locator('h1').textContent();
ok('切简体:标题即时切换', h1 === 'GHPaths 演控台', `h1="${h1}"`);
const startBtn = await page.locator('button.show-start').textContent().catch(() => null);
ok('切简体:按钮文案（无后端面板时启动演出按钮存在）', startBtn === '启动演出', `btn="${startBtn}"`);

// ---- 4. 切繁体（弹窗仍开着——⌘, 是切换语义,勿重复按） ----
await dialog.getByRole('radio', { name: '繁體中文' }).click();
h1 = await page.locator('h1').textContent();
const hint = await page.locator('.hint').first().textContent();
ok('切繁体:标题(术语表保台)', h1 === 'GHPaths 演控台', `h1="${h1}"`);
ok('切繁体:提示文案已转换', hint.includes('就緒') || hint.includes('未檢測'), `hint="${hint?.slice(0, 30)}"`);

// ---- 5. 持久化:reload 后保持繁体 ----
await page.reload();
await page.waitForLoadState('domcontentloaded');
h1 = await page.locator('h1').textContent();
const stored = await page.evaluate(() => localStorage.getItem('ghpaths.lang'));
ok('持久化:localStorage=zh-TW', stored === 'zh-TW', `stored="${stored}"`);
ok('持久化:reload 后仍繁体', h1 === 'GHPaths 演控台', `h1="${h1}"`);

// ---- 6. reload 后弹窗已重置:⌘, 重开 + 跟随系统恢复 + Esc 关闭 ----
// （reload 后界面仍是繁体——选项文案也是繁体,故按位置取第一项 = 跟随系统）
await page.keyboard.press('Meta+,');
await dialog.waitFor({ state: 'visible', timeout: 3000 });
await dialog.locator('.prefs-options button').first().click();
h1 = await page.locator('h1').textContent();
ok('恢复跟随系统:回到英文(en-US 环境)', h1 === 'GHPaths Show Console', `h1="${h1}"`);
await page.keyboard.press('Escape');
ok('Esc 关闭 Preferences', !(await dialog.isVisible().catch(() => false)));

// ---- 7. ⚙ 按钮打开 ----
await page.locator('button[title*="Settings"], button[aria-label="Settings"]').click();
ok('⚙ 按钮打开 Preferences', await dialog.isVisible());

await browser.close();
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
