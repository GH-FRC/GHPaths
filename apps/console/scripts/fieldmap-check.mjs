/**
 * FieldMap 单元检查：WPILib AprilTagFieldLayout 解析/导出往返、validateFieldMap
 * 边界、pixelToWorld 满铺映射、yawFromQuat。
 * esbuild 从 workspace 解析 @ghpaths/field-model。
 */
import {
  parseAprilTagLayout, exportAprilTagLayout, validateFieldMap,
  pixelToWorld, yawFromQuat, DEFAULT_FIELD_MAP,
} from '@ghpaths/field-model';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

// 官方 AprilTagFieldLayout 格式 fixture（2026 赛季字段形态:field.length/width + tags[].ID/pose）
const wpilibJson = JSON.stringify({
  field: { length: 16.54175, width: 8.0137 },
  tags: [
    { ID: 1, family: '36h11', size: 0.1524,
      pose: { translation: { x: 0.5, y: 0.5, z: 0.5 }, rotation: { quaternion: { X: 0, Y: 0, Z: 0.7071, W: 0.7071 } } } },
    { ID: 2,
      pose: { translation: { x: 16.0, y: 7.5, z: 1.2 }, rotation: { quaternion: { X: 0, Y: 0, Z: 0, W: 1 } } } },
    { ID: 3,
      pose: { translation: { x: 8.27, y: 4.0, z: 0.3 }, rotation: { quaternion: { X: 0, Y: 0, Z: -0.7071, W: 0.7071 } } } },
  ],
});

// ---- 1. 解析:角原点 → 中心原点 ----
const map = parseAprilTagLayout(wpilibJson);
ok('解析:标签数', map.tags.length === 3);
const t1 = map.tags[0];
ok('解析:坐标平移到中心', Math.abs(t1.xM - (0.5 - 16.54175 / 2)) < 1e-9 && Math.abs(t1.yM - (0.5 - 8.0137 / 2)) < 1e-9,
  `t1=(${t1.xM},${t1.yM})`);
ok('解析:family/size 保留', t1.family === '36h11' && t1.sizeM === 0.1524);
ok('解析:yaw 派生（Z=0.7071 → ±90°）', t1.yawRad != null && Math.abs(Math.abs(t1.yawRad) - Math.PI / 2) < 1e-3,
  `yaw=${t1.yawRad}`);
ok('解析:sizeM 取自布局', map.sizeM.widthM === 16.54175 && map.sizeM.depthM === 8.0137);

// ---- 2. 导出 → 再解析往返 ----
const out = exportAprilTagLayout(map);
const back = parseAprilTagLayout(out);
ok('往返:标签数一致', back.tags.length === 3);
ok('往返:坐标一致（中心原点）', back.tags.every((t, i) => Math.abs(t.xM - map.tags[i].xM) < 1e-9 && Math.abs(t.yM - map.tags[i].yM) < 1e-9));
ok('往返:四元数往返', back.tags[0].quat.every((v, i) => Math.abs(v - map.tags[0].quat[i]) < 1e-9));

// ---- 3. validateFieldMap ----
ok('校验:默认舞台通过', validateFieldMap(DEFAULT_FIELD_MAP) === null);
ok('校验:合法地图通过', validateFieldMap(map) === null);
ok('校验:超界标签拒绝', validateFieldMap({ ...map, tags: [{ id: 99, xM: 99, yM: 0 }] }) !== null);
ok('校验:重复 ID 拒绝', validateFieldMap({ ...map, tags: [map.tags[0], { ...map.tags[1], id: map.tags[0].id }] }) !== null);
ok('校验:荒谬尺寸拒绝', validateFieldMap({ ...DEFAULT_FIELD_MAP, sizeM: { widthM: 0.1, depthM: 8 } }) !== null);
let threw = false;
try { parseAprilTagLayout('{"tags":[]}'); } catch { threw = true; }
ok('校验:坏 JSON 抛错', threw);

// ---- 4. pixelToWorld 满铺 ----
const img = { url: 'x', widthPx: 1654, heightPx: 801 }; // 无标定
const size = { widthM: 16.54, depthM: 8.01 };
const c0 = pixelToWorld(img, size, 0, 0);
const c1 = pixelToWorld(img, size, img.widthPx, img.heightPx);
ok('满铺:左上 = (-W/2, +D/2)', Math.abs(c0.xM + size.widthM / 2) < 0.01 && Math.abs(c0.yM - size.depthM / 2) < 0.01,
  `c0=(${c0.xM},${c0.yM})`);
ok('满铺:右下 = (+W/2, -D/2)', Math.abs(c1.xM - size.widthM / 2) < 0.01 && Math.abs(c1.yM + size.depthM / 2) < 0.01);
const cal = [{ px: 100, py: 50, xM: -8, yM: 4 }, { px: 1554, py: 751, xM: 8, yM: -4 }];
const mid = pixelToWorld({ ...img, calibration: cal }, size, 827, 400.5);
ok('标定:中点 ≈ 原点', Math.abs(mid.xM) < 0.05 && Math.abs(mid.yM) < 0.05, `mid=(${mid.xM},${mid.yM})`);

// ---- 5. yawFromQuat 单位圆 ----
ok('yaw:W=1 → 0', Math.abs(yawFromQuat(0, 0, 0, 1)) < 1e-9);
ok('yaw:Z=1 → π', Math.abs(yawFromQuat(0, 0, 1, 0) - Math.PI) < 1e-9);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
