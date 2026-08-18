# @ghpaths/multi-ds

自研 multi-DS：一个进程内跑 6 个逻辑 Driver Station，分别向 6 台 roboRIO 发送使能心跳（FRC DS 协议）。

## 进程契约（ADR-0002）

- 独立 Node 进程：`npm run ds`（入口 `src/main.ts`）；
- 对 UI 暴露 localhost WebSocket 控制 API（端口 **5899**），消息类型见 `@ghpaths/show-protocol` 的 `MultiDsControl` / `MultiDsStatusMsg`（UI→DS：enable/disable/estop/clearEstop/…/uiPing；DS→UI：10Hz 状态广播含电池电压）；
- 不依赖 UI 存活：UI 崩溃/断连超过宽限期（默认 2s，`--grace-ms` 调整）后自动 disable 全部机器人；
- 协议实现只引用 `docs/protocol/ds-protocol-2026.md` 的事实与 FRCture / ds-rs（MIT/Apache-2.0）；
  **禁止复制 OpenDS 代码**——许可证红线，见 CLAUDE.md。

## 安全检查单（改动本包必须逐条过，并写入提交说明）

1. 进程被 `kill -9`，机器人在 ~1s 内全部失效？（DS 看门狗路径，不得有任何"优雅保持使能"逻辑）
   —— 2026-08-18 sim 实测：✓（512ms，`npm run probe:ds` 第 3 关）
2. UI 断连宽限期到，全部 disable？宽限期可调但不可关闭？
3. estop 无法被任何自动逻辑复位，只允许显式 clearEstop？
4. 任何重连/热切换优化都不会跳过或延迟心跳周期？
