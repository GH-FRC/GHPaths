#!/usr/bin/env node
/**
 * prepare-sidecars —— Tauri 构建前准备 sidecar 产物：
 *   1. esbuild 把 sim / multi-DS 入口打成单文件 CJS（含 workspace 源码依赖）；
 *   2. 复制当前 Node 运行时二进制；
 *   3. 全部按 Tauri externalBin 约定命名（-aarch64-apple-darwin 后缀，Tauri 打包时去后缀收进 .app）。
 *
 * 产物目录 src-tauri/binaries/ 已 gitignore（二进制不入库）。
 * 用法：node scripts/prepare-sidecars.mjs   （tauri.conf 的 beforeDev/beforeBuild 自动调用）
 */
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  console.error('prepare-sidecars 目前仅支持 macOS（ADR-0007：Mac 优先;Linux/Windows triple 未映射）');
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'apps/console/src-tauri/binaries');
// Tauri/Rust target triple：node 的 arm64 在 Rust 里叫 aarch64；darwin → apple-darwin
const rustArch = process.arch === 'arm64' ? 'aarch64' : process.arch;
const tauriTriple = process.platform === 'darwin' ? `${rustArch}-apple-darwin` : `${rustArch}-${process.platform}`;

mkdirSync(outDir, { recursive: true });

const entries = [
  // .cjs 后缀：CJS 语义不受目录内 package.json 的 type:module 影响（repo 内与分发后一致）
  { src: 'sim/fake-robot/src/main.ts', name: 'ghpaths-sim.cjs' },
  { src: 'packages/multi-ds/src/main.ts', name: 'ghpaths-multids.cjs' },
];

for (const e of entries) {
  const outfile = join(outDir, `${e.name}-${tauriTriple}`);
  execSync(
    `npx esbuild ${join(root, e.src)} --bundle --platform=node --format=cjs ` +
      `--outfile=${outfile}`,
    { stdio: 'inherit', cwd: root },
  );
  console.log(`bundled ${e.name} → ${outfile}`);
}

// Node 运行时（process.execPath 即当前 node 二进制）
const nodeOut = join(outDir, `node-${tauriTriple}`);
cpSync(process.execPath, nodeOut);
console.log(`copied node runtime → ${nodeOut}（${process.version}）`);
