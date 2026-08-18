# GHPaths 总体架构

来源：《GHPaths_可行性研究报告.md》§六（v1.2）。报告侧重论证，本文件是仓库内的**权威工程契约**。

## 组件图

```
                        ┌─────────────────────────────────────┐
                        │   演控电脑（一台 Mac）                │
                        │  ┌───────────────────────────────┐  │
                        │  │  apps/console  演控 UI          │  │
                        │  │  · 多机路径编辑器（画布/时间轴）    │  │
                        │  │  · 实时监控视图（6 机位置叠加）     │  │
                        │  │  · 一键启动 / 一键全停           │  │
                        │  │  · 演出时钟广播（show-time）      │  │
                        │  └────┬──────────────────┬────────┘  │
                        │   packages/nt-link     localhost:5899 │
                        │   （NT4 适配层）      packages/multi-ds │
                        │                        （独立进程）    │
                        └─────────┼──────────────────┼─────────┘
                                  │ NT4(5810)        │ DS 协议(1740/1110/1150)
                          ┌───────┴──────────────────┴───────┐
                          │   场地路由器/AP（有线连演控机）      │
                          └───┬────┬────┬────┬────┬────┬─────┘
                              R-01 …………………… R-06（roboRIO，桥接模式入网）
```

开发期另有 `sim/fake-robot`：在 127.0.0.1 上同时扮演「NT4 位姿源 + roboRIO DS 端点」，
让 console / multi-DS 的日常开发不依赖实机（ADR-0005）。

## 模块与契约

| 模块 | 位置 | 职责 | 对外契约 |
|---|---|---|---|
| 演控台 UI | `apps/console` | 画布/时间轴/一键启停/时钟广播 | — |
| NT 接入层 | `packages/nt-link` | 连 6 机器人收 pose/health、发命令/时钟 | `NtLink` 接口（UI 只认它） |
| 演出协议 | `packages/show-protocol` | topic 命名、消息类型、时钟语义 | 纯类型，单一事实来源 |
| 场地模型 | `packages/field-model` | 舞台/足迹/路径/围栏 | 纯类型 + 纯函数 |
| multi-DS | `packages/multi-ds` | DS 协议心跳、使能/急停 | 独立进程 + localhost WS 控制 API（:5899） |
| 模拟机器人 | `sim/fake-robot` | 无硬件回路 | CLI |
| 机器人代码 | `robot/` | roboRIO WPILib（Phase 0 生成，钉 2026） | show-protocol 的 NT topics |

## 端口一览

| 端口 | 协议 | 用途 |
|---|---|---|
| 5810（/5811 TLS） | NT4 WebSocket | 位姿/命令/时钟 |
| TCP 1740 | FRC DS | roboRIO → DS 连接管理（标签化数据） |
| UDP 1110 | FRC DS | DS → roboRIO 控制包（20ms 心跳） |
| UDP 1150 | FRC DS | roboRIO → DS 状态包（20ms） |
| 5899 | 本地 | multi-DS 控制 API（UI ↔ multi-DS，仅 localhost） |

FMS 侧端口（1160/1750/1121 等）本项目不使用，记录在协议笔记里备查。

## 演出启动数据流

1. UI 加载 show → 每台机器人 `arm`（NT4）：预载轨迹段；
2. UI → multi-DS（5899）：`enableAutonomous` × N（DS 协议使能）；
3. UI → NT4：`start(tStartShowUs)`——所有机器人在同一演出时钟时刻起步；
4. 机器人持续发布 pose（20ms），UI 叠加渲染；
5. 急停：UI → multi-DS `estop`（单播全部，不依赖 NT4 链路存活）。

## 安全链（谁崩溃了会怎样）

- **UI 崩溃** → multi-DS 失去控制连接 → 宽限期（默认 2s）后全部 disable；
- **multi-DS 崩溃** → 心跳停止 → 机器人 NI NetComm 看门狗切断输出（数百 ms 量级，用户代码不可绕过）；
- **机器人代码崩溃** → robot code 标志位失效，DS 侧可见；
- **物理急停**：独立于以上一切软件链路（报告 §六.4）。
