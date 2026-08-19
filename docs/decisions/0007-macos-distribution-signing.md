# ADR-0007：macOS 分发采用 Developer ID 签名 + 公证，对标 AdvantageScope 安装体验

日期：2026-08-19 · 状态：已接受（Apple Developer Program 采购为待办）

## 背景

用户要求安装体验对标 PathPlanner / AdvantageScope / Choreo：双击 .dmg 即装即用，不出"危害性文件"警告，不去终端、尽量不去设置。2026-08-19 一手核查（报告 §7.5）：

- **AdvantageScope**：CI 加载 Developer ID 证书 + 公证凭据（build.yml 中 CSC_LINK / APPLE_ID 系列），零警告安装——三参照中唯一达标者；
- **PathPlanner**：CI 无任何签名/公证步骤（pathplanner-ci.yaml 仅 flutter build + create-dmg）——未签名，首次打开被 Gatekeeper 拦；
- **Choreo**：维护者自述"让 Tauri 跳过签名"（issue #428），同样被拦；
- **macOS 15（Sequoia）已移除"右键→打开"绕过**：未公证 app 必须进 系统设置 → 隐私与安全性 → "仍要打开"——恰是用户要避免的体验；演出装机环境（他人 Mac、技术员操作）不可控。

## 决策

1. **加入 Apple Developer Program（$99/年，个人账号起步即可）**，取得 Developer ID Application 证书；对外发版的 .dmg 一律签名 + 公证（notarytool），进 GitHub Actions（凭据入 secrets）。Tauri v2 原生支持（构建签名参数 + CI 公证），无额外工具链。
2. **打包形态**：.dmg（arm64 优先，或 universal）；multi-DS 等一切子进程作为 sidecar 收进 .app bundle（bundle 签名整体覆盖，子进程不单独触发 Gatekeeper）。
3. **Info.plist 必备键**：`NSLocalNetworkUsageDescription`（本地网络权限弹窗的说明文案；若做 Bonjour 服务浏览另加 `NSBonjourServices`）。首启向导引导用户点"允许"——本地网络弹窗是应用内对话框（macOS 15+ 无法消除，AdvantageScope 也弹），点一下即完成、无需进设置；误拒才需要去设置开。
4. **明确不接受的路径**：ad-hoc 签名 / 要求用户 xattr 去隔离 / "设置里仍要打开"作为常态流程（仅作为采购/公证完成前的临时装机 SOP）。

## 后果

- 采购账号前，对他人装机用临时 SOP：系统设置 → 隐私与安全性 → 仍要打开（每机一次性），并口头说明原因；
- 打包后实测项：① 公证后的 dmg 在全新 macOS 上双击零警告；② sidecar 子进程的本地网络权限按责任进程归属父 app（一次弹窗覆盖主进程 + multi-DS）；若实测异常，将 DS socket 移入主进程；
- 首次发版里程碑（Tauri 打包阶段）包含本 ADR 的签名/公证/首启引导三件事，缺一不发；
- Windows 侧（SmartScreen）属同类问题，Mac 优先按本 ADR 执行，Windows 分发策略另行决策。
