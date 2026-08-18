# GHPaths

面向机器人表演的 FRC 多机器人路径规划与监控系统：一台 Mac 同时监控/启停最多 6 台 roboRIO 机器人，画布叠加实时位姿与规划路径，统一演出时钟驱动全自动驾驶。

> 状态：**Phase 0（单机链路验证）准备中**。可行性论证见 [GHPaths_可行性研究报告.md](GHPaths_可行性研究报告.md)（v1.2），其 41 条论断的独立核查记录见 [核查勘误](GHPaths_可行性研究报告_核查勘误_2026-08-18.md)。

## 仓库地图

| 路径 | 内容 |
|---|---|
| `apps/console` | 演控台 UI（Vite + React；Tauri 壳推迟到打包阶段） |
| `packages/show-protocol` | 演出协议：NT topic 命名、消息类型、时钟语义（单一事实来源） |
| `packages/field-model` | 舞台/足迹/路径/地理围栏数据模型 |
| `packages/nt-link` | NT4 接入适配层（隔离第三方 NT 客户端依赖） |
| `packages/multi-ds` | 自研 multi-DS：FRC DS 协议心跳与使能控制（独立进程） |
| `sim/fake-robot` | 模拟机器人（NT 发布 + DS 端点模拟），无硬件开发回路 |
| `robot/` | roboRIO 机器人代码（Phase 0 由 WPILib 模板生成，钉 2026 栈） |
| `docs/` | 架构、ADR 决策记录、DS 协议笔记、Phase 0 清单 |
| `scripts/` | 演控机环境脚本（secondary IP 别名配置等） |

## 快速开始

```bash
npm install        # 根目录执行一次
npm run dev        # 演控台 UI → http://localhost:5173
npm run typecheck  # 全仓类型检查
npm run build      # 构建console UI
npm run sim        # 模拟机器人（Phase 0 实现中，当前为占位）
```

## 开发约定

见 [CLAUDE.md](CLAUDE.md)——许可证红线（OpenDS 只读）、2026 冻结栈、架构不变量、工作流。架构与选型决策记录在 `docs/decisions/`（ADR）。

## 路线图

Phase 0 单机链路验证 → Phase 1 双机 PoC → Phase 2 演控 MVP → Phase 3 多机路径编辑器 → Phase 4 全编制联排（详见报告第十节）。

**当前行动项**：硬件盘点（`docs/phase0-checklist.md` §1）——6 台机器人的无线电型号与 roboRIO 镜像版本，直接决定组网方案与 Windows 依赖面。
