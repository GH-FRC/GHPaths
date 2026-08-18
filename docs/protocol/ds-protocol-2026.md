# FRC DS 协议笔记（2026，净室参考）

> 用途：multi-DS 实现的仓库内唯一事实来源。
> 状态分两类：**已核查**（2026-08-18 对一手来源核验）与**待实测**（Phase 0 抓包定案）。
> 资料红线见 CLAUDE.md：OpenDS 代码禁止复制（只读对照）；FIRST 官方白皮书端口表过时，不可引用。

## 已核查事实（可放心作为设计输入）

| 项 | 值 | 依据 |
|---|---|---|
| DS→roboRIO 控制包 | **UDP 1110**，约 **20ms** 周期（50Hz） | FRCture ds_to_rio；LibDS `frc_2015.c`（robot_interval=20） |
| roboRIO→DS 状态包 | **UDP 1150**，20ms，随控制包响应 | FRCture rio_to_ds |
| 连接管理 | **TCP 1740**（roboRIO 主动连 DS；标签化数据：摇杆描述/比赛信息/控制台输出） | FRCture |
| **控制包布局（已实现）** | 6 字节无标签头部：seq u16 ‖ commVer 0x01 ‖ control 位域（eStop 0x80/FMS 0x08/enabled 0x04/mode 0x03，2=Autonomous）‖ request 位域（reboot 0x08/restartCode 0x04）‖ alliance u8。标签区（摇杆/倒计时/日期）使能不需要 | FRCture ds_to_rio；实现 `packages/multi-ds/src/packet.ts` |
| **状态包布局（已实现）** | 8 字节头部：seq u16 ‖ commVer ‖ status 位域（eStop 0x80/brownout 0x10/codeStart 0x08/enabled 0x04/mode 0x03）‖ trace 位域（robotCode 0x20/isRoboRIO 0x10/disabled 0x01）‖ battery u16（XX+YY/256 伏）‖ requestDate u8 | FRCture rio_to_ds；实现同上 |
| 使能语义 | 失去 DS 包 → **NI NetComm 层看门狗切断输出**（用户代码不可绕过），量级数百 ms；sim 端点按 500ms 看门狗模拟 | FMS 白皮书 + WPILib 开发者（Chief Delphi） |
| estop 语义 | 控制包 eStop 位；真机闩锁至重启用户代码——sim 端点以 restartCode 请求位解除闩锁同构模拟 | FRCture |
| 官方 DS 单实例原因 | 固定本地端口 + 单队号模型（技术约束，非政策条文） | 核查 2026-08-18 |
| FMS 侧（备查，本项目不用） | DS→FMS UDP 1160（本地端口 1145）、TCP 1750；FMS→DS UDP 1121（正式赛）/ 1120（offseason，需操作员确认）；FMS 场内 DS→roboRIO 走 UDP 1115 | FRCture |
| 1735 端口 | NT3 时代 SmartDashboard 遗产，NT4 不用，本项目忽略 | FIRST 文档 |
| DS 惯例地址 | 演控机位于 **10.TE.AM.5**（子网掩码 255.0.0.0 或 /24 + 网关） | WPILib IP Configurations |

## 待实测定案（Phase 0，按优先级）

1. **实机抓包对照**：已实现布局对 2026 镜像实机验证（sim 回路四关已过：建链/使能/看门狗 512ms/estop 闩锁）；
2. **TCP 1740 标签清单与交互时序**（机器人连入后先发什么、DS 回什么；使能是否依赖 TCP 建立——sim 未实现 TCP，机器人仅凭 UDP 控制包使能）；
3. **roboRIO 对 DS 地址的认定**：状态包发往何处、是否校验来源必须是 10.TE.AM.5——直接决定 6 个 secondary IP alias 方案的实现细节；
4. 2026 镜像相对 FRCture 记载的差异点（若有）。注意：WPILib 已冻结 roboRIO 维护（2026-05），协议此后不再漂移（ADR-0004）。

## 抓包与验证方法

- 借一台 Windows（或队里的 DS 电脑）跑官方 DS 与单台机器人同网对话，tcpdump/Wireshark 存 pcap；
- OpenDS 是可运行的第三方 DS（测试用途合法），可作为行为对照；
- sim/fake-robot 的 DS 端点先按本笔记实现，multi-DS 与 sim 对通后再上实机；
- **验收标准**：multi-DS 使能 → 机器人动；kill multi-DS → 机器人 ~1s 内失效；estop → 立即失效且需显式恢复。

## 净室纪律

实现代码只允许来自：本笔记（事实）、FRCture（协议事实，不受版权保护）、ds-rs（宽松许可）。
任何 OpenDS / LibDS 源码片段进入本仓库都是违规——包括"翻译式"改写。
