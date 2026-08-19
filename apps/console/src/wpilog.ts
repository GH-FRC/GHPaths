/**
 * WPILOG 写入器（ADR-0006 决策 3：写入器自研,不引入重依赖）。
 *
 * 线格式（依据 allwpilib v2026.2.1 wpiutil DataLog.cpp/reader 源码逐字节核对,2026-08-19）：
 *  - 文件头（12B）：'WPILOG' ‖ u16LE 版本(0x0100) ‖ u32LE extraHeaderSize ‖ extraHeader
 *  - 记录头（4~17B）：bitfield 首字节（entryLen=(b&3)+1,sizeLen=((b>>2)&3)+1,
 *    timestampLen=((b>>4)&7)+1）+ entry/size/timestamp 的小端变长整数;时间戳 μs
 *  - 控制记录（entry=0）：Start=[0x01][id u32LE][name,type,metadata 各
 *    u32LE 长度前缀字符串]（§AppendStartRecord）
 *  - schema 记录：普通 entry,名 '/.schema/<类型>',类型串 'structschema',数据=schema 字符串
 *    裸字节（§AddSchema：StartRecord + AppendImpl,无长度前缀）
 */

function varintLen(n: number): number {
  let len = 0;
  let v = n;
  do {
    len++;
    v = Math.floor(v / 256);
  } while (v > 0);
  return len;
}

function writeVarint(n: number, len: number): Uint8Array {
  const buf = new Uint8Array(len);
  let v = n;
  for (let i = 0; i < len; i++) {
    buf[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  return buf;
}

/** 一条 WPILOG 记录（控制或数据） */
function record(entry: number, timestampUs: number, payload: Uint8Array): Uint8Array {
  const entryLen = varintLen(entry);
  const sizeLen = varintLen(payload.length);
  // 时间戳按无符号变长写（μs 值域内 6 字节足够;readVarInt 两侧一致）
  const tsLen = Math.min(Math.max(varintLen(timestampUs), 1), 8);
  const headerFirst =
    (entryLen - 1) | ((sizeLen - 1) << 2) | ((tsLen - 1) << 4);
  const parts: Uint8Array[] = [
    new Uint8Array([headerFirst]),
    writeVarint(entry, entryLen),
    writeVarint(payload.length, sizeLen),
    writeVarint(timestampUs, tsLen),
    payload,
  ];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function encString(s: string): Uint8Array {
  const bytes = new TextEncoder().encode(s);
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length, true);
  out.set(bytes, 4);
  return out;
}

export interface WpilogEntryInfo {
  id: number;
  name: string;
  type: string;
  metadata?: string;
}

/** 增量构建器：start 记录全部先写（ts=0）,数据记录按时间序追加 */
export class WpilogWriter {
  private chunks: Uint8Array[] = [];
  private nextId = 1;

  constructor(extraHeader = '') {
    const extra = new TextEncoder().encode(extraHeader);
    const header = new Uint8Array(12 + extra.length);
    header.set(new TextEncoder().encode('WPILOG'), 0);
    new DataView(header.buffer).setUint16(6, 0x0100, true);
    new DataView(header.buffer).setUint32(8, extra.length, true);
    header.set(extra, 12);
    this.chunks.push(header);
  }

  /** 登记新 entry（控制 Start 记录,ts=0）;返回分配的 entry id */
  addEntry(name: string, type: string, metadata = ''): number {
    const id = this.nextId++;
    const nameB = encString(name);
    const typeB = encString(type);
    const metaB = encString(metadata);
    const payload = new Uint8Array(5 + nameB.length + typeB.length + metaB.length);
    payload[0] = 0x00; // kControlStart（枚举首值 0;Finish=1,SetMetadata=2）
    new DataView(payload.buffer).setUint32(1, id, true);
    let off = 5;
    for (const b of [nameB, typeB, metaB]) {
      payload.set(b, off);
      off += b.length;
    }
    this.chunks.push(record(0, 0, payload));
    return id;
  }

  /** 登记结构 schema（'/.schema/<name>' entry,类型串 'structschema',数据=schema 裸字符串——
   *  与 WPILib StructBufferUtil 同约定;AdvantageScope/wpilog-parser 按 'structschema' 识别） */
  addSchema(typeName: string, schema: string): number {
    const id = this.addEntry(`/.schema/${typeName}`, 'structschema');
    this.chunks.push(record(id, 0, new TextEncoder().encode(schema)));
    return id;
  }

  appendDouble(id: number, timestampUs: number, value: number): void {
    const p = new Uint8Array(8);
    new DataView(p.buffer).setFloat64(0, value, true);
    this.chunks.push(record(id, timestampUs, p));
  }

  appendDoubleArray(id: number, timestampUs: number, values: number[]): void {
    const p = new Uint8Array(values.length * 8);
    const dv = new DataView(p.buffer);
    values.forEach((v, i) => dv.setFloat64(i * 8, v, true));
    this.chunks.push(record(id, timestampUs, p));
  }

  appendBoolean(id: number, timestampUs: number, value: boolean): void {
    this.chunks.push(record(id, timestampUs, new Uint8Array([value ? 1 : 0])));
  }

  appendString(id: number, timestampUs: number, value: string): void {
    this.chunks.push(record(id, timestampUs, encString(value)));
  }

  /** Pose2d 原生结构（x,y,rotationRad 三个 double;Translation2d/Rotation2d schema 见调用侧） */
  appendPose2d(id: number, timestampUs: number, x: number, y: number, rotationRad: number): void {
    this.appendDoubleArray(id, timestampUs, [x, y, rotationRad]);
  }

  finish(): Blob {
    return new Blob(this.chunks as BlobPart[], { type: 'application/octet-stream' });
  }
}

// ---- WPILib 结构 schema（allwpilib v2026.2.1 几何类 GetSchema 原文）----
export const POSE2D_SCHEMA = 'Translation2d translation;Rotation2d rotation';
export const TRANSLATION2D_SCHEMA = 'double x;double y';
export const ROTATION2D_SCHEMA = 'double value';
