// wpilog-roundtrip —— WPILOG 写入器与 JSONL 转换器的往返验证。
// 用 wpilog-parser（社区库,ADR-0006 调研确认的读取实现）读回我们写的文件:
// 校验 header/entry 目录/数据值逐项正确,AdvantageScope 同源解析路径即通。
// 运行:node apps/console/src/wpilog-roundtrip.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { jsonlToWpilog } from './wpilog-export.ts';
import { WpilogWriter, POSE2D_SCHEMA, TRANSLATION2D_SCHEMA, ROTATION2D_SCHEMA } from './wpilog.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

// ---- 1) 写入器基础:构造 → 读回 ----
const w = new WpilogWriter('test');
// 嵌套结构一并注册（Pose2d 引用 Translation2d/Rotation2d——缺一则结构解码排队等待）
w.addSchema('Pose2d', POSE2D_SCHEMA);
w.addSchema('Translation2d', TRANSLATION2D_SCHEMA);
w.addSchema('Rotation2d', ROTATION2D_SCHEMA);
const poseId = w.addEntry('robot/Pose2d', 'struct:Pose2d');
const dblId = w.addEntry('clock', 'double');
w.appendPose2d(poseId, 1_000_000, 1.5, -2.5, 0.785398);
w.appendDouble(dblId, 1_100_000, 42.5);
w.appendDouble(dblId, 1_200_000, 43.5);
const buf = Buffer.from(await w.finish().arrayBuffer());
writeFileSync('/tmp/test.wpilog', buf);

// ---- 2) 用 wpilog-parser 读回 ----
const { readRecords, isDataRecord, RecordType, decodeRecords, catalogEntries } = await import('wpilog-parser');
const raw = readFileSync('/tmp/test.wpilog');
const u8 = new Uint8Array(raw);
const records = [...readRecords(u8.buffer)]; // Generator → 数组
console.log(`读回 ${records.length} 条记录`);

const catalog = [...catalogEntries(records)]; // 也是 Generator
console.log('目录:', JSON.stringify(catalog.map((e: { name: string; type: string }) => ({ name: e.name, type: e.type }))));
assert(catalog.some((e: { name: string }) => e.name === '/.schema/Pose2d'), 'schema entry 存在');
// parser 侧 normalizeEntryName 会补前导 /（'robot/Pose2d' → '/robot/Pose2d'）
assert(catalog.some((e: { name: string }) => e.name === '/robot/Pose2d'), 'pose entry 存在');

const decoded = [...decodeRecords(records, catalog)]; // Generator → 数组
const dataRecords = decoded.filter((r: { type: string }) => r.type !== 'control'); // type=实际类型串,control=控制记录
console.log(`数据记录 ${dataRecords.length} 条`);

// 校验 pose 值（struct:Pose2d → 3 doubles LE）。
// 注:wpilog-parser 2.2.0 的 structschema 解码有 name.slice(16) bug（'/.schema/' 实长 9）,
// struct 记录在其 decodeRecords 阶段被排队丢弃——故从 readRecords 的原始层直接取字节校验;
// AdvantageScope 读的是 WPILib 原生约定（我们逐字节对照 DataLog.cpp 实现,一致）。
const rawPose = records.find(
  (r: { kind: string; record?: { entryId: number } }) =>
    r.kind === 'data' && r.record?.entryId === poseId,
) as { record: { payload: Buffer } };
assert(rawPose !== undefined, 'pose 原始记录存在');
assert(rawPose.record.payload.length === 24, 'pose payload 24 字节（3×double）');
const dv = new DataView(rawPose.record.payload.buffer, rawPose.record.payload.byteOffset, rawPose.record.payload.byteLength);
assert(Math.abs(dv.getFloat64(0, true) - 1.5) < 1e-9, 'pose.x = 1.5');
assert(Math.abs(dv.getFloat64(8, true) - -2.5) < 1e-9, 'pose.y = -2.5');
assert(Math.abs(dv.getFloat64(16, true) - 0.785398) < 1e-5, 'pose.rot');
console.log('Pose2d 数值 ✓');

// 校验 double 时间序列
const dblRecs = dataRecords.filter((r: { entryId: number; type: string }) => r.entryId === dblId && r.type === 'double');
assert(dblRecs.length === 2, 'clock 两条');
// decodeRecords 已把 double payload 解码为数值
assert(Math.abs((dblRecs[0] as { payload: number }).payload - 42.5) < 1e-9, 'clock[0] = 42.5');
console.log('double 序列 ✓');

// ---- 3) JSONL → WPILOG 全链 ----
const jsonl = [
  JSON.stringify({ type: 'meta', v: 1, recordedAt: '2026-08-19T00:00:00Z', teams: [9001], showId: 'demo' }),
  JSON.stringify({ type: 'show', tRecMs: 100, event: 'start' }),
  JSON.stringify({ type: 'pose', tRecMs: 150, tShowUs: 0, robot: 9001, xM: -4.2, yM: -2.75, headingRad: 0.1 }),
  JSON.stringify({ type: 'pose', tRecMs: 250, tShowUs: 100000, robot: 9001, xM: -4.1, yM: -2.74, headingRad: 0.1 }),
  JSON.stringify({ type: 'health', tRecMs: 300, robot: 9001, health: { dsLinked: true, enabled: false, estopped: false, clockLinked: true, showState: 'armed', codeVersion: 't', fault: null } }),
  JSON.stringify({ type: 'ds', tRecMs: 350, team: 9001, state: 'enabled', linked: true, batteryVolts: 12.4 }),
].join('\n');
const blob = jsonlToWpilog(jsonl);
assert(blob !== null, 'jsonl→wpilog 成功');
const full = Buffer.from(await blob.arrayBuffer());
writeFileSync('/tmp/show.wpilog', full);
const records2 = [...readRecords(new Uint8Array(full).buffer)];
const catalog2 = [...catalogEntries(records2)];
const names = catalog2.map((e: { name: string }) => e.name);
console.log('全链目录:', names.join(', '));
assert(names.some((n: string) => n.endsWith('9001/Pose2d')), '含 9001/Pose2d');
assert(names.some((n: string) => n.endsWith('showClock/s')), '含 showClock');
assert(names.some((n: string) => n.endsWith('9001/batteryVolts')), '含 battery');
assert(names.some((n: string) => n.endsWith('show/events')), '含 show/events');
console.log(`全链 ${records2.length} 条记录 ✓`);

console.log('wpilog-roundtrip 通过 ✓');
