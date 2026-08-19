/// GHPaths 演控台 Tauri 壳。
/// 首个里程碑（ADR-0007 v2）：窗口壳 + ad-hoc 签名 + 本地网络权限声明;
/// sidecar（sim/multi-DS 子进程）与 updater 属后续里程碑。
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("GHPaths 演控台启动失败");
}
