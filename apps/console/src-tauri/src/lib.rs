use tauri::{AppHandle, Manager};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

/// sidecar 后端（sim / multi-DS）的进程管理。
///
/// 形态（ADR-0007 v2 决策 6）：Node 运行时 + esbuild 单体脚本经 externalBin 收进 .app，
/// bundle 签名整体覆盖（子进程不单独触发 Gatekeeper）。
/// 运行时布局：与主程序同目录（prod=Contents/MacOS，dev=target/{debug,release}），
/// Tauri 打包时去掉 target triple 后缀（产物名见 SIDEKICKS 表）。
///
/// 停止语义（审查修正）：TERM → 有界等待（≤1.5s，让 multi-DS 走优雅关停：
/// 全部 disable 后退出）→ 超时 SIGKILL 兜底 → wait() 收尸（不留僵尸）。
struct ManagedProcess {
    child: Child,
    started: Instant,
}

/// sidecar 名 → 打包后的（去 triple 后缀的）脚本文件名
const SIDEKICKS: &[(&str, &str)] = &[
    ("sim", "ghpaths-sim.cjs"),
    ("multids", "ghpaths-multids.cjs"),
];

type ProcMap = std::sync::Mutex<HashMap<String, ManagedProcess>>;

/// 锁获取（中毒恢复：锁内代码无 panic 路径,中毒只意味着前任持有者异常退出——
/// 恢复数据继续,不 panic 带崩主线程）
fn lock_map(map: &std::sync::Mutex<HashMap<String, ManagedProcess>>) -> std::sync::MutexGuard<'_, HashMap<String, ManagedProcess>> {
    match map.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    }
}

fn binaries_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(exe.parent().ok_or("无父目录")?.to_path_buf())
}

fn spawn_backend(app: &AppHandle, which: &str) -> Result<(), String> {
    let procs = app.state::<ProcMap>();
    let (_, bundle_name) = SIDEKICKS
        .iter()
        .find(|(k, _)| *k == which)
        .ok_or_else(|| format!("未知后端 {which}"))?;

    let dir = binaries_dir()?;
    let node = dir.join("node");
    let script = dir.join(bundle_name);
    if !node.exists() {
        return Err(format!(
            "未找到 sidecar 运行时 {}（先跑 scripts/prepare-sidecars.mjs）",
            node.display()
        ));
    }
    if !script.exists() {
        return Err(format!("未找到 sidecar 脚本 {}", script.display()));
    }

    // 日志重定向到临时目录（GUI 进程无终端）
    let log_dir = std::env::temp_dir().join("ghpaths");
    let _ = std::fs::create_dir_all(&log_dir);
    let log_file = std::fs::File::create(log_dir.join(format!("{which}.log")))
        .map_err(|e| format!("日志文件创建失败: {e}"))?;
    let log_err = log_file
        .try_clone()
        .map_err(|e| format!("日志文件复制失败: {e}"))?;

    let mut map = lock_map(&procs);
    // 幂等：已在运行 → Ok（前端首启自启的 StrictMode 双调用与手快双击都不再报错）
    if let Some(p) = map.get_mut(which) {
        if matches!(p.child.try_wait(), Ok(None)) {
            return Ok(());
        }
    }
    // 单次持锁完成 检查→spawn→insert（防并发同名双 spawn 竞态）
    let child = Command::new(&node)
        .arg(&script)
        .current_dir(&dir)
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_err))
        .spawn()
        .map_err(|e| format!("启动 {which} 失败: {e}"))?;
    map.insert(
        which.to_string(),
        ManagedProcess { child, started: Instant::now() },
    );
    Ok(())
}

/// 优雅停止：TERM → ≤1.5s 等退出 → KILL 兜底 → wait() 收尸。幂等：不在运行 → Ok。
fn stop_backend(app: &AppHandle, which: &str) -> Result<(), String> {
    let procs = app.state::<ProcMap>();
    let mut map = lock_map(&procs);
    let Some(mut p) = map.remove(which) else {
        return Ok(()); // 幂等：未在运行不报错
    };
    if matches!(p.child.try_wait(), Ok(Some(_))) {
        return Ok(()); // 已自行退出
    }
    terminate_gracefully(&mut p.child);
    Ok(())
}

fn terminate_gracefully(child: &mut Child) {
    // SIGTERM（multi-DS 注册了 TERM handler → 先 disable 全部再退出）
    let pid = child.id() as i32;
    unsafe {
        kill(pid, SIGTERM);
    }
    // 有界等待退出（multi-DS 关停只需发几个 UDP 包，亚秒级）
    let deadline = Instant::now() + Duration::from_millis(1500);
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_)) => return, // 已退出（try_wait 完成收割，无僵尸）
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(_) => return,
        }
    }
    // 超时兜底：SIGKILL + wait 收尸
    let _ = child.kill();
    let _ = child.wait();
}

// 极简 libc 绑定（避免为 kill 一个调用引入 libc crate 依赖）
const SIGTERM: i32 = 15;
extern "C" {
    fn kill(pid: i32, sig: i32) -> i32;
}

#[tauri::command]
fn backend_start(app: AppHandle, which: String) -> Result<(), String> {
    spawn_backend(&app, &which)
}

#[tauri::command]
fn backend_stop(app: AppHandle, which: String) -> Result<(), String> {
    stop_backend(&app, &which)
}

#[tauri::command]
fn backend_status(app: AppHandle) -> Result<Vec<BackendStatus>, String> {
    let procs = app.state::<ProcMap>();
    let mut map = lock_map(&procs);
    // 回收已自行退出的子进程（retain + try_wait 完成收割，无僵尸）
    map.retain(|_k, p| matches!(p.child.try_wait(), Ok(None)));
    Ok(SIDEKICKS
        .iter()
        .map(|(key, _)| BackendStatus {
            which: key.to_string(),
            running: map.contains_key(*key),
            uptime_secs: map
                .get(*key)
                .map(|p| p.started.elapsed().as_secs())
                .unwrap_or(0),
        })
        .collect())
}

#[derive(serde::Serialize)]
struct BackendStatus {
    which: String,
    running: bool,
    uptime_secs: u64,
}

/// GHPaths 演控台 Tauri 壳。
/// 首个里程碑（ADR-0007 v2）：窗口壳 + ad-hoc 签名 + 本地网络权限声明。
/// 本里程碑：sidecar 进程管理（sim / multi-DS 收进 .app,双击全搞定）;updater 属后续。
pub fn run() {
    let app = tauri::Builder::default()
        .manage(ProcMap::new(HashMap::new()))
        .invoke_handler(tauri::generate_handler![
            backend_start,
            backend_stop,
            backend_status
        ])
        .build(tauri::generate_context!())
        .expect("GHPaths 演控台启动失败");
    app.run(|app_handle, event| {
        // RunEvent::Exit 是应用退出的保证钩子（窗口 Destroyed 在 AppleScript/系统退出
        // 路径上不触发——实测曾留孤儿）;在此优雅停掉全部子进程。
        if let tauri::RunEvent::Exit = event {
            let procs = app_handle.state::<ProcMap>();
            let mut map = lock_map(&procs);
            for (_, mut p) in map.drain() {
                terminate_gracefully(&mut p.child);
            }
        }
    });
}
