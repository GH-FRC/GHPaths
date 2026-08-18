# ADR-0003：NT 接入必须过适配层

日期：2026-08-18 · 状态：已接受

## 背景

核查确认（2026-08-18）：WPILib **没有官方 JS/TS NT 客户端**——wpilibsuite/NetworkTablesClients 实际只含一个休眠的 .NET NT3 客户端。当前唯一可用选型：社区 ntcore-ts（`@ntcore-ts/client`，活跃维护、支持多服务器并连、内置 WPILib 几何 struct 类型；但为 1.0 beta、单人维护）。

## 决策

console / sim 一律经 `packages/nt-link` 的 `NtLink` 接口访问 NT；ntcore-ts 的依赖只允许出现在 nt-link 的实现文件中。兜底路径：NT4 协议（WebSocket + JSON 控制帧 + MessagePack 数据帧，端口 5810/5811）有官方规范，必要时自研薄客户端。

## 后果

- 换实现 / fork 时 UI 零改动；
- 可以在适配层内做 pose 专用优化（压缩 update interval、flush 策略、批量订阅）而不污染 UI。
