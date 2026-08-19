# ADR-0006：可视化与遥测子系统——自研为主，AdvantageScope 为备胎

日期：2026-08-19 · 状态：已接受

## 背景

用户需求（2026-08-19 确认）：演控台内直观看到每台车的 2D/3D 位置与机构细节（炮塔指向等），以及炮塔电压、速度等遥测曲线；全程录制、事后回放。策略为双轨制——自研视图为主，自研部分出 bug 时可调起真正的 AdvantageScope 顶上。

已核实的下游事实：AdvantageScope（BSD-3）支持 NT4 客户端连接任意地址、直接打开 WPILOG（支持多文件自动时间对齐）、Custom Assets 机制（.glb 模型组件 ↔ Pose3d 数组一一对应驱动机构动画）；WPILOG 读取有现成 TS 库（wpilog-parser），写入格式公开。

## 决策

1. **遥测约定进 show-protocol**：新增 `componentPoses`（Pose3d[]，沿用 AdvantageScope Custom Assets 的组件对应约定）与 `telemetry/*` 数值 topic（炮塔电压/速度等）。机器人端一份 topic 同时喂 GHPaths 与 AdvantageScope。
2. **3D 视图在 apps/console 内实现**（three.js / react-three-fiber + .glb），模型资产与 AdvantageScope Custom Assets 共用（CAD→Blender→.glb，低模起步）；2D 沿用既有画布。
3. **录制双格式**：JSONL 为 GHPaths 原生（已落地），新增 **WPILOG 导出**（浏览器阶段做 JSONL→WPILOG 转换器；Tauri 落盘后可直接写）。写入器自研，不引入重依赖。
4. **AdvantageScope 三条备胎路径**：实时（本地 NT4 聚合转发服务器，AS 连演控机一窗看 6 机，Low Bandwidth 模式）；离线（"在 AdvantageScope 中打开"按钮，文件关联/拖拽）；单机直连排障。
5. **只依赖 AdvantageScope 公开接口**（NT4、WPILOG、Custom Assets），不碰其内部实现。

## 后果

- 优先级：遥测图表 + WPILOG 导出（Phase 2 收尾候选）→ 3D 全场监控 → 3D 机构姿态与模型管线（Phase 3）；
- 3D 模型是美术工作量大于编码工作量，几何体占位起步；
- AS 升级不影响本系统（只走公开接口）；
- 风险与缓解见报告第十节新增两行。
