use tauri::{
    webview::NewWindowResponse, AppHandle, Manager, Url, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

const ACCOUNT_WINDOW: &str = "muse-account";
const MUSE_URL: &str = "https://muse.ai/";

fn is_muse_account_origin(url: &Url) -> bool {
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return false;
    }
    let host = url.host_str().unwrap_or_default();
    [
        "muse.ai",
        "meta.ai",
        "meta.com",
        "facebook.com",
        "instagram.com",
    ]
    .iter()
    .any(|domain| {
        host == *domain
            || host
                .strip_suffix(*domain)
                .is_some_and(|prefix| prefix.ends_with('.'))
    })
}

#[tauri::command]
pub async fn muse_open_account(
    app: AppHandle,
    window: WebviewWindow,
    in_browser: bool,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Muse 入口只供画布主窗口使用".into());
    }
    let url = Url::parse(MUSE_URL).map_err(|_| "Muse 官网地址无效")?;
    if in_browser || !cfg!(windows) {
        return crate::jimeng::open_browser_url(&url);
    }
    let account = get_account_window(&app)?;
    account.show().map_err(|_| "无法显示 Muse 登录窗口")?;
    account
        .set_focus()
        .map_err(|_| "无法聚焦 Muse 登录窗口".into())
}

fn get_account_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(existing) = app.get_webview_window(ACCOUNT_WINDOW) {
        return Ok(existing);
    }
    let url = Url::parse(MUSE_URL).map_err(|_| "Muse 官网地址无效")?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "无法访问 Disy 应用目录")?
        .join("muse-account-webview");
    std::fs::create_dir_all(&data_dir).map_err(|_| "无法创建 Muse 独立登录目录")?;
    // The account window has a separate profile and no Tauri capability.
    let created = WebviewWindowBuilder::new(app, ACCOUNT_WINDOW, WebviewUrl::External(url))
        .title("Muse · 官方账号")
        .inner_size(920.0, 720.0)
        .min_inner_size(420.0, 500.0)
        .visible(false)
        .data_directory(data_dir)
        .on_navigation(is_muse_account_origin)
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .build();
    created
        .or_else(|error| app.get_webview_window(ACCOUNT_WINDOW).ok_or(error))
        .map_err(|_| "无法打开 Muse 登录窗口".into())
}

#[tauri::command]
pub async fn muse_web(
    app: AppHandle,
    window: WebviewWindow,
    operation: String,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if window.label() != "main" || !cfg!(windows) {
        return Err("Muse 网页连接仅供 Windows 桌面画布使用".into());
    }
    if !matches!(
        operation.as_str(),
        "status" | "start" | "poll" | "media" | "release"
    ) {
        return Err("不支持的 Muse 操作".into());
    }
    let payload = serde_json::to_string(&payload).map_err(|_| "Muse 请求格式错误")?;
    if payload.len() > 36_000_000 {
        return Err("Muse 参考图超过 24 MB，请缩小后重试".into());
    }
    let account = match app.get_webview_window(ACCOUNT_WINDOW) {
        Some(account) => account,
        None if operation == "status" => get_account_window(&app)?,
        None => return Err("Muse 窗口已关闭，请重新连接后再试".into()),
    };
    let current_url = account.url().map_err(|_| "无法读取 Muse 网页地址")?;
    if current_url.as_str() == "about:blank" {
        return Ok(serde_json::json!({ "state": "loading" }));
    }
    if !is_muse_account_origin(&current_url)
        || !matches!(current_url.host_str(), Some("muse.ai" | "www.muse.ai"))
    {
        return Ok(serde_json::json!({ "state": "login" }));
    }
    if operation == "start" {
        account.show().map_err(|_| "无法显示 Muse 任务窗口")?;
    }
    let program = format!("({})({operation:?},{payload})", include_str!("muse_web.js"));
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    account
        .eval_with_callback(program, move |result| {
            let _ = sender.try_send(result);
        })
        .map_err(|_| "无法读取 Muse 窗口")?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        receiver.recv_timeout(std::time::Duration::from_secs(10))
    })
    .await
    .map_err(|_| "Muse 网页连接中断")?
    .map_err(|_| "Muse 网页未响应")?;
    serde_json::from_str(&result).map_err(|_| "Muse 网页没有返回有效状态".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn muse_account_only_accepts_known_https_origins() {
        assert!(is_muse_account_origin(
            &Url::parse("https://muse.ai/").unwrap()
        ));
        assert!(is_muse_account_origin(
            &Url::parse("https://accountscenter.meta.com/").unwrap()
        ));
        for url in [
            "https://muse.ai.example.net/",
            "http://muse.ai/",
            "https://muse.ai:8999/",
            "https://fake@muse.ai/",
        ] {
            assert!(!is_muse_account_origin(&Url::parse(url).unwrap()), "{url}");
        }
    }
}
