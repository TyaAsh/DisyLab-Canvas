#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod jimeng;
mod muse;

#[tauri::command]
fn open_provider_url(window: tauri::WebviewWindow, url: String) -> Result<(), String> {
    if window.label() != "main" {
        return Err("此操作只能在画布主窗口使用".into());
    }
    let url = tauri::Url::parse(&url).map_err(|_| "链接地址无效")?;
    open_external_url(&url)
}

fn open_external_url(url: &tauri::Url) -> Result<(), String> {
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("请使用有效的网页链接".into());
    }
    jimeng::open_browser_url(url)
}

#[cfg(windows)]
fn update_window_region(window: &tauri::WebviewWindow) {
    use std::ffi::c_void;
    use std::sync::Mutex;

    #[repr(C)]
    #[derive(Clone, Copy, Default, PartialEq)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    #[repr(C)]
    #[derive(Default)]
    struct Point {
        x: i32,
        y: i32,
    }

    static LAST_REGION: Mutex<Option<(Rect, i32)>> = Mutex::new(None);

    #[link(name = "user32")]
    extern "system" {
        fn GetWindowRect(hwnd: *mut c_void, rect: *mut Rect) -> i32;
        fn GetClientRect(hwnd: *mut c_void, rect: *mut Rect) -> i32;
        fn ClientToScreen(hwnd: *mut c_void, point: *mut Point) -> i32;
        fn IsZoomed(hwnd: *mut c_void) -> i32;
        fn IsIconic(hwnd: *mut c_void) -> i32;
        fn SetWindowRgn(hwnd: *mut c_void, region: *mut c_void, redraw: i32) -> i32;
    }

    #[link(name = "gdi32")]
    extern "system" {
        fn CreateRectRgn(left: i32, top: i32, right: i32, bottom: i32) -> *mut c_void;
        fn CreateRoundRectRgn(
            left: i32,
            top: i32,
            right: i32,
            bottom: i32,
            ellipse_width: i32,
            ellipse_height: i32,
        ) -> *mut c_void;
        fn DeleteObject(object: *mut c_void) -> i32;
    }

    let Ok(hwnd) = window.hwnd() else { return };
    let mut outer = Rect::default();
    unsafe {
        if IsIconic(hwnd.0) != 0 || GetWindowRect(hwnd.0, &mut outer) == 0 {
            return;
        }
    }
    let maximized = unsafe { IsZoomed(hwnd.0) != 0 };
    let (rect, diameter) = if maximized || window.is_fullscreen().unwrap_or(false) {
        // Tao sizes the client area to the monitor's work area when maximized.
        // Clip to that area so the native resize frame cannot show around the webview.
        let mut client = Rect::default();
        let mut origin = Point::default();
        unsafe {
            if GetClientRect(hwnd.0, &mut client) == 0 || ClientToScreen(hwnd.0, &mut origin) == 0 {
                return;
            }
        }
        let left = origin.x - outer.left;
        let top = origin.y - outer.top;
        (
            Rect {
                left,
                top,
                right: left + client.right,
                bottom: top + client.bottom,
            },
            0,
        )
    } else {
        let diameter = (44.0 * window.scale_factor().unwrap_or(1.0)).round() as i32;
        (
            Rect {
                right: outer.right - outer.left,
                bottom: outer.bottom - outer.top,
                ..Rect::default()
            },
            diameter,
        )
    };
    if rect.right <= rect.left || rect.bottom <= rect.top {
        return;
    }
    let region_key = (rect, diameter);
    if let Ok(mut last) = LAST_REGION.lock() {
        if *last == Some(region_key) {
            return;
        }
        // Record this before Windows emits any additional resize notifications.
        *last = Some(region_key);
    }
    unsafe {
        let region = if diameter == 0 {
            CreateRectRgn(rect.left, rect.top, rect.right, rect.bottom)
        } else {
            CreateRoundRectRgn(
                rect.left,
                rect.top,
                rect.right,
                rect.bottom,
                diameter,
                diameter,
            )
        };
        // SetWindowRgn takes ownership on success. The caller frees only a rejected region.
        if region.is_null() || SetWindowRgn(hwnd.0, region, 1) == 0 {
            if !region.is_null() {
                DeleteObject(region);
            }
            if let Ok(mut last) = LAST_REGION.lock() {
                if *last == Some(region_key) {
                    *last = None;
                }
            }
        }
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            use tauri::webview::NewWindowResponse;
            let main = app
                .config()
                .app
                .windows
                .iter()
                .find(|config| config.label == "main")
                .expect("missing main window configuration");
            let window = tauri::WebviewWindowBuilder::from_config(app, main)?
                .on_new_window(|url, _| {
                    if let Err(error) = open_external_url(&url) {
                        eprintln!("{error}");
                    }
                    NewWindowResponse::Deny
                })
                .build()?;
            #[cfg(windows)]
            {
                update_window_region(&window);
                let resized_window = window.clone();
                window.on_window_event(move |event| {
                    if matches!(
                        event,
                        tauri::WindowEvent::Resized(_)
                            | tauri::WindowEvent::ScaleFactorChanged { .. }
                    ) {
                        update_window_region(&resized_window);
                    }
                });
            }
            #[cfg(not(windows))]
            let _ = window;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            jimeng::jimeng_cli,
            jimeng::jimeng_downloaded_media,
            jimeng::jimeng_open_login,
            muse::muse_open_account,
            muse::muse_web,
            open_provider_url
        ])
        .run(tauri::generate_context!())
        .expect("failed to start DisyLab");
}
