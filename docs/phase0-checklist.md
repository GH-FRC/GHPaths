# Phase 0 清单：单机链路验证（报告 §十）

**前置：硬件盘点（半天）**——这是当前最高优先行动项，决定组网方案与 Windows 依赖面。

## 1. 硬件盘点

- [ ] 每台机器人：无线电型号（OpenMesh OM5P / Vivid-Hosting VH-109 / 其他）
- [ ] 每台机器人：roboRIO 型号（1 / 2.0）与镜像版本（目标：2026）
- [ ] 队号分配表（虚构 9001~9006）与机架颜色/图层映射
- [ ] 演控 Mac：macOS 版本、有线网口（USB-C/雷电线或坞站）、本地网络权限预授权

## 2. 组网

- [ ] 场地路由器/AP 上电；SSID + WPA 规划；5GHz 信道勘测（现场干扰）
- [ ] 单台机器人入网（按无线电型号选流程，报告 §3.2 v1.2：OM5P 走遗留 Windows 工具，VH-109 走网页/Docker）
- [ ] 演控机有线接入路由器；`ping roboRIO-XXXX-FRC.local` 通

## 3. macOS 准备

- [ ] 系统设置 → 隐私与安全性 → 本地网络：授权（或 macOS 15.5+ 用子网白名单）
- [ ] `sudo ./scripts/setup-aliases.sh add`（先加 1 个队号验证，再上 6 个）
- [ ] 防火墙若开启：允许 GHPaths 相关进程入站

## 4. NT4 验证

- [ ] AdvantageScope 连上机器人，确认 odometry/pose 可见
- [ ] nt-link 原型连通：收 pose、发命令回环（struct 编码在此定案）

## 5. DS 协议验证（multi-DS 的实机初验）

- [ ] 抓包：官方 DS（或 OpenDS）与机器人对话，pcap 存档进 `docs/protocol/`
- [ ] 按 `docs/protocol/ds-protocol-2026.md` 待实测清单逐项定案
- [ ] multi-DS 最小实现三态通过：使能 / 停包失效 / estop
- [ ] 验收：`kill -9` multi-DS 进程 → 机器人 ~1s 内失效

## 退出标准

以上全绿 → 进入 Phase 1（双机 PoC：双逻辑 DS 并行、同步时钟精度、同时启停）。
