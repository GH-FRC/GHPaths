# CLAUDE.md — GHPaths 开发约定（AI 协作必读）

GHPaths：面向机器人表演的 FRC 多机器人演控系统。动手前先读：

- `GHPaths_可行性研究报告.md`（v1.2，论证与决策依据）
- `GHPaths_可行性研究报告_核查勘误_2026-08-18.md`（事实核查记录，报告信度的来源）
- `docs/architecture.md`（仓库内权威架构描述）

## 红线（违反即返工）

1. **许可证**：OpenDS（github.com/Boomaa23/open-ds）自定义许可仅限机器人测试用途、禁止 FIRST 活动——**只许读它学协议，严禁复制其任何代码/配置进本仓库**。CheesyArena 系改版再分发需 Team 254 许可（自用无碍）。可合法复用：FRCture 协议文档（协议事实本身）、ds-rs（MIT/Apache-2.0 双许可）。
2. **协议事实来源**：FIRST 官方 FMS 白皮书/游戏手册的端口表是过时的（写作 UDP 1130/1140，实为 1110/1150/1740）。DS 协议以 `docs/protocol/ds-protocol-2026.md` 为准；该文件只收「已核查」与「待实测」两类条目，修改必须附依据。
3. **2026 冻结栈**：机器人镜像、WPILib、vendordep 一律钉 2026 版（ADR-0004）。不随 FRC 赛季升级；升级属主动决策，须带协议回归测试。
4. **安全路径**：`packages/multi-ds` 中使能/急停/看门狗相关改动，必须过该包 README 的安全检查单，并在提交说明写明验证方式。

## 架构不变量

- NT 访问只经 `packages/nt-link`（ADR-0003）；UI 不得直接依赖任何 NT 客户端库；
- multi-DS 独立进程，UI 经 localhost:5899 控制 API 交互（ADR-0002）；
- 演出时钟（show-time）语义只定义在 `packages/show-protocol`；机器人以演出时钟驱动轨迹，不用本地时钟；
- 世界坐标系：+x 向右、+y 向观众方向、原点舞台中心、单位米/弧度（`packages/field-model` 为准）。

## 工作流

- 包管理：npm workspaces（node ≥23.6——`npm run sim` 直接运行 .ts，依赖原生 type stripping，23.6 起默认开启）。常用命令（根目录执行）：`npm install`（一次）、`npm run dev`（console UI）、`npm run typecheck`（全仓）、`npm run build`、`npm run sim`（模拟机器人）；
- 任何改动完成后必须过 `npm run typecheck`；
- 目录速览：`apps/console`（UI）· `packages/{show-protocol,field-model,nt-link,multi-ds}` · `sim/fake-robot` · `robot/`（Phase 0 生成）· `docs/`（architecture / decisions(ADR) / protocol / phase0-checklist）· `scripts/`；
- 架构/选型变更走 `docs/decisions/` 新增 ADR，不改旧 ADR 正文（只把状态改为「已被取代」）；
- **工程日志**：每天一篇 `engineering-log/YYYY.M.D.md`（月/日不补零，格式如 `2026.8.18`），当天已有则续写不另开；每次会话收尾前检查当天日志是否已反映本次工作（约定详见 `engineering-log/README.md`）。

## 环境备注（macOS，演控主力机）

- 机器人连不上时第一嫌疑：系统设置 → 隐私与安全性 → 本地网络 授权（macOS 15+；Terminal/SSH 启动的 CLI 豁免此权限）；
- 多 IP：`sudo ./scripts/setup-aliases.sh add|remove|status`；alias 会被网卡 bounce（WiFi 重连/DHCP 续租）清掉，属预期，启动自检兜底；
- Node ≥22 自带全局 WebSocket（NT4 与 sim 用，无需 ws 依赖）；Node ≥23.6 可直接运行 .ts 源码（sim 入口即用此特性）。
