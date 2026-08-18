# robot/ — 机器人端代码（roboRIO / WPILib）

Phase 0 时用 WPILib VS Code 扩展在本目录生成标准 Java 项目（GradleRIO 模板）。本 README 先占位，记录约束：

- **vendordep 一律钉 2026 版**（ADR-0004）：WPILib 2026、PathPlannerLib 2026.x，不随赛季升级；
- 部署：macOS 完全支持（报告 §7.1），`./gradlew deploy` 直连 mDNS 名；
- 与演控的接口**只走** `packages/show-protocol` 定义的 NT topics（pose / health / cmd / clock）；
- 机器人代码必须实现的表演安全项（报告 §六.4）：
  - 最大速度/加速度上限（远低于比赛配置，独立于轨迹参数的硬上限）；
  - 地理围栏：位姿超出舞台内缩边界（`field-model` 的 `stageGeofence`）立即停；
  - 演出时钟驱动轨迹（不用本地时钟）；时钟样本丢失超过宽限期 → 停；
- 一键启动语义（`ShowCommand`）：`arm` → 预载轨迹段；`start(tStart)` → 到点启动；`hold` / `resume` / `stop`。
