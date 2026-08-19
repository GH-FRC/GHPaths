# ADR-0008：应用内三语言设置 + 场地地图（赛季内置与用户导入）

日期：2026-08-19 · 状态：已接受

## 背景

用户需求（2026-08-19）：① 苹果端设置（Preferences）提供语言调整，支持简体中文、繁体中文、英文；② 场地地图像 AdvantageScope 一样可导入——每个赛季的地图提前内置，且用户可自己导入（AprilTag 等元素一并导入）。

已核实的事实：AS 的场地资产机制 = 2D 场地图片 + 角点像素标定 + 场地尺寸（米）+ 3D 模型（.glb），赛季资产由 AdvantageScopeAssets 仓库（**BSD-3**）联网后台下载；AprilTag 布局有 WPILib 官方 JSON 格式（AprilTagFieldLayout，PhotonVision 同格式）。演出环境不保证联网 → 内置而非下载。

## 决策

1. **语言（§8.7）**：Preferences（⌘,）提供 简体中文 / 繁體中文 / English；默认跟随系统、手动覆盖并持久化（浏览器期 localStorage / 打包后 Tauri store，随演出配置记忆）。实现用 react-i18next（或同级）；**繁体 = OpenCC 从简体自动转换 + 机器人术语表人工校对**起步。数据与 topic/日志字段不翻译。机制骨架 Phase 2 收尾就位，全量覆盖等 Phase 3 UI 文案冻结（避免界面迭代期反复重翻）。
2. **场地地图（§8.8）**：
   - **赛季场地随版本内置**（2D 图 + 标定 + AprilTag 布局，3D 可选），来源 = WPILib 官方赛季 AprilTag JSON + AS 生态素材（AdvantageScopeAssets，BSD-3 可参照）；**不联网下载**（演出环境假设离线）。
   - **舞台也是场地**：内置默认舞台模板；用户可导入自己的舞台平面图。
   - **用户导入场地包**：PNG + 像素角点标定 + 尺寸（米）+ 可选 .glb + 可选 AprilTag 布局（**直接兼容 WPILib/PhotonVision 官方格式**）；精确 schema 以 AS Custom Assets 文档与 AdvantageScopeAssets 实物为准，实现时对齐。
   - `packages/field-model` 新增 `FieldMap` 类型（image/corners/sizeM/tags/geofence）；show-protocol 不动（机器人只认世界坐标）。
3. **AprilTag 单一事实来源**：演控端一份布局既用于 2D/3D 渲染，也可导出给机器人侧 PhotonVision 协处理器（同一文件），两边不各配各的。

## 后果

- 每次 UI 改动需三语言同步（AI 工具擅长，但列入改动 checklist）；繁体依赖 OpenCC 转换质量 + 术语表维护。
- 场地素材版权：自用无碍（AS/PP 内置先例充分）；若日后公开发布安装包，发版 checklist 增"当赛季素材条款复查"项。
- 路径编辑器（Phase 3）直接以 FieldMap 为画布底图，无额外适配。
- 新增待办：Preferences 窗口骨架、i18n 接入、FieldMap 类型与导入 UI、赛季场地打包脚本。
