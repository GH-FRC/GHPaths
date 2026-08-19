# ADR-0007：macOS 免费分发——浏览器下载为主 + 终端/Homebrew 并行 + 应用内更新

日期：2026-08-19 · 状态：已接受（v2，同日修订——初版决策"购买 Apple Developer Program 做签名+公证"经用户定稿改为完全免费，修订历史见文末）

## 背景

用户期望：下载 .dmg → 双击 → 拖进 Applications 即用，不出"危害性文件"警告、不去终端、尽量不去设置。2026-08-19 一手核查（报告 §7.5）：

- **AdvantageScope**：CI 加载 Developer ID 证书 + 公证凭据，零警告安装——三参照中唯一达标；**PathPlanner**：CI 无签名步骤；**Choreo**：维护者自述"让 Tauri 跳过签名"（issue #428）。零警告安装的唯一正规路径 = Apple Developer Program（$99/年）+ notarytool 公证。
- **macOS 15（Sequoia）起移除"右键→打开"绕过**：未公证 app 首次打开须进 设置 → 隐私与安全性 → "仍要打开"（+密码）；Gatekeeper 只拦截带隔离属性的文件，而隔离属性由浏览器下载打上（curl/应用内下载/拷贝无此属性）。
- **用户定稿（2026-08-19）四条**：① 完全免费，一分不付；② 不走学校教育机构费用减免认证；③ 主渠道 = 浏览器直接下载安装包安装；④ 终端 / Homebrew 安装保留为并行渠道，releases 页面同时包含安装包与安装教程。

## 决策

1. **免费分发，不购开发者账号**（$99/年与教育减免均已排除；未来如需对外大规模零警告分发再重启评估，仅记录）。
2. **主渠道：GitHub Releases 浏览器下载 .dmg**。接受每台 Mac 首装一次性"仍要打开"仪式（约 30 秒、无终端）；dmg 背景图、release 说明、下载页三处放同款三步图文引导（中文，含"仍要打开"在设置中的位置截图）。
3. **升级默认走应用内更新（Tauri updater）**：应用进程下载的文件无隔离属性、不触发 Gatekeeper——只有首装需要批准，后续版本升级零弹窗。〔打包后实测确认〕
4. **并行渠道（零弹窗，面向内部与高级用户）**：一行终端安装脚本（curl 下载）与 Homebrew（自维护 tap 的 cask，如 `brew tap GH-FRC/ghpaths && brew install --cask ghpaths`）。
5. **Releases 页面规范（用户要求，列入发版 checklist）**：每个 release 固定包含——① 安装包（dmg 等）；② 浏览器安装图文教程（含"仍要打开"三步引导）；③ 终端与 Homebrew 安装命令。做成 release 模板。
6. **工程红线**：保留 ad-hoc 签名（Tauri 默认；禁止构建配置剥离——签名损坏会把"仍要打开"变成"已损坏"死胡同，只剩 xattr 终端一条路）；multi-DS 等子进程作为 sidecar 收进 .app（bundle 签名整体覆盖，子进程不单独触发 Gatekeeper）；Info.plist 声明 `NSLocalNetworkUsageDescription`（本地网络弹窗为应用内对话框，点"允许"即完成；误拒才需进设置，首启向导引导）。

## 后果

- 首装体验 = PathPlanner/Choreo 同款，但经引导 + 应用内更新优化为"每台机器终身一次"；
- 浏览器手动重下载新版本仍触发一次批准（文档引导用户走应用内更新）；
- 打包后实测清单：① dmg 在全新 macOS 双击 → 走"仍要打开"流程（而非"已损坏"）；② Tauri updater 升级后零 Gatekeeper 弹窗；③ sidecar 子进程的本地网络权限按责任进程归属父 app（一次弹窗覆盖主进程 + multi-DS；异常则 DS socket 移入主进程）；④ Homebrew tap 安装零弹窗；
- Windows 侧（SmartScreen）同类问题另行决策，Mac 优先按本 ADR 执行。

## 修订历史

- **v1（2026-08-19 上午）**：决策购买 Apple Developer Program（$99/年）+ Developer ID 签名 + notarytool 公证，对标 AdvantageScope 零警告体验。
- **v2（2026-08-19，用户定稿）**：完全免费；浏览器下载为主渠道；终端/Homebrew 并行；应用内更新免版本级再批准；releases 页含安装包与三渠道教程。v1 作废，保留于此仅作决策史（本 ADR 尚未合入 main，就地修订）。
