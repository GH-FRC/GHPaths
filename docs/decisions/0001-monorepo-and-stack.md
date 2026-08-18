# ADR-0001：monorepo 与技术栈

日期：2026-08-18 · 状态：已接受

## 背景

报告 §六.2：开发维护以 AI 工具为主力，技术选型须考虑 AI 可维护性（训练语料充足、生成质量高）。

## 决策

- **npm workspaces 单仓多包**：node 25 / npm 自带，零额外工具链；后续如需可无痛迁 pnpm；
- **TypeScript 严格模式**全仓统一；包间以源码直引（`main: src/index.ts`），不设独立构建产物——仓库内部消费，出现发布需求时再补；
- **UI：Vite + React 18**；Tauri 壳推迟到打包阶段——UI 先按纯 Web 开发，multi-DS 独立进程天然规避浏览器没有原生 UDP 的限制，打包时再决定 Tauri sidecar 还是本地进程拉起；
- 机器人代码同仓（`robot/`，Phase 0 用 WPILib 模板生成），vendordep 钉 2026（ADR-0004）。

## 后果

- 一次 clone 全景；类型跨端流通（show-protocol 是协议的单一类型来源）；
- 代价：包直引源码要求消费端都走 bundler/tsc（现状满足）；React 19 等大版本升级须评估后再动。
