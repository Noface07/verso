use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  #[allow(unused_mut)]
  let mut builder = tauri::Builder::default()
    .plugin(tauri_plugin_log::Builder::default().build())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_os::init())
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_deep_link::init())
    .plugin(tauri_plugin_process::init());

  #[cfg(desktop)]
  {
    builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
      if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_focus();
        let _ = win.unminimize();
      }
      for arg in args.into_iter().skip(1) {
        if !arg.starts_with('-') {
          let _ = app.emit("verso://file-open", arg);
        }
      }
    }));
  }

  builder
    .setup(|app| {
      #[cfg(desktop)]
      {
        let args: Vec<String> = std::env::args().collect();
        for arg in args.into_iter().skip(1) {
          if !arg.starts_with('-') {
            let _ = app.emit("verso://file-open", arg);
          }
        }
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
