use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{ipc::InvokeBody, Manager, State, WebviewWindow};

#[derive(Default)]
pub struct Storage(Mutex<Option<PendingWrite>>);

struct PendingWrite {
    id: String,
    temp: PathBuf,
    target: PathBuf,
    file: Option<File>,
}

impl Drop for PendingWrite {
    fn drop(&mut self) {
        self.file.take();
        let _ = fs::remove_file(&self.temp);
    }
}

fn error(value: impl std::fmt::Display) -> String {
    value.to_string()
}

fn config_path(window: &WebviewWindow) -> Result<PathBuf, String> {
    if window.label() != "main" {
        return Err("请在画布主窗口管理存储".into());
    }
    Ok(window
        .path()
        .app_config_dir()
        .map_err(error)?
        .join("workspace-directory.json"))
}

fn read_location(config: &Path) -> Result<Option<PathBuf>, String> {
    match fs::read(config) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(error),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(error(e)),
    }
}

#[tauri::command]
pub fn desktop_storage_location(window: WebviewWindow) -> Result<Option<PathBuf>, String> {
    read_location(&config_path(&window)?)
}

#[cfg(windows)]
fn pick_directory(window: &WebviewWindow) -> Result<Option<PathBuf>, String> {
    use windows::Win32::{
        System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_INPROC_SERVER},
        UI::Shell::{
            FileOpenDialog, IFileOpenDialog, FOS_FORCEFILESYSTEM, FOS_PICKFOLDERS,
            SIGDN_FILESYSPATH,
        },
    };
    let owner = window.hwnd().map_err(error)?;
    unsafe {
        let dialog: IFileOpenDialog =
            CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER).map_err(error)?;
        dialog
            .SetOptions(FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM)
            .map_err(error)?;
        if let Err(e) = dialog.Show(Some(owner)) {
            if e.code().0 as u32 == 0x800704c7 {
                return Ok(None);
            }
            return Err(error(e));
        }
        let path = dialog
            .GetResult()
            .and_then(|item| item.GetDisplayName(SIGDN_FILESYSPATH))
            .map_err(error)?;
        let result = path.to_string().map(PathBuf::from).map_err(error);
        CoTaskMemFree(Some(path.0.cast()));
        result.map(Some)
    }
}

#[tauri::command]
pub async fn desktop_choose_storage(window: WebviewWindow) -> Result<Option<PathBuf>, String> {
    let config = config_path(&window)?;
    #[cfg(windows)]
    {
        let (send, receive) = std::sync::mpsc::channel();
        let owner = window.clone();
        window
            .run_on_main_thread(move || {
                let _ = send.send(pick_directory(&owner));
            })
            .map_err(error)?;
        let selected = tauri::async_runtime::spawn_blocking(move || receive.recv().map_err(error))
            .await
            .map_err(error)???;
        if let Some(directory) = &selected {
            fs::create_dir_all(config.parent().ok_or("存储配置路径无效")?).map_err(error)?;
            let bytes = serde_json::to_vec(directory).map_err(error)?;
            let temp = config.with_extension("tmp");
            fs::write(&temp, bytes).map_err(error)?;
            fs::rename(&temp, &config).map_err(error)?;
        }
        Ok(selected)
    }
    #[cfg(not(windows))]
    {
        let _ = config;
        Err("当前系统不支持桌面目录选择".into())
    }
}

#[tauri::command]
pub fn desktop_start_write(
    window: WebviewWindow,
    state: State<Storage>,
    id: String,
    name: String,
) -> Result<(), String> {
    let directory = read_location(&config_path(&window)?)?.ok_or("请先选择本地存储目录")?;
    if id.len() != 36
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
        || name.len() > 240
        || !name.ends_with(".disy")
        || name
            .chars()
            .any(|ch| ch.is_control() || "/\\:*?\"<>|".contains(ch))
    {
        return Err("项目文件名无效".into());
    }
    let mut pending = state.0.lock().map_err(error)?;
    if pending.is_some() {
        return Err("已有项目文件正在保存".into());
    }
    let temp = directory.join(format!(".disylab-{id}.tmp"));
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(error)?;
    *pending = Some(PendingWrite {
        id,
        temp,
        target: directory.join(name),
        file: Some(file),
    });
    Ok(())
}

#[tauri::command]
pub fn desktop_write_chunk(
    window: WebviewWindow,
    state: State<Storage>,
    request: tauri::ipc::Request,
) -> Result<(), String> {
    config_path(&window)?;
    let id = request
        .headers()
        .get("x-disy-write")
        .and_then(|value| value.to_str().ok())
        .ok_or("存储任务无效")?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("项目数据格式无效".into());
    };
    if bytes.len() > 4 * 1024 * 1024 {
        return Err("项目数据块过大".into());
    }
    let mut pending = state.0.lock().map_err(error)?;
    let file = pending
        .as_mut()
        .filter(|item| item.id == id)
        .and_then(|item| item.file.as_mut())
        .ok_or("存储任务不存在")?;
    file.write_all(bytes).map_err(error)
}

#[tauri::command]
pub fn desktop_finish_write(
    window: WebviewWindow,
    state: State<Storage>,
    id: String,
    commit: bool,
) -> Result<(), String> {
    config_path(&window)?;
    let mut pending = state.0.lock().map_err(error)?;
    if !pending.as_ref().is_some_and(|item| item.id == id) {
        return Err("存储任务不存在".into());
    }
    let mut item = pending.take().unwrap();
    if commit {
        let file = item.file.take().ok_or("项目文件未打开")?;
        file.sync_all().map_err(error)?;
        drop(file);
        fs::rename(&item.temp, &item.target).map_err(error)?;
    }
    Ok(())
}
