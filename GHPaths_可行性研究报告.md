# GHPaths 可行性研究报告
## 面向机器人表演的 FRC 多机器人路径规划与监控系统

> 研究日期：2026-08-18（v1.2 修订：依据同日独立核查修正 roboRIO 烧录、NT 客户端选型、无线电换代、2027 时间线等论断，核查记录见《GHPaths_可行性研究报告_核查勘误_2026-08-18.md》；v1.1 修订：新增第七节"Mac 与 Windows 兼容性分析"）
> 研究范围：技术可行性、网络架构、使能控制、现有工具复用性、替代方案、风险与路线图

---

## 一、执行摘要

**结论：可行。** 你设想的三个核心需求（多机路径可视化、实时位置监控、单电脑连接 6 台机器人）在 FRC 原生控制系统上都可以实现，且不需要修改机器人硬件。其中两项（组网、实时监控）有官方支持的标准做法，属于"已被 offseason 赛事和众多展示活动反复验证的成熟路径"。

唯一需要自研攻坚的核心难点是 **Driver Station 使能问题**：roboRIO 必须持续收到 Driver Station 的特定数据包才会使能电机，而官方 DS 一台电脑只能运行一个实例、只控制一台机器人。解决方案是自研一个"多机 DS"组件（实现 FRC DS 通信协议，一台电脑同时充当 6 台机器人的 DS）。协议本身是公开的、有开源参考实现（OpenDS，维护到 2026 赛季协议），以你们"AI 工具主导开发维护"的模式，这是完全做得动的工程量。

需要接受的三个现实约束与一个补充结论：

1. **"一台电脑连 6 个机器人的 WiFi"要换个姿势**：不是电脑分别去连 6 个热点，而是让 6 台机器人连到同一个网络里，电脑也在这个网络中。这是标准做法，详见第三节。
2. **PathPlanner / Choreo 均无多机器人支持**（经调研确认），多机规划界面必须自研——但这正是这个项目的价值所在，且两者的轨迹库（均为宽松开源许可证）可以在机器人端复用。
3. **FRC 控制系统换代已启动**：2027 起启用 Systemcore 新控制体系；新 DS（已 alpha，跨平台含 macOS）只支持 Systemcore、不兼容 roboRIO，WPILib 也已于 2026-05 冻结 roboRIO 侧维护。对不上场比赛的表演项目反而是利好——锁定 2026 冻结栈后，DS 协议与机器人软件栈不再逐年漂移（详见 5.4 节）。
4. **Mac 作为演控主力机完全可行**：日常开发、排练、演出全流程都可以只靠 Mac 完成；需要借道 Windows 的一次性环节仅剩 roboRIO 烧录，以及仅 OpenMesh 旧无线电才涉及的刷写（现役 VH-109 无线电全程 Mac 网页/Docker 完成）。详见第七节的逐项对照。

---

## 二、需求回顾

| # | 需求 | 确认信息 |
|---|------|---------|
| 1 | 舞台 4~6 台机器人，软件中查看所有机器人的 Path | 用途为表演，非比赛 |
| 2 | 运行时实时看到每台机器的位置与路径 | 全自动驾驶，一键启动 |
| 3 | 一台电脑同时连接 6 台机器人 | 优先 FRC 原生控制体系，尽量少改动 |
| 4 | 演控电脑偏好 **Mac**（2026-08-18 补充） | 已评估各环节 macOS 兼容性，见第七节 |

附加约束：开发维护主要依靠 AI 工具（Claude、GLM、DeepSeek、Codex），技术选型需考虑 AI 友好性。

---

## 三、关键认知修正："一台电脑连 6 台机器人"的正确架构

### 3.1 为什么不能"电脑直连 6 个热点"

每台 FRC 机器人的无线电在"在家模式"下各自发出一个独立热点（SSID 通常与队号相关）。一块普通 WiFi 网卡同一时刻只能加入一个网络。理论上可以给电脑插 6 块 USB WiFi 网卡、每块连一个热点，但这条路的问题很多：

- 6 块网卡的驱动共存、信道干扰（2.4GHz 只有 3 个不重叠信道）、带宽争抢，在 Windows/macOS 上都极其脆弱；
- 6 个独立网络之间没有二层广播，mDNS 发现、DS 协议的组播/定向包都会遇到跨网段问题；
- 任何一块网卡抖动就掉一台机器人，排障噩梦。

**结论：不推荐。** 这也是为什么 FRC 赛场、offseason 赛事和所有多机器人演示都不这么干。

### 3.2 正确做法：所有机器人接入同一个网络（方案 A，推荐）

这是 FRC 生态的标准 offseason 架构，有官方工具直接支持：

1. 在场地边放一台 AP/路由器（普通企业级或赛事级均可），设定一个 SSID + WPA 密码；
2. 把 6 台机器人的无线电逐台配置为"桥接模式"，让它们作为客户端加入这个 SSID（这正是 offseason 赛事给机器人配网的方式）。**具体流程取决于无线电型号，Phase 0 前先盘点硬件（v1.2 修订）**：
   - **旧 OpenMesh OM5P（2016~2024 装机）**：用官方 FRC Radio Configuration Utility 的 **FMS Offseason 模式**刷写。该工具**仅有 Windows 版**——Mac 用户在虚拟机（UTM/VMware Fusion/Parallels，桥接一块 USB 网卡）或借一台 Windows 笔记本来完成，属于一次性配置，日常运行不再需要（注意：该工具与对应 WPILib 文档页已成遗留，2026 赛季仅个别赛区仍用 OpenMesh）；
   - **现役 Vivid-Hosting VH-109（2025+，Wi-Fi 6E）**：配置走**任意操作系统的网页**（radio.local / 192.168.69.1），offseason 场景配套跨平台 Docker 的 Kiosk Programmer + 每队 WPA 密钥 CSV，**全程不需要 Windows**。注意：VH-109 机器人模式的 SSID 由队号派生（FRC-XXYY），"加入任意自选 SSID"的可行性需 Phase 0 实测；真正的多机场地 AP 是 VH-113（VH-109 可刷固件改造，需管理型交换机 + VLAN），"自备路由器 + VH-109 客户端"方案同样需实测验证；
3. 演控电脑也接入此网络（**建议有线连接路由器**，比无线稳得多）；
4. 每台机器人使用**互不相同的队号**（可虚构，如 9001~9006），mDNS 名（roboRIO-900X-FRC.local）天然不冲突——演控软件以 mDNS 寻址为首选、IP 直填为兜底（桥接模式下机器人 IP 通常由机器人侧无线电的 DHCP 保留地址机制落在 10.TE.AM.2，无需手工配置）。

效果：一台电脑、一个网络界面，同时"看见"全部 6 台机器人。**这不改动机器人任何硬件，只是无线电配置方式的变化（刷一次写好即可）。**

### 3.3 变体与备选

| 方案 | 说明 | 评价 |
|------|------|------|
| A. 自带路由器/AP 组网 | 如上所述 | **推荐**。标准做法，成熟稳定 |
| B. 用一台 VH-109 当场地 AP | VH-109 官方支持 AP 模式，但普通 AP 模式面向单机器人家庭练习；多机场地 AP 需刷 VH-113 固件并配管理型交换机 + VLAN | 不加额外设备但配置变重，且"场地网络"绑在一台机器人上，该机器人断电全网瘫痪，仅适合小型演示 |
| C. 电脑 6 网卡直连 6 热点 | 见 3.1 | 不推荐，脆弱且难排障 |
| D. 有线交换机 | 排练/调试阶段用网线 | 强烈建议保留此能力，定位问题、烧录程序时极有用 |
| E. 场馆既有 WiFi | 让机器人桥接到场馆网络 | 不推荐：不可控的干扰、AP 隔离、安全策略都会坑你；表演网络必须自主可控 |

---

## 四、三大需求逐项可行性

### 4.1 多机器人路径规划与可视化 —— 需自研界面，可站在巨人肩膀上

调研确认：**PathPlanner 与 Choreo 都是围绕"单台机器人"设计的**，没有多机器人概念（同一画布上规划多机编队、时间上协同、多机同时仿真预览，均不存在）。这是 FRC 规则使然——比赛 autonomous 阶段只有一台机器人。

但这不代表要从零造轮子。可复用的分层资产：

| 层 | 可复用资产 | 许可证 | 复用方式 |
|----|-----------|--------|---------|
| 轨迹生成与跟随（机器人端） | PathPlannerLib | MIT | 直接在 roboRIO 代码中使用，成熟稳定 |
| 轨迹优化（时间最优） | ChoreoLib | BSD-3 | 同上，与 PathPlannerLib 可互操作 |
| 规划器 GUI 交互范式 | PathPlanner GUI | MIT | 可参考/魔改其交互设计；MIT 允许自由衍生 |
| 数据可视化范式 | AdvantageScope（6328 出品） | BSD-3 | 参考其 3D 场地/里程计显示设计 |
| 场地管理与使能调度 | CheesyArena / CheesyArena Lite | 免费用于练习与 offseason | 可参考其"一台电脑管理 6 台机器人"的完整实现 |

自研部分（即 GHPaths 的核心价值）：**多机器人画布**——每台机器人一个图层/颜色，各自编辑 waypoint 路径，统一时间轴对齐（编队同步、避让），碰撞预警，一键导出各机路径文件部署到各机器人。

### 4.2 实时位置监控 —— 官方协议原生支持，纯软件工作

WPILib 的 **NetworkTables（NT4）** 完美胜任：

- 每台机器人在代码里持续发布自己的位姿估计（`Pose2d`：x, y, 朝向），这是 FRC 机器人的标准操作（odometry）；
- 演控电脑上的自研软件用 **多个 NetworkTableInstance 实例**同时作为 6 台机器人的 NT 客户端——这是官方文档明确支持的能力（每个实例独立连接不同地址）；
- 也可以反过来：演控电脑跑一个中心 NT 服务器，6 台机器人作为客户端连上来（WPILib 同样支持），星型拓扑更适合"总控"场景，还能让任意标准仪表盘工具（Glass、Elastic 等）直接查看聚合数据。

GHPaths 的 UI 在画布上把 6 台机器人的实时位置（含历史轨迹尾巴）与规划路径叠加渲染即可。刷新率 50ms 级别毫无压力（NT4 的设计负载远高于此；NT4 走 WebSocket，服务端口 5810 明文 / 5811 TLS，注意 NT 默认周期性合并小更新，最低延迟需调小 update interval 或显式 flush()）。

**定位精度说明（表演特有）**：轮式 odometry + 陀螺仪会随时间漂移，短节目（几分钟）问题不大；若需要长时间高精度，舞台桁架/背景板贴 AprilTag，机器人加摄像头（PhotonVision + 协处理器）做绝对位姿校正——这是 FRC 现成方案，属于"想加随时能加"的增量项，不影响架构。

### 4.3 一台电脑连接 6 台机器人 —— 网络层可行，使能层是难点

网络层：第三节已解决（一个局域网内同时访问 6 个 IP）。

使能层：见下一节，这是整个项目唯一的"硬骨头"。

---

## 五、核心难点：Driver Station 使能问题

### 5.1 问题本质

roboRIO 的安全模型：**电机输出被 FPGA 门控，只有持续收到 Driver Station 的使能数据包（约 20ms 周期）才保持使能**；DS 停包/断连/按停，机器人立即失效。这本身是极好的表演安全特性，但也意味着：

- 没有任何"绕过 DS"的开关（这是刻意的安全设计）；
- 官方 FRC DS 一台电脑只能运行一个实例（固定端口占用、单队号单机器人模型）；
- 因此"一台电脑一键启动 6 台机器人"无法用官方 DS 直接实现。

### 5.2 解决路径对比

| 路径 | 做法 | 优点 | 缺点 |
|------|------|------|------|
| **① 自研 multi-DS 组件（推荐）** | 在 GHPaths 内实现 FRC DS 通信协议，一个进程内跑 6 个逻辑 DS，分别向 6 台机器人发送使能包 | 真正的一键启动/一键全停/总控集成；无额外硬件 | 需实现 DS 协议（细节以 Phase 0 抓包验证）；锁定 2026 冻结栈后协议不再逐年漂移（见 5.4），仅主动升级镜像时需回归测试 |
| ② 6 台廉价电脑各跑官方 DS | 旧笔记本/迷你主机，一台一机（**注意：官方 DS 仅 Windows，这些小电脑须为 Windows 机器**；第三方跨平台 DS 均不宜作演出依赖——OpenDS 许可证仅限测试用途，Conductor 已归档、QDriverStation 休眠，见 5.3——与其绕道不如直接做 ①） | 零协议风险，全是官方组件 | 6 套设备、"一键启动"变成脚本触发 6 个 DS，丑陋但能用；适合作为 ① 的兜底 |
| ③ CheesyArena Lite + DS 端点 | 开源 FMS 做调度层 | 现成的"管理多台机器人"框架（Go + Web UI，跨平台） | FMS 架构仍是 FMS→DS→机器人，底下还是需要 DS 端点，通常与 ② 搭配；概念上偏比赛而非表演 |

### 5.3 路径 ① 的技术依据（重点）

- **协议是公开且被社区逆向完备的**。开源项目 OpenDS（Java，跨平台）实现了 2014~2016 与 2020~2026 各年代的 DS 协议（源码中存在 `Parser2020to2026` / `Creator2020to2026`，最后提交 2026-03-11，仍在维护）。从其源码可直接读到端口与包结构（2020~2026 协议）：TCP 1740（通信管理）、UDP 1110（DS→机器人控制包）、UDP 1150（机器人→DS 状态）、端口 1735（NT3 时代的 SmartDashboard/Shuffleboard 端口，NT4 仪表盘不用它），源码原文为 `PortQuad(1740, 1110, 1150, 1735)`；FMS 侧通信为 1750/1160/1121（offseason FMS 用 1120 且需操作员确认；FMS 场内 DS→机器人控制包走 UDP 1115）。**引用警示（v1.2）：FIRST 官方 FMS 白皮书/游戏手册的端口表是过时的（写作 UDP 1130/1140，且漏了 1740）——端口与包结构事实以 FRCture 逆向规范（frcture.readthedocs.io）、开源实现源码与实机抓包为准。**
- **注意许可证陷阱**：OpenDS 采用自定义限制性许可证（仅限机器人测试用途、禁止在 FIRST 活动使用），**只能作为协议学习参考，不能抄代码进产品**。自研实现协议（协议事实本身不受版权保护）或参考更宽松的参考来源，是干净的做法。对 AI 工具维护的模式，建议在仓库中明确记录这一约束，避免 AI 直接复制其代码。
- **一台电脑 6 个 DS 的网络基础**：DS 惯例上位于 10.TE.AM.5 地址。给演控电脑的网卡配置 6 个 secondary IP（对应 6 个队号子网），6 个逻辑 DS 各自绑定不同的本地地址与端口，即可在同一进程/同一网卡上与 6 台机器人并行收发。此机制需要在 PoC 阶段用当年 WPILib 镜像实测确认（协议逐年有 byte 级微调，OpenDS 的年代分版解析器正说明了这一点）。
- **退路健在**：即便 ① 在某个赛季协议变化下暂时失效，②（6 台小电脑跑官方 DS）永远可用，表演不至于开天窗。建议把 ② 作为首次演出前的兜底方案同步准备。
- **参考实现盘点（v1.2 修订）**：Rust 库 [ds-rs](https://github.com/first-rust-competition/ds-rs)（crates.io 名为 `ds`）自述即"为不使用官方 Windows DS 的用户提供建造自定义 DS 的手段"，**采用宽松双许可 MIT/Apache-2.0——与 OpenDS 相反，其代码可以合法复用进本项目**；但其协议数据自述只对 2018~2020 机器人校验过，2020 年后无实质维护，复用需对 2026 实机校验。基于它的 [Conductor](https://github.com/Redrield/Conductor)（macOS/Linux DS）**已于 2026-04-24 归档**，作者明言不再推荐使用，仅作历史参考。multi-DS 的协议资料策略：FRCture 规范（干净）+ ds-rs（可复用骨架）+ OpenDS（只读对照）三源交叉，以实机抓包定案。

### 5.4 一个重要的时间线因素：2027 新控制系统（v1.2 依核查修订）

WPILib 于 2026-04-24 公告 **2027 版新 Driver Station**（已发布 alpha，仓库 wpilibsuite/FirstDriverStation-Public，跨平台含 macOS arm64），配合新控制体系 Systemcore。**关键事实（核查确认）：新 DS 只支持 Systemcore，完全不兼容 roboRIO**——roboRIO 车队不是"不被迫迁移"，而是根本用不上它，将继续使用现有 NI DS（官方口径：2026 版之后预计不再更新）。同时 WPILib 已于 **2026-05-02 停止 roboRIO 侧维护**（2027 alpha 不兼容 roboRIO）；FIRST 官宣 2026-27 赛季起启用 Systemcore，roboRIO 的比赛合法性到 2026 赛季为止（社区信源一致，2027 手册待发布最终确认）。对本项目的含义：

- 表演不上场比赛：**锁定 2026 冻结镜像 + 2026 WPILib 栈**，DS 协议与机器人软件栈从此不再逐年漂移——第九节"DS 协议逐年微调"风险据此降级，multi-DS 一次做对可长期稳定服役；
- 冻结的 2026 栈用于练习与展示"无限期可用"（WPILib 维护者口径），现在投入不会作废；
- 若未来采购 Systemcore 新机器人：新 DS 为闭源、架构不同，multi-DS 需要适配甚至重做；
- 建议：multi-DS 组件做成独立模块（独立进程或独立包），与协议细节解耦，未来好替换；机器人端 vendordep 一律钉在 2026 版，升级镜像属于"主动决策 + 回归测试"，不随赛季自动跟进。

---

## 六、推荐总体架构

```
                        ┌─────────────────────────────────────┐
                        │   演控电脑（一台 Mac 即可，见第七节）    │
                        │  ┌───────────────────────────────┐  │
                        │  │  GHPaths 演控软件（自研核心）    │  │
                        │  │  · 多机路径编辑器（画布/时间轴）   │  │
                        │  │  · 实时监控视图（6 机位置叠加）    │  │
                        │  │  · 一键启动 / 一键全停           │  │
                        │  │  · 同步时钟广播（show-time）      │  │
                        │  └──────┬──────────────┬─────────┘  │
                        │     6× NT4 连接     6× 逻辑 DS       │
                        │  （多 NetworkTable  （DS 协议实现，   │  │
                        │     Instance）        绑定 6 个 IP） │  │
                        └─────────┼──────────────┼────────────┘
                                  │              │
                          ┌───────┴──────────────┴───────┐
                          │   场地路由器/AP（有线连演控机）  │
                          └───┬────┬────┬────┬────┬────┬──┘
                              │    │    │    │    │    │   （无线电均为
                         ┌────┴┐┌───┴┐┌──┴─┐┌──┴─┐┌──┴─┐┌─┴──┐ 桥接模式）
                         │R-01 ││R-02││R-03││R-04││R-05││R-06│
                         │roboRIO + WPILib + PPLib/ChoreoLib│
                         │· 订阅 show 命令与同步时钟           │
                         │· 轨迹跟随（全自动驾驶）             │
                         │· 发布实时 Pose（odometry）         │
                         └─────┘└────┘└────┘└────┘└────┘└────┘
```

关键设计决策与理由：

1. **机器人端保持 100% FRC 原生**：roboRIO + WPILib + PathPlannerLib（MIT）做轨迹跟随。机器人代码是标准的 FRC 代码，任何懂 FRC 的人都能维护。
2. **演控软件选 Web 技术栈（TypeScript + React，Tauri/Electron 打包）**：理由——(a) 画布交互、时间轴、多图层渲染正是 Web 前端的主场；(b) AI 工具对 TS/React 的训练语料最丰富、生成质量最高，直接服务你们"AI 维护"的模式；(c) 生态里 2D 画布、动画、状态管理组件极其丰富。**NT4 客户端选型（v1.2 修订）**：官方并无 JS/TS 实现（wpilibsuite/NetworkTablesClients 实际只含一个休眠的 .NET NT3 客户端），采用社区的 [ntcore-ts](https://github.com/cjlawson02/ntcore-ts)（npm `@ntcore-ts/client`，活跃维护、原生支持一个进程连多台机器人、内置 Pose2d 等 struct 类型；当前为 1.0 beta、单人维护）——因此必须自包一层薄 NT 适配接口把依赖隔离在一点，随时可换实现或 fork；NT4 协议有官方规范（WebSocket + JSON 控制帧 + MessagePack 数据帧），自研薄客户端是兜底路径。DS 协议模块用 Node/Rust 实现均可。
3. **同步时钟**：编队表演的隐秘难点是 6 台机器人的时间漂移。设计上由演控软件持续广播"演出时钟"（NT4 或专用 UDP），机器人以演出时钟而非本地时钟驱动轨迹参数，漂移会被持续纠正。这一设计从第一天就要定下来，后补很痛苦。
4. **安全体系**（表演有演员/观众在场，必须当一等公民设计）：
   - DS 协议天然看门狗：演控软件崩溃/断网 → 6 台机器人自动失效，这是免费的安全兜底；
   - GHPaths 的一键全停（软件 e-stop）；
   - 建议配置独立于演控电脑的**物理急停**（如 CheesyArena 兼容的物理 e-stop 按钮接入，或每台机器人随车急停）；
   - 机器人代码内加表演专用限制：最大速度/加速度上限（表演不需要极限性能）、地理围栏（超出舞台边界立即停）；
   - 排练期逐步提速，正式演出前完整带妆联排。
5. **演控机为 Mac 时的适配**（均为软件层面，无硬件障碍）：
   - macOS 15（Sequoia）起引入"本地网络"隐私权限：GHPaths 访问局域网需在 系统设置 → 隐私与安全性 → 本地网络 中授权；提示有时不会自动弹出需手动添加，且系统更新曾反复破坏既有授权——必须列入演出前检查清单。精确语义（TN3179，v1.2 补充）：该权限只管**出站**连接与组播/广播接收，入站监听不受限；从 Terminal/SSH 启动的命令行工具及其子进程**豁免**（排障 workaround）；macOS 15.5+ 可用 `sudo defaults` 设置 AllowedEthernetLocalNetworkAddresses 白名单整个机器人网段；
   - 有线接入需要 USB-C/雷电网口转接器或坞站（建议演控机走有线，见 3.2）；
   - 6 个 secondary IP：`sudo ifconfig en0 alias 10.xx.yy.5 255.255.255.0` 临时添加（重启失效，适合排练），或在系统设置中为同一网卡创建多个网络服务持久化（适合演出）；GHPaths 应内置一键配置脚本。v1.2 补充：6 个队子网互不相同，/24 掩码正确且各自提供路由（同子网 alias 才需 /32 防路由遮蔽）；alias 会随网卡 bounce（WiFi 重连、DHCP 续租）丢失——启动自检必须覆盖；
   - Tauri/React 对 Apple Silicon 原生支持，6×NT4 + 6×DS 心跳的计算负载极低（合计每秒数百个小包），任何现代 Mac 都绰绰有余。

---

## 七、Mac 与 Windows 兼容性分析（2026-08-18 补充）

**先回答"哪些地方只能用 Mac"：调研未发现本架构中存在任何"仅 Mac 可用"的环节。** 不对称性全部是反向的——FRC 工具链里有一批"仅 Windows"的工具（多为 NI 时代遗产），而本项目自研部分天然跨平台。结论：**全 Mac 阵容可行**，只在下述少数一次性环节需要临时借道 Windows。

### 7.1 逐环节兼容性矩阵

| 环节 / 工具 | macOS | Windows | 说明 |
|------------|:-----:|:-------:|------|
| GHPaths 演控软件（自研 TS/React/Tauri） | ✅ | ✅ | 自研即跨平台；Tauri 原生支持 Apple Silicon |
| NT4 多机连接（社区 ntcore-ts；官方无 JS/TS 实现） | ✅ | ✅ | WebSocket 实现，无平台依赖 |
| multi-DS 使能组件（自研） | ✅ | ✅ | 多 IP 绑定两平台均支持（macOS 用 `ifconfig alias`，Windows 用高级 TCP/IP 设置） |
| 路径规划工具 PathPlanner | ✅ | ✅ | 官方提供 macOS `.dmg`（如 `PathPlanner-macOS-v2026.1.2.dmg`） |
| 路径规划工具 Choreo | ✅ | ✅ | 桌面工具为 TypeScript/Rust/C++（Tauri 应用），跨平台分发（v1.2 更正：非 Java；Java/C++/Python 的是机器人侧 ChoreoLib） |
| AdvantageScope 可视化 | ✅ | ✅ | 官方提供 macOS 构建（2026 版已发布） |
| WPILib 机器人代码开发（Java/C++/Python，VS Code + GradleRIO） | ✅ | ✅ | 部署到 roboRIO 在 macOS 上完全支持（LabVIEW 仅 Windows，与本项目无关） |
| roboRIO 烧录/镜像 | ❌ | ✅ | **roboRIO 1 烧录仍必须 NI FRC Game Tools（仅 Windows；截至 2026-08 核查确认，"2025 起跨平台化"系误传）**。roboRIO 2.0 可 microSD 写卡（2022 年起支持，写卡工具跨平台），但镜像文件的获取渠道仍经由 Windows 上的 Game Tools 安装 |
| roboRIO Web 看板 / 队号等配置 | ✅ | ✅ | 浏览器操作，无平台依赖 |
| PhotonVision 视觉（可选的 AprilTag 定位） | ✅ | ✅ | 视觉服务跑在机器人侧的协处理器（树莓派等）上，配置界面为网页，与演控机 OS 无关 |
| CheesyArena Lite（开源 FMS，如采用） | ✅ | ✅ | Go 编译单文件，官方提供 macOS x64 与 Apple Silicon 构建 |
| 第三方跨平台 DS（OpenDS，调试参考用） | ✅ | ✅ | OpenDS 支持 Apple Silicon（许可证：仅测试用途、禁止 FIRST 活动）。Conductor 已于 2026-04 归档、QDriverStation 自 2021 年休眠且不支持 2020+ 机器人——两者移出可用清单（LibDS 源码仍可作协议学习材料） |
| **无线电刷写——OpenMesh OM5P（遗留工具链）** | ❌ | ✅ | FRC Radio Configuration Utility **仅 Windows**，且已成遗留工具（仅当机器人装 OM5P 时才需要）。Mac 解法：Windows 虚拟机（UTM 免费，桥接 USB 网卡直通）或借机；该工具会强改网卡设置，在 VM 里做可避免污染本机网络。**频率：一次性** |
| **无线电配置——VH-109（现役）** | ✅ | ✅ | **任意 OS 网页配置（radio.local / 192.168.69.1）+ 跨平台 Docker Kiosk Programmer，全程不需要 Windows**——机器人若是 VH-109，本项从 Windows 清单中消失 |
| **官方 FRC Driver Station** | ❌ | ✅ | **仅 Windows**（NI FRC Game Tools 体系，2026 赛季及之前）。对本项目影响很小：全自动驾驶方案本就不依赖官方 DS；仅兜底方案 ② 的 6 台小电脑需选 Windows 迷你机。社区有在 Apple Silicon 上用 Whisky（Wine）跑通 2026 DS 的非官方先例，仅作应急参考。**2027 起官方新 DS 支持 macOS——但仅限 Systemcore 新控制体系，不兼容 roboRIO**（roboRIO 永远停在现有 Windows DS） |

### 7.2 需要 Windows 的完整清单（v1.2 依核查修订）

1. **roboRIO 初始烧录 / 重刷镜像**——NI FRC Game Tools 仅 Windows。机器人若已预装 2026 镜像则日常无感，仅在重刷时借道（虚拟机或借机）。
2. **无线电刷写（仅当机器人装 OpenMesh OM5P）**——遗留 Windows 工具，一次性，10 分钟/台。若为 VH-109 则全程 Mac 网页/Docker 完成，本项不存在。
3. **兜底方案 ② 的 6 台 DS 小电脑**（若将来采用）——届时直接选购 Windows 迷你主机。

除以上环节外，**开发、排练、演出、监控、维护的日常全流程均可在 Mac 上完成**。Phase 0 的硬件盘点（无线电型号、镜像版本）将最终确定本清单的实际长度。

### 7.3 macOS 特有注意事项

1. **本地网络隐私权限（macOS 15+）**：如第六节所述，列入演出前检查清单；若 GHPaths 联不上机器人，第一时间查这里。
2. **防火墙提示**：首次运行 GHPaths（含其 multi-DS 的 UDP 端口监听）会触发"是否允许接受传入网络连接"提示，选"允许"。
3. **多 IP 管理**：排练用 `ifconfig alias`（临时、免持久化），演出用系统设置持久化配置；GHPaths 内置一键脚本 + 自检（启动时检测 6 个本地 IP 是否就绪）。
4. **系统更新纪律**：演出周冻结 macOS 更新（历史上出现过更新重置本地网络授权、更改网络行为的情况）。

### 7.4 对选型的结论

推荐组合：**Mac 做演控与开发主力（唯一日常设备）+ 一个随手可得的 Windows 环境（虚拟机或借机）处理 roboRIO 烧录与（仅 OM5P 机型才涉及的）无线电刷写**。若组织内完全没有 Windows 资源，无线电刷写也可委托任何 FRC 战队/赛场朋友代刷（配置文件可控、结果可验证）。

---

## 八、替代与降级方案（若 FRC 原生路线受阻）

| 场景 | 替代方案 | 代价 |
|------|---------|------|
| multi-DS 协议实现受阻 | 6 台廉价迷你电脑跑官方 DS，GHPaths 退化为"监控+文件部署"角色 | 约 6×几百元的硬件；一键启动体验降级 |
| 不想自研调度层 | CheesyArena Lite（开源 FMS）承担使能调度 | 概念偏比赛；需配 DS 端点；Web UI 可嵌入 |
| WiFi 环场干扰严重 | 5GHz 信道规划 + 有线骨干（机器人侧仍无线）；或缩小规模 | 布线工作量 |
| 未来控制系统换代 | roboRIO→Systemcore 迁移（新 DS 闭源、不兼容 roboRIO，multi-DS 需适配重做） | 采购新主控；架构适配；multi-DS 已模块化隔离 |
| 完全离开 FRC 体系 | ROS2 多机编排（Nav2 + 集群）| 抛弃 FRC 生态全部积累，学习/维护成本剧增，**不推荐**——仅在机器人本身不再是 FRC 底盘时考虑 |

---

## 九、风险清单

| 风险 | 等级 | 缓解 |
|------|------|------|
| DS 协议逐年微调导致 multi-DS 失效 | 低（v1.2 降级） | 锁定 2026 冻结栈后协议不再漂移（WPILib 已停止 roboRIO 维护）；回归测试仅在主动升级镜像时进行；保留 6-DS-小电脑兜底 |
| 舞台 WiFi 干扰（人群、灯光设备、直播设备） | 中 | 5GHz + 信道现场勘测；演控机有线接入；演出前现场压力测试 |
| odometry 漂移累积导致队形走样 | 中 | 节目分段+标记点重置；或加 AprilTag 绝对定位 |
| 多机同场碰撞 | 高（安全） | 软件层：路径编辑器碰撞检测+地理围栏；物理层：限速、缓冲、专职观察员、物理急停 |
| 自研 GUI 工程量超预期 | 中 | 严格分阶段（见路线图）；Phase 2 前不碰路径编辑器，先用成熟工具顶替 |
| 2027 控制系统换代冲击 | 低（冻结栈不受影响） | multi-DS 独立模块化解耦；机器人栈钉在 2026；新采购机器人时再评估 Systemcore 路线 |
| macOS 更新重置本地网络权限 / 更改网络行为 | 低 | 演出周冻结系统更新；演出前检查清单含"本地网络"授权项；GHPaths 启动自检 |
| 无线电刷写依赖 Windows 环境（仅 OpenMesh OM5P 机型；VH-109 走网页 + Docker 全程 Mac） | 低 | Phase 0 盘点无线电型号；仅 OM5P 才需常备 UTM 虚拟机镜像或记录可借用的 Windows 机器 |

---

## 十、分阶段路线图

**Phase 0 —— 单机链路验证（约 1~2 周）**
**前置（半天）——硬件盘点**：确认每台机器人的无线电型号（OpenMesh OM5P / VH-109）与 roboRIO 镜像版本，据此确定组网与刷写路径（见 7.2）。然后：一台机器人按对应流程入网（OM5P 需临时借道 Windows；VH-109 全程 Mac）+ 场地路由器 + 演控 Mac。验证：NT4 读写、DS 协议使能/失效/急停（对照 OpenDS 运行抓包；协议笔记见仓库 docs/protocol/）、macOS 本地网络授权与多 IP 配置流程。这是整个项目风险最高的未知数，最先消灭。

**Phase 1 —— 双机组网 PoC（约 2~4 周）**
两台机器人同网。验证：6 IP 网卡配置法、双逻辑 DS 并行使能、同步时钟精度、同时启停。

**Phase 2 —— 演控 MVP（约 1~2 月）**
GHPaths 雏形：6 机 NT 聚合、实时位置画布、一键启动/全停、基本日志。此阶段路径仍用 PathPlanner 等现成工具制作、手动部署——先让"演出能力"成立。

**Phase 3 —— 多机路径编辑器（约 2~3 月）**
多图层画布、统一时间轴、碰撞检测、仿真预演、一键部署到各机。

**Phase 4 —— 全编制联排（按演出排期）**
6 台全编制、安全体系完备、现场压力测试、带妆联排。

> 工期为数量级估计，AI 辅助开发可显著压缩，但 Phase 0/1 的实机验证环节无法省略。

---

## 十一、结论

- **能不能做？** 能。网络与监控是成熟路径，使能控制有明确的攻坚方案与兜底。
- **Mac 能不能当主力？** 能，且很合适：除"roboRIO 烧录"与（仅 OM5P 机型才有的）"无线电刷写"等一次性环节外，全流程 Mac 原生完成；自研部分（TS/React/Tauri + NT4 + multi-DS）本就跨平台，Mac 与 Windows 只是部署选项之争，不影响架构。
- **要不要改机器人硬件？** 不用。唯一的"改动"是无线电配置刷写（软件性质，可逆）。
- **最大的坑在哪？** DS 协议实现（有参考、可验证、有兜底）与舞台安全体系（靠设计与流程）。
- **最应该立刻做什么？** Phase 0：找一台机器人把"桥接模式 + 自研 DS 使能"链路打通。一天之内就能知道最难的那块骨头有多硬。

---

## 参考资料

- [Operating two Robots Simultaneously — Chief Delphi](https://www.chiefdelphi.com/t/operating-two-robots-simultaneously/144583)
- [Networking Basics — WPILib Documentation](https://docs.wpilib.org/en/stable/docs/networking/networking-introduction/networking-basics.html)
- [Programming Your Radio At Home — FIRST FRC Radio (Vivid-Hosting)](https://frc-radio.vivid-hosting.net/overview/programming-your-radio-at-home)
- [Setting VH-109 To Access Point Mode — FIRST FRC Radio](https://frc-radio.vivid-hosting.net/access-points/setting-vh-109-to-access-point-mode)
- [Programming Radios for FMS Offseason — WPILib（OpenMesh 时代流程，页面已下线；2024 版存档可参考）](https://docs.wpilib.org/en/2024/docs/software/driverstation/programming-radios-for-fms-offseason.html)
- [Offseason Kiosk Programmer（VH-109 时代 offseason 配网）— Vivid-Hosting](https://frc-radio.vivid-hosting.net/advanced-topics/offseason-kiosk-programmer.html)
- [FRCture — FRC DS 协议逆向规范（端口与包结构的一手参考）](https://frcture.readthedocs.io/)
- [Creating multiple instances of NetworkTables — WPILib](https://docs.wpilib.org/en/2022/docs/software/networktables/multiple-instances.html)
- [OpenDS（开源 DS 替代品，协议实现参考）— GitHub](https://github.com/Boomaa23/open-ds) ／ [发布公告 — Chief Delphi](https://www.chiefdelphi.com/t/introducing-opends-a-lightweight-cross-platform-frc-driver-station-alternative/395317)
- [QDriverStation — FRC-Utilities](https://frc-utilities.github.io/)（2021 年起休眠、不支持 2020+ 机器人，仅历史参考）
- [CheesyArena — Team 254 GitHub](https://github.com/team254/cheesy-arena) ／ [Cheesy Arena Lite](https://github.com/Team254/cheesy-arena-lite)
- [PathPlanner — GitHub（MIT）](https://github.com/mjansen4857/pathplanner) ／ [PathPlannerLib 与 Choreo 互操作](https://pathplanner.dev/pplib-choreo-interop.html)
- [Choreo — SleipnirGroup GitHub（BSD）](https://github.com/SleipnirGroup/Choreo) ／ [choreo.autos](https://choreo.autos/)
- [Choreo vs PathPlanner — Chief Delphi](https://www.chiefdelphi.com/t/choreo-vs-pathplanner/467373)
- [AdvantageScope Live Sources 文档](https://docs.advantagescope.org/overview/live-sources/) ／ [3D Field](https://docs.advantagescope.org/tab-reference/3d-field/)
- [NetworkTablesClients（wpilibsuite；实况：仅含休眠的 .NET NT3 客户端，官方无 JS/TS 实现）— GitHub](https://github.com/wpilibsuite/NetworkTablesClients) ／ [ntcore-ts（社区 TS 客户端，本项目采用）](https://github.com/cjlawson02/ntcore-ts)
- [The 2027 FIRST Driver Station — WPILib Blog（2026-04-24）](https://wp.wpi.edu/wpilib/2026/04/24/the-2027-first-driver-station/)
- [FRC Radio Configuration Utility 下载 — FIRST TeamForge](https://usfirst.collab.net/sf/frs/do/listReleases/projects.wpilib/frs.frc_radio_configuration_utility)

- [FRC Game Tools（含官方 DS，仅 Windows）— NI 下载页](https://www.ni.com/en/support/downloads/drivers/download.frc-game-tools.html)
- [FRC Driver Station on macOS（Whisky 非官方方案）— Chief Delphi](https://www.chiefdelphi.com/t/frc-driver-station-on-macos/513948)
- [ds-rs（Rust 自建 DS 库，MIT/Apache-2.0 双许可可复用；协议数据停在 2018-2020）— GitHub](https://github.com/first-rust-competition/ds-rs) ／ [Conductor（macOS/Linux DS，2026-04 已归档）— GitHub](https://github.com/Redrield/Conductor)
- [Imaging your roboRIO 2 — WPILib](https://docs.wpilib.org/en/stable/docs/zero-to-robot/step-3/roborio2-imaging.html)（microSD 烧录流程，2022 年起；镜像文件获取仍需 Windows Game Tools）
- [PathPlanner Releases（含 macOS dmg）— GitHub](https://github.com/mjansen4857/pathplanner/releases)
- [AdvantageScope 安装文档](https://docs.advantagescope.org/overview/installation/)
- [Local network privacy on macOS（技术分析）— The Eclectic Light Company](https://eclecticlight.co/2026/01/18/last-week-on-my-mac-local-network-privacy-revealed/)
- [macOS 添加副 IP 的方法（ifconfig alias）— Apple 社区讨论](https://discussions.apple.com/thread/2706919)

---

*本报告基于 2026-08-18 的公开资料调研，并经同日独立核查修订为 v1.2（核查记录见《GHPaths_可行性研究报告_核查勘误_2026-08-18.md》）。DS 协议细节（端口、包结构）以 Phase 0 实测与 2026 WPILib 镜像为准。*
