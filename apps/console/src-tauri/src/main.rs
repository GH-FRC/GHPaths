// 防止 Windows release 构建弹控制台窗（macOS 无影响）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ghpaths_console_lib::run()
}
