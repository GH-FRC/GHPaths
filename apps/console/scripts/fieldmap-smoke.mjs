/**
 * FieldMap GUI 冒烟（playwright-core + 系统 Chrome）——ADR-0008 §8.8。
 * 链路：导入 WPILib AprilTag 布局（真实上传）→ 标签渲染 → 导出布局（真实下载）往返 →
 *      导入 PNG 底图（真实上传）→ 尺寸表单 → 底图渲染 → reload 持久化 → 恢复默认。
 * 前置：dev(5173) 已起（sim/ds 非必需——场地功能不依赖机器人在线）。
 */
import { chromium } from 'playwright-core';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BASE = 'http://localhost:5173/';
const OUT = '/tmp/ghpaths-fieldmap-test';
mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

/* ---- 手工编码一张真 PNG（400×240 RGB,棋盘格——浏览器 <img> 可解码） ---- */
function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function makePng(w, h) {
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    raw[row] = 0; // filter none
    for (let x = 0; x < w; x++) {
      const o = row + 1 + x * 3;
      const ck = ((x >> 5) + (y >> 5)) % 2;
      raw[o] = ck ? 200 : 40; raw[o + 1] = ck ? 60 : 80; raw[o + 2] = ck ? 40 : 160;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const PNG = makePng(400, 240);
const pngPath = OUT + '/field-fixture.png';
writeFileSync(pngPath, PNG);
const PNG_DATA_URL = 'data:image/png;base64,' + PNG.toString('base64');

/* ---- fixtures ----
 * WPILib 布局（8×6m,4 标签）;与 App 默认舞台 12×8 尺寸不同 → 全量替换 */
const wpilibJson = JSON.stringify({
  field: { length: 8, width: 6 },
  tags: [1, 2, 3, 4].map((id) => ({
    ID: id, family: '36h11', size: 0.1524,
    pose: {
      translation: { x: id % 2 ? 0.5 : 7.5, y: id < 3 ? 0.5 : 5.5, z: 0.6 },
      rotation: { quaternion: { X: 0, Y: 0, Z: 0, W: 1 } },
    },
  })),
});
const wpilibPath = OUT + '/layout-fixture.json';
writeFileSync(wpilibPath, wpilibJson);
const pkgJson = JSON.stringify({
  id: 'test-arena', name: '测试竞技场', sizeM: { widthM: 10, depthM: 7 },
  image: { url: PNG_DATA_URL, widthPx: 400, heightPx: 240 }, tags: [],
});
const pkgPath = OUT + '/package-fixture.json';
writeFileSync(pkgPath, pkgJson);

/* ---- 跑 ---- */
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ acceptDownloads: true });
await ctx.addInitScript(() => localStorage.setItem('ghpaths.lang', 'zh-CN'));
const page = await ctx.newPage();
await page.goto(BASE);
await page.locator('h1').waitFor();

const openDlg = async () => {
  await page.getByRole('button', { name: '场地', exact: true }).click();
  await page.locator('.field-card').waitFor({ state: 'visible' });
};
const jsonInput = page.locator('.field-card input[type="file"][accept*="json"]');
const pngInput = page.locator('.field-card input[type="file"][accept*="png"]');

// ---- 1. 默认舞台信息 ----
await openDlg();
let info = await page.locator('.field-info').textContent();
ok('默认舞台信息', /默认舞台/.test(info ?? '') && /AprilTag 0 个/.test(info ?? ''), `info="${info}"`);

// ---- 2. 导入 WPILib 布局 → 标签渲染 ----
await jsonInput.setInputFiles(wpilibPath);
await page.locator('.field-card .stat-ok').waitFor({ timeout: 3000 });
await page.keyboard.press('Escape');
await page.locator('.field-tag').first().waitFor({ timeout: 3000 });
const tagCount = await page.locator('.field-tag').count();
ok(`标签渲染（${tagCount} 个）`, tagCount === 4);
info = await (await page.getByRole('button', { name: '场地', exact: true }).click(), page.locator('.field-info')).textContent();
ok('场地信息更新（8×6m/4 标签）', /8×6m/.test(info ?? '') && /AprilTag 4 个/.test(info ?? ''), `info="${info}"`);

// ---- 3. 导出 AprilTag 布局（真实下载）→ 往返比对 ----
const dl = page.waitForEvent('download', { timeout: 5000 });
await page.locator('.field-card').getByRole('button', { name: '导出 AprilTag 布局' }).click();
const d = await dl;
const exportPath = OUT + '/exported-layout.json';
await d.saveAs(exportPath);
const exported = JSON.parse(readFileSync(exportPath, 'utf8'));
ok('导出:field 尺寸', exported.field.length === 8 && exported.field.width === 6, JSON.stringify(exported.field));
ok('导出:往返保布局坐标（fixture x=0.5 → 0.5）', exported.tags[0].pose.translation.x === 0.5, `x=${exported.tags[0].pose.translation.x}`);
ok('导出:ID 全量', [1, 2, 3, 4].every((id, i) => exported.tags[i].ID === id));
await page.keyboard.press('Escape');

// ---- 4. 导入 PNG 底图 → 尺寸表单 → 渲染 ----
await openDlg();
await pngInput.setInputFiles(pngPath);
await page.locator('.field-png-form').waitFor({ state: 'visible', timeout: 3000 });
const hint = await page.locator('.field-png-form .prefs-hint').textContent();
ok('PNG 表单:像素提示（400×240px）', /400×240px/.test(hint ?? ''), `hint="${hint}"`);
await page.locator('.field-size-inputs input').nth(0).fill('10');
await page.locator('.field-size-inputs input').nth(1).fill('6');
await page.locator('.field-png-form').getByRole('button', { name: '确定' }).click();
await page.locator('.field-image').waitFor({ timeout: 3000 });
ok('底图渲染（<image> 出现）', true);
info = await page.locator('.field-info').textContent();
ok('信息:10×6m + 底图有', /10×6m/.test(info ?? '') && /底图：有/.test(info ?? ''), `info="${info}"`);
await page.keyboard.press('Escape');

// ---- 5. reload → 持久化 ----
await page.reload();
await page.locator('h1').waitFor();
await page.locator('.field-image').waitFor({ timeout: 3000 });
ok('reload 后底图仍在（localStorage 持久化）', true);

// ---- 6. 内置赛季场地（打包清单;dev 下 public/fields 托管底图） ----
await openDlg();
await page.locator('.field-card').getByRole('button', { name: /Andymark.*应用/ }).click();
await page.waitForTimeout(500);
info = await page.locator('.field-info').textContent();
ok('内置:Andymark 应用（16.518×8.043m/32 标签/有底图）',
  /16\.518×8\.043m/.test(info ?? '') && /AprilTag 32 个/.test(info ?? '') && /底图：有/.test(info ?? ''), `info="${info}"`);
await page.keyboard.press('Escape');
const builtinTags = await page.locator('.field-tag').count();
ok(`内置:标签渲染（${builtinTags} 个）`, builtinTags === 32);
await page.locator('.field-image').first().waitFor({ timeout: 3000 });
ok('内置:底图渲染', true);
const dlB = page.waitForEvent('download', { timeout: 5000 });
await page.getByRole('button', { name: '场地', exact: true }).click();
await page.locator('.field-card').getByRole('button', { name: '导出 AprilTag 布局' }).click();
const dB = await dlB;
await dB.saveAs(OUT + '/exported-2026.json');
const exportedB = JSON.parse(readFileSync(OUT + '/exported-2026.json', 'utf8'));
ok('内置:导出 32 标签（WPILib 格式）', exportedB.tags.length === 32 && exportedB.field.length > 16);
await page.keyboard.press('Escape');

// ---- 7. 恢复默认 ----
await openDlg();
await page.locator('.field-card').getByRole('button', { name: '恢复默认舞台' }).click();
await page.waitForTimeout(300);
info = await page.locator('.field-info').textContent();
ok('恢复默认（12×8/0 标签/无底图）', /12×8m/.test(info ?? '') && /AprilTag 0 个/.test(info ?? '') && /底图：无/.test(info ?? ''), `info="${info}"`);
await page.keyboard.press('Escape');
ok('底图已移除', (await page.locator('.field-image').count()) === 0);

await browser.close();
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
console.log(`产物: ${OUT}/{field-fixture.png,layout-fixture.json,exported-layout.json}`);
process.exit(fail > 0 ? 1 : 0);
