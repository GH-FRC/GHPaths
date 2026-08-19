# robot/ — 机器人端代码（roboRIO / WPILib 2026）

**状态：Phase 0 骨架——未经编译验证**（写作环境无 GradleRIO 依赖下载条件；见 build.gradle 尾部的语法自检清单）。首次部署前必须在 WPILib VS Code 里过一遍 Build。

## 工程结构

```
ghpaths-robot/
├── build.gradle                  GradleRIO 2026.1.1（TODO: 按实际安装核对版本）
├── gradle.properties             teamNumber（部署机器的队号）
├── vendordeps/PathPlannerLib.json
└── src/main/java/frc/ghpaths/
    ├── Main.java / Robot.java    入口 + 20ms 主循环
    ├── Constants.java            topics/舞台/围栏/安全上限（与 show-protocol、field-model 对齐）
    └── show/
        ├── ShowClock.java          演出时钟消费（断时钟即停/跳变防护/hold 语义）
        ├── ShowCommandReceiver.java arm/start/hold/resume/stop（就位检查、迟到 start 拒绝）
        ├── ShowCoordinator.java    运动许可链总协调 + 地理围栏
        └── TelemetryPublisher.java pose [tShowUs,x,y,heading] + health JSON 发布
```

## 与演控的接口（只走 show-protocol 定义的 NT4 topics）

- 订阅：`/ghpaths/clock`（演出时钟）、`/ghpaths/<team>/cmd`（演出命令）
- 发布：`/ghpaths/<team>/pose`（double[]，20ms）、`/ghpaths/<team>/health`（JSON）
- 语义与 sim/fake-robot **完全一致**（同一套探针验证过的行为：断时钟 750ms 停、跳变闩锁、就位检查、围栏即停）

## 表演安全项（报告 §六.4，已写入 Constants）

- 最大速度 1.5 m/s、最大加速度 1.0 m/s²（远低于比赛性能；Drive 实现层硬限）
- 地理围栏：外接圆内缩 + 0.05m 余量，越界立即停 + fault 上报
- 断时钟 750ms 即停；时钟跳变拒绝跟踪（就地保持）；DS 失能/estop 天然断使能

## Phase 0 → Phase 2 的 TODO

1. **Phase 0（首次部署）**：gradlew build 通过 → deploy → AdvantageScope 看 pose/health → 对抓包验证 multi-DS 使能三态
2. **Phase 2**：ShowCoordinator 注入 DriveInterface（odometry 位姿来源 + 驱动跟随）；PathPlannerLib 轨迹装载（arm 命令的 showId/segmentId → 本机路径）
3. **队号配置**：TeamNumberProvider.java + gradle.properties 同步改（Phase 0 可改为读 roboRIO 面板）

## vendordep 钉版本（ADR-0004 冻结栈）

WPILib 2026、PathPlannerLib 2026.x——**不随赛季升级**；升级属主动决策，须带协议回归测试（probe 八关 + ds-probe 四关）。
