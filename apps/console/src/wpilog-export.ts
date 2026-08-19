/**
 * JSONL → WPILOG 转换器（ADR-0006 决策 3:浏览器阶段做转换导出）。
 *
 * 输入:useRecorder.exportText() 的 ShowLogRecord v1 文本。
 * 输出:WPILOG Blob——AdvantageScope 直接打开（2D 场地 = 每机 struct:Pose2d entry;
 * 曲线 = 位姿/电池/时钟/状态的数值 entry）。时间戳用录制时钟（tRecMs×1000）,
 * AS 多文件对齐按此时间轴。
 */
import type { RobotHealth, RobotId, ShowLogRecord } from '@ghpaths/show-protocol';
import {
  WpilogWriter,
  POSE2D_SCHEMA,
  TRANSLATION2D_SCHEMA,
  ROTATION2D_SCHEMA,
} from './wpilog.ts';

interface HealthCache {
  dsLinked?: boolean;
  enabled?: boolean;
  clockLinked?: boolean;
  showState?: string;
}

export function jsonlToWpilog(jsonl: string): Blob | null {
  const writer = new WpilogWriter('GHPaths show log');

  // schema 登记（嵌套结构一并注册,与 NT4 惯例一致）
  writer.addSchema('Pose2d', POSE2D_SCHEMA);
  writer.addSchema('Translation2d', TRANSLATION2D_SCHEMA);
  writer.addSchema('Rotation2d', ROTATION2D_SCHEMA);

  const entryIds = new Map<string, number>();
  const id = (name: string, type: string): number => {
    let v = entryIds.get(name);
    if (v === undefined) {
      v = writer.addEntry(name, type);
      entryIds.set(name, v);
    }
    return v;
  };

  const healthCache = new Map<RobotId, HealthCache>();
  let showClockWritten = false;

  for (const line of jsonl.split('\n')) {
    const s = line.trim();
    if (s === '') continue;
    let rec: ShowLogRecord;
    try {
      rec = JSON.parse(s) as ShowLogRecord;
    } catch {
      continue; // 容忍坏行
    }
    const tsUs = Math.round((rec as { tRecMs?: number }).tRecMs! * 1000);

    if (rec.type === 'pose') {
      // AS 2D 场地用 Pose2d 原生结构
      writer.appendPose2d(
        id(`${rec.robot}/Pose2d`, 'struct:Pose2d'),
        tsUs,
        rec.xM,
        rec.yM,
        rec.headingRad,
      );
      // 原始 4 元数组（含演出时钟）——曲线与回放对齐用
      writer.appendDoubleArray(
        id(`${rec.robot}/pose`, 'double[]'),
        tsUs,
        [rec.tShowUs / 1e6, rec.xM, rec.yM, rec.headingRad],
      );
      // 演出时钟：取首台机器人的 tShow 作全局时间轴（各机时钟一致,单条足够）
      if (!showClockWritten) {
        writer.appendDouble(id('showClock/s', 'double'), tsUs, rec.tShowUs / 1e6);
      }
    } else if (rec.type === 'health') {
      const h: RobotHealth = rec.health;
      const c = healthCache.get(rec.robot) ?? {};
      // 布尔/字符串仅在变化时落盘（WPILOG 惯例:变化驱动）
      if (c.dsLinked !== h.dsLinked) {
        writer.appendBoolean(id(`${rec.robot}/dsLinked`, 'boolean'), tsUs, h.dsLinked);
        c.dsLinked = h.dsLinked;
      }
      if (c.enabled !== h.enabled) {
        writer.appendBoolean(id(`${rec.robot}/enabled`, 'boolean'), tsUs, h.enabled);
        c.enabled = h.enabled;
      }
      if (c.clockLinked !== h.clockLinked) {
        writer.appendBoolean(id(`${rec.robot}/clockLinked`, 'boolean'), tsUs, h.clockLinked);
        c.clockLinked = h.clockLinked;
      }
      if (c.showState !== h.showState) {
        writer.appendString(id(`${rec.robot}/showState`, 'string'), tsUs, h.showState);
        c.showState = h.showState;
      }
      healthCache.set(rec.robot, c);
    } else if (rec.type === 'ds') {
      writer.appendDouble(
        id(`${rec.team}/batteryVolts`, 'double'),
        tsUs,
        rec.batteryVolts,
      );
    } else if (rec.type === 'show') {
      writer.appendString(id('show/events', 'string'), tsUs, rec.event);
    }
  }
  showClockWritten = true;
  return writer.finish();
}
