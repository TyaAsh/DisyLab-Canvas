use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, Instant},
};

use tauri::{AppHandle, Manager};

static STAGING_ID: AtomicU64 = AtomicU64::new(0);

fn cli_path(app: &AppHandle) -> Result<PathBuf, String> {
    let home = app.path().home_dir().map_err(|_| "无法找到用户目录")?;
    let filename = if cfg!(windows) {
        "dreamina.exe"
    } else {
        "dreamina"
    };
    [home.join("bin"), home.join(".local").join("bin")]
        .into_iter()
        .map(|dir| dir.join(filename))
        .find(|path| path.is_file())
        .ok_or_else(|| "没有找到官方即梦 CLI，请从官方页面安装后再试".into())
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-'))
}

fn temp_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map(|path| path.join("jimeng"))
        .map_err(|_| "无法访问 Disy 缓存目录".into())
}

struct TempRefs(PathBuf);
impl Drop for TempRefs {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn stage_images(root: &Path, inputs: &[Vec<u8>]) -> Result<(TempRefs, Vec<String>), String> {
    if inputs.len() > 10 || inputs.iter().map(Vec::len).sum::<usize>() > 30_000_000 {
        return Err("即梦参考图超过本地上传限制".into());
    }
    fs::create_dir_all(root).map_err(|_| "无法创建即梦缓存目录")?;
    let dir = root.join(format!(
        "inputs-{}-{}",
        std::process::id(),
        STAGING_ID.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&dir).map_err(|_| "无法创建即梦素材目录")?;
    let refs = TempRefs(dir);
    let mut names = Vec::new();
    for (i, input) in inputs.iter().enumerate() {
        let ext = if input.starts_with(b"\x89PNG\r\n\x1a\n") {
            "png"
        } else if input.starts_with(b"\xff\xd8\xff") {
            "jpg"
        } else if input.starts_with(b"RIFF") && input.get(8..12) == Some(b"WEBP") {
            "webp"
        } else {
            return Err("即梦参考图需要 PNG、JPEG 或 WebP 格式".into());
        };
        let name = format!("reference-{i}.{ext}");
        fs::write(refs.0.join(&name), input).map_err(|_| "无法暂存即梦参考图")?;
        names.push(name);
    }
    Ok((refs, names))
}

fn run(
    path: &Path,
    args: &[String],
    cwd: Option<&Path>,
    timeout: Duration,
) -> Result<String, String> {
    let mut command = Command::new(path);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|_| "无法启动官方即梦 CLI")?;
    let stdout = child.stdout.take().ok_or("无法读取即梦 CLI 输出")?;
    let stderr = child.stderr.take().ok_or("无法读取即梦 CLI 状态")?;
    let collect = |stream: Box<dyn Read + Send>| {
        thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = stream.take(2_000_000).read_to_end(&mut bytes);
            String::from_utf8_lossy(&bytes).into_owned()
        })
    };
    let stdout = collect(Box::new(stdout));
    let stderr = collect(Box::new(stderr));
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|_| "无法读取即梦 CLI 执行状态")? {
            break status;
        }
        if start.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err("即梦 CLI 响应超时；如任务已提交，请先查询原任务".into());
        }
        thread::sleep(Duration::from_millis(120));
    };
    let output = stdout.join().unwrap_or_default();
    let errors = stderr.join().unwrap_or_default();
    if !status.success() {
        return Err(
            if errors.contains("not logged")
                || errors.contains("未登录")
                || errors.contains("login required")
            {
                "请先登录即梦账号".into()
            } else {
                "即梦 CLI 执行失败，请检查登录状态、积分或所选规格".into()
            },
        );
    }
    Ok(output)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn jimeng_cli(
    app: AppHandle,
    window: tauri::WebviewWindow,
    action: String,
    id: Option<String>,
    model: Option<String>,
    prompt: Option<String>,
    ratio: Option<String>,
    resolution: Option<String>,
    duration: Option<u16>,
    inputs: Option<Vec<Vec<u8>>>,
) -> Result<String, String> {
    if window.label() != "main" {
        return Err("即梦连接只供画布主窗口使用".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let bin = cli_path(&app)?;
        let mut cwd = None;
        let mut stage = None;
        let strings = |args: &[&str]| args.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        let args = match action.as_str() {
            "status" => strings(&["user_credit"]),
            "begin" => strings(&["login", "--headless"]),
            "relogin" => strings(&["relogin", "--headless"]),
            "finish" => {
                let code = id.filter(|id| valid_id(id)).ok_or("即梦授权码无效")?;
                vec![
                    "login".into(),
                    "checklogin".into(),
                    format!("--device_code={code}"),
                    "--poll=10".into(),
                ]
            }
            "image_models" => strings(&["text2image", "--help"]),
            "video_models" => strings(&["text2video", "--help"]),
            "query" | "download" => {
                let id = id.filter(|id| valid_id(id)).ok_or("即梦任务编号无效")?;
                let mut args = vec!["query_result".into(), format!("--submit_id={id}")];
                if action == "download" {
                    let dir = temp_root(&app)?.join("results").join(id);
                    fs::create_dir_all(&dir).map_err(|_| "无法创建即梦下载目录")?;
                    args.push(format!("--download_dir={}", dir.to_string_lossy()));
                }
                args
            }
            "image" | "video" => {
                let inputs = inputs.unwrap_or_default();
                let prompt = prompt
                    .filter(|value| {
                        !value.trim().is_empty() && value.len() <= 16_000 && !value.contains('\0')
                    })
                    .ok_or("即梦提示词无效")?;
                let model = model
                    .filter(|value| {
                        !value.is_empty()
                            && value.len() <= 64
                            && value.bytes().all(|c| {
                                c.is_ascii_alphanumeric() || matches!(c, b'.' | b'-' | b'_')
                            })
                    })
                    .ok_or("即梦模型版本无效")?;
                if action == "video" && inputs.len() > 1 {
                    return Err("即梦图生视频当前只接受一张首帧".into());
                }
                let kind = if action == "image" {
                    if inputs.is_empty() {
                        "text2image"
                    } else {
                        "image2image"
                    }
                } else if inputs.is_empty() {
                    "text2video"
                } else {
                    "image2video"
                };
                let mut args = vec![
                    kind.into(),
                    format!("--prompt={prompt}"),
                    format!("--model_version={model}"),
                ];
                if !inputs.is_empty() {
                    let (dir, names) = stage_images(&temp_root(&app)?, &inputs)?;
                    args.push(format!(
                        "--{}={}",
                        if action == "video" { "image" } else { "images" },
                        names.join(",")
                    ));
                    cwd = Some(dir.0.clone());
                    stage = Some(dir);
                }
                if let Some(ratio) = ratio {
                    if !matches!(
                        ratio.as_str(),
                        "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3" | "21:9" | "9:21"
                    ) {
                        return Err("即梦不支持此画面比例".into());
                    }
                    if !(kind == "image2video" && model == "seedance2.5") {
                        args.push(format!("--ratio={ratio}"));
                    }
                }
                if let Some(resolution) = resolution {
                    if !matches!(
                        resolution.as_str(),
                        "1k" | "2k" | "4k" | "480p" | "720p" | "1080p" | "2K" | "1K" | "4K"
                    ) {
                        return Err("即梦不支持此清晰度".into());
                    }
                    args.push(format!(
                        "--{}={}",
                        if action == "image" {
                            "resolution_type"
                        } else {
                            "video_resolution"
                        },
                        resolution.to_ascii_lowercase()
                    ));
                }
                if let Some(seconds) = duration {
                    if !(4..=30).contains(&seconds) {
                        return Err("即梦视频时长超出范围".into());
                    }
                    args.push(format!("--duration={seconds}"));
                }
                args
            }
            _ => return Err("未知的即梦操作".into()),
        };
        let result = run(
            &bin,
            &args,
            cwd.as_deref(),
            Duration::from_secs(if action == "download" { 180 } else { 45 }),
        );
        drop(stage);
        result
    })
    .await
    .map_err(|_| "即梦后台操作已中断".to_string())?
}

#[tauri::command]
pub fn jimeng_open_login(window: tauri::WebviewWindow, url: String) -> Result<(), String> {
    if window.label() != "main" {
        return Err("即梦连接只供画布主窗口使用".into());
    }
    let parsed = tauri::Url::parse(&url).map_err(|_| "即梦授权地址无效")?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("jimeng.jianying.com")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port().is_some()
        || !matches!(
            parsed.path(),
            "/ai-tool/cli-auth" | "/passport/open/scan_user_code"
        )
    {
        return Err("只允许打开即梦官方授权页面".into());
    }
    if let Some((_, value)) = parsed
        .query_pairs()
        .find(|(key, _)| key == "verification_uri")
    {
        let nested = tauri::Url::parse(&value).map_err(|_| "即梦授权地址无效")?;
        if nested.scheme() != "https"
            || nested.host_str() != Some("jimeng.jianying.com")
            || !nested.username().is_empty()
            || nested.password().is_some()
            || nested.port().is_some()
            || nested.path() != "/passport/open/scan_user_code"
        {
            return Err("即梦授权跳转地址无效".into());
        }
    }
    open_browser_url(&parsed)
}

pub(crate) fn open_browser_url(url: &tauri::Url) -> Result<(), String> {
    #[cfg(windows)]
    {
        #[link(name = "shell32")]
        extern "system" {
            fn ShellExecuteW(
                hwnd: isize,
                operation: *const u16,
                file: *const u16,
                parameters: *const u16,
                directory: *const u16,
                show: i32,
            ) -> isize;
        }
        let text: Vec<u16> = url.as_str().encode_utf16().chain([0]).collect();
        let verb = [111u16, 112, 101, 110, 0];
        // The validated HTTPS URL is passed to the registered browser, not a command shell.
        let result = unsafe {
            ShellExecuteW(
                0,
                verb.as_ptr(),
                text.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
            )
        };
        if result <= 32 {
            return Err("无法打开系统浏览器".into());
        }
    }
    #[cfg(not(windows))]
    {
        let opener = if cfg!(target_os = "macos") {
            "open"
        } else {
            "xdg-open"
        };
        Command::new(opener)
            .arg(url.as_str())
            .spawn()
            .map_err(|_| "无法打开系统浏览器")?;
    }
    Ok(())
}

#[tauri::command]
pub async fn jimeng_downloaded_media(
    app: AppHandle,
    window: tauri::WebviewWindow,
    id: String,
    video: bool,
) -> Result<tauri::ipc::Response, String> {
    if window.label() != "main" {
        return Err("即梦连接只供画布主窗口使用".into());
    }
    if !valid_id(&id) {
        return Err("即梦任务编号无效".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let dir = temp_root(&app)?.join("results").join(id);
        let mut files = fs::read_dir(&dir)
            .map_err(|_| "即梦没有下载生成文件")?
            .flatten()
            .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
            .map(|entry| entry.path())
            .filter(|path| {
                path.extension()
                    .and_then(|s| s.to_str())
                    .is_some_and(|ext| {
                        let ext = ext.to_ascii_lowercase();
                        if video {
                            matches!(ext.as_str(), "mp4" | "mov" | "webm")
                        } else {
                            matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp")
                        }
                    })
            })
            .collect::<Vec<_>>();
        files.sort();
        let file = files.first().ok_or("即梦没有返回可归档的媒体文件")?;
        if fs::metadata(file)
            .map_err(|_| "无法读取即梦下载文件")?
            .len()
            > 256_000_000
        {
            return Err("即梦媒体过大，无法直接归档到画布".into());
        }
        let bytes = fs::read(file).map_err(|_| "无法读取即梦下载文件")?;
        let _ = fs::remove_file(file);
        let _ = fs::remove_dir(dir);
        Ok(tauri::ipc::Response::new(bytes))
    })
    .await
    .map_err(|_| "即梦文件读取已中断".to_string())?
}
