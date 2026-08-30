# DisyLab Tauri 桌面端实施手册

版本：Draft 1  
目标平台：Windows 10/11（第一阶段），macOS（第二阶段）  
现有前端：React 19 + TypeScript + Vite 8  
固定开发端口：`1420`

## 1. 结论

当前项目可以直接增加 Tauri 2 桌面端，不需要重写 React 画布。推荐保留 Web 版，同时在同一仓库新增 `src-tauri/`：

```text
React / Vite UI
├─ Web 环境：继续使用浏览器 File、Canvas、IndexedDB 和云端 relay
└─ Tauri 环境：通过受控 command 调用 Rust
   ├─ 系统文件选择与保存
   ├─ FFmpeg / FFprobe sidecar
   ├─ PDF 原生处理
   ├─ 任务进度、取消与日志
   └─ 系统密钥存储
```

桌面端首个可发布版本建议只做 Windows。文件工具箱优先迁移，画布、项目数据和 AI 接口继续复用现有实现。

## 2. 桌面端解决的问题

- 图片可以保持原格式压缩，不受 Canvas 编码格式限制。
- 视频可支持 MP4、MOV、M4V、MKV、WebM、AVI、MPEG、TS、MTS、M2TS、OGV 等输入。
- 视频可输出 MP4、MOV、MKV、WebM，并保留音频、字幕和基础元数据。
- 大文件不必完整读入 WebView 内存。
- 可获得真实进度、取消任务、覆盖确认、文件夹输出和批量队列。
- API Key 可从 `sessionStorage` 迁移到系统凭据存储。

## 3. 技术选择

### 3.1 桌面壳

使用 Tauri 2。Windows WebView 使用系统 WebView2；Rust 端只暴露白名单命令，不允许前端执行任意 shell。

### 3.2 媒体引擎

使用 FFmpeg 与 FFprobe sidecar：

- FFprobe：读取容器、编码器、尺寸、时长、帧率、音轨和字幕轨。
- FFmpeg：图片和视频转码、压缩、封装、元数据复制及进度输出。
- 首版将已验收的固定版本二进制随安装包分发，不依赖用户电脑预装 FFmpeg。
- 分发前必须核对所选 FFmpeg 构建的许可证及启用编码器；不要直接使用来源不明的二进制。

### 3.3 PDF 引擎

分两层处理：

- PDF 合并：Rust PDF 库负责页面复制与目录结构处理。
- PDF 压缩：调用独立、固定版本的 PDF 优化 sidecar；扫描型 PDF 才进行图片降采样。

PDF 压缩必须提供三档：轻度、均衡、强力。若输出不小于原文件，保留原文件并在 UI 中提示“已是较优大小”。

## 4. 环境准备

Windows 开发机安装：

1. Node.js `22.12+`。
2. Rust stable MSVC toolchain。
3. Microsoft C++ Build Tools，勾选“使用 C++ 的桌面开发”。
4. WebView2 Runtime；Windows 10/11 通常已包含。

检查命令：

```powershell
node --version
npm --version
rustc --version
cargo --version
```

## 5. 初始化步骤

以下命令在仓库根目录执行：

```powershell
npm install -D @tauri-apps/cli@latest
npx tauri init
```

初始化参数：

```text
App name: DisyLab
Window title: DisyLab
Web assets: ../dist
Dev server URL: http://127.0.0.1:1420
Frontend dev command: npm run dev
Frontend build command: npm run build
```

`package.json` 增加：

```json
{
  "scripts": {
    "tauri": "tauri",
    "desktop:dev": "tauri dev",
    "desktop:build": "tauri build"
  }
}
```

`vite.config.ts` 保留固定端口，并忽略 Rust 目录：

```ts
server: {
  port: 1420,
  host: '127.0.0.1',
  strictPort: true,
  watch: { ignored: ['**/src-tauri/**'] },
}
```

## 6. 建议目录

```text
src/
├─ desktop/
│  ├─ bridge.ts              # 判断 Tauri 环境并调用 command
│  ├─ media.ts               # 媒体任务 DTO
│  ├─ pdf.ts                 # PDF 任务 DTO
│  └─ events.ts              # 进度与完成事件
└─ ToolboxPanel.tsx

src-tauri/
├─ capabilities/
│  └─ default.json
├─ binaries/
│  ├─ ffmpeg-<target-triple>
│  ├─ ffprobe-<target-triple>
│  └─ pdf-optimize-<target-triple>
├─ src/
│  ├─ commands/
│  │  ├─ media.rs
│  │  ├─ pdf.rs
│  │  └─ files.rs
│  ├─ jobs.rs
│  ├─ error.rs
│  └─ lib.rs
├─ Cargo.toml
└─ tauri.conf.json
```

## 7. 安全边界

不要给前端开放通用的 `shell execute`。所有媒体处理必须经过 Rust command：

```rust
#[tauri::command]
async fn compress_video(request: CompressVideoRequest, state: State<'_, JobState>)
  -> Result<JobAccepted, AppError>;
```

Rust 端负责：

- 校验输入文件真实存在且为普通文件。
- 输出路径必须来自保存对话框或用户明确选择的目录。
- FFmpeg 参数由 Rust 枚举生成，禁止接收前端传来的任意参数字符串。
- 使用参数数组启动进程，不拼接 shell 命令。
- 限制同时执行任务数，首版建议最多两个图片任务或一个视频任务。
- 关闭窗口、退出应用和取消任务时终止子进程并清理临时文件。
- 临时文件使用应用缓存目录，不写入项目根目录。

Tauri 2 的 shell、文件系统和对话框能力默认应保持最小权限，只允许主窗口使用必需命令。

## 8. 前后端数据契约

```ts
type CompressionPreset = 'small' | 'balanced' | 'quality'

type MediaJobRequest = {
  inputPath: string
  outputPath: string
  kind: 'image' | 'video'
  preset: CompressionPreset
  keepFormat: boolean
  maxEdge?: number
  preserveMetadata: boolean
}

type JobProgress = {
  jobId: string
  phase: 'probing' | 'processing' | 'finalizing'
  progress: number
  processedSeconds?: number
  totalSeconds?: number
  outputBytes?: number
}
```

前端不得用文件内容 Base64 调用 Rust；只传系统路径和结构化选项。

## 9. 图片压缩规则

### 9.1 首版格式

| 格式 | 输入 | 同格式输出 | 备注 |
|---|---:|---:|---|
| JPEG/JPG | 是 | 是 | 调整质量、色度抽样和元数据 |
| PNG | 是 | 是 | 无损优化；强力档允许调色板量化 |
| WebP | 是 | 是 | 有损或无损 |
| AVIF | 是 | 是 | 编码较慢，显示预计耗时 |
| TIFF/TIF | 是 | 是 | 保留多页 TIFF 需要单独测试 |
| BMP | 是 | 是 | 可保持格式，但压缩收益通常很低 |
| GIF | 是 | 是 | 必须保留动画；不能按单帧图片处理 |
| HEIC/HEIF | 条件支持 | 条件支持 | 取决于打包的解码器与专利/许可证评估 |

“保持格式”是默认且不可静默降级的规则。无法同格式输出时，界面提供明确选择：取消，或由用户主动改选目标格式。

### 9.2 元数据

默认移除 GPS、相机序列号和缩略图，保留方向与色彩配置。高级设置允许用户选择保留全部元数据。

## 10. 视频压缩规则

### 10.1 输入容器

MP4、MOV、M4V、MKV、WebM、AVI、MPEG/MPG、TS、MTS/M2TS、OGV。

### 10.2 输出容器

首版正式支持 MP4、MOV、MKV、WebM。AVI 等旧容器可读取，但默认建议用户输出 MP4；只有容器和编码组合合法时才允许保持原格式。

### 10.3 编码策略

| 档位 | 视频策略 | 音频策略 |
|---|---|---|
| 高质量 | H.264 CRF 18–21 | AAC 192 kbps |
| 均衡 | H.264 CRF 23–25 | AAC 128 kbps |
| 小文件 | H.264 CRF 27–30 | AAC 96 kbps |

可选 H.265/AV1 必须放在高级设置，显示兼容性和编码耗时提示。默认不要启用 GPU 编码；第二阶段再检测 NVIDIA、Intel、AMD 和 Apple VideoToolbox。

进度从 FFmpeg `-progress pipe:1` 读取，不解析面向人类的 stderr 文本。

## 11. PDF 规则

### PDF 合并

- 支持拖拽调整文件顺序。
- 加密 PDF 在处理前提示输入密码，不记录密码。
- 合并后验证页数等于全部输入页数之和。
- 尽量保留书签；首版如果无法可靠合并书签，应明确提示。

### PDF 压缩

- 文本型 PDF：对象流、重复资源、未使用对象和字体子集优化。
- 扫描型 PDF：按档位降低图片分辨率与 JPEG 质量。
- 不栅格化文字页面。
- 不覆盖原文件，默认添加 `-compressed`。
- 输出后重新打开并检查页数、页面尺寸和加密状态。

## 12. 任务与 UI

现有工具箱 UI 继续使用，不新增第二套页面。桌面环境下增加：

- “选择文件”和“选择输出位置”系统对话框。
- 每个任务显示源格式、输出格式、预计大小和预计耗时。
- 正在处理按钮显示环形进度，并提供取消。
- 处理完成显示压缩前后大小、节省比例和“在文件夹中显示”。
- 如果同格式压缩没有收益，提示“文件已接近最优”，不生成更大的文件。
- Web 环境保留当前本地能力，并在受限格式旁显示“桌面端支持更多格式”。

## 13. 网络与现有 relay

桌面端不要依赖 Vite 开发代理。生产环境有两种方式：

1. APIYI 等已知服务继续请求线上 Cloudflare/Netlify/Vercel relay。
2. 后续把有限的厂商请求迁移为 Rust command，并建立严格的域名白名单、超时和响应大小限制。

首版采用方案 1，避免同时改动 AI 请求链路和媒体链路。自定义 API 仍按现有前端行为运行，若遇到 CORS 再单独设计桌面网络桥。

## 14. 本地数据迁移

首版继续使用 WebView 的 IndexedDB 和 localStorage，以降低迁移风险。必须验证：

- 开发版和正式版使用稳定的 Tauri identifier，避免数据目录变化。
- 升级安装不会清空 WebView 数据。
- `.disy` 导出/导入继续作为跨版本备份方案。
- API Key 迁移到系统密钥存储时，只做一次复制，成功后删除旧值。

## 15. 打包配置

`tauri.conf.json` 核心配置目标：

```json
{
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://127.0.0.1:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [{ "title": "DisyLab", "width": 1440, "height": 900 }]
  },
  "bundle": {
    "active": true,
    "targets": ["nsis", "msi"],
    "externalBin": ["binaries/ffmpeg", "binaries/ffprobe", "binaries/pdf-optimize"]
  }
}
```

实际生成的配置以 `tauri init` 当前 schema 为准，不直接复制旧版 Tauri 1 配置。

## 16. 构建与发布

开发：

```powershell
npm run desktop:dev
```

正式构建：

```powershell
npm run typecheck
npm run build
npm run desktop:build
```

Windows 产物选择：

- NSIS `setup.exe`：作为官网直接下载的首选。
- MSI：用于企业部署。

公开分发前必须完成 Windows 代码签名，否则从浏览器下载的安装包容易触发 SmartScreen 警告。自动更新应在代码签名稳定后再启用。

## 17. 验收清单

### 功能

- JPG、PNG、WebP、AVIF 输出扩展名、MIME 和实际文件头一致。
- 动图 GIF 压缩后仍保持全部帧、帧时长和循环设置。
- MP4、MOV、MKV、WebM 至少各完成一组带音频样本。
- 4K 长视频处理期间 UI 不冻结，取消后无残留进程。
- PDF 合并页数正确；文字型 PDF 压缩后文字仍可选择。
- 输出大于原文件时不替换结果。

### 安全

- 前端不能构造任意 FFmpeg 参数。
- 前端不能执行任意系统命令。
- 路径包含空格、中文、括号和单引号时正常处理。
- 输出文件已存在时必须确认，不静默覆盖。
- 临时文件在完成、失败、取消和异常退出后均可清理。

### 安装

- 全新 Windows 10/11 用户无需安装 Node、Rust 或 FFmpeg。
- 离线环境能启动并使用本地文件工具。
- 覆盖安装保留项目数据。
- 卸载行为和“是否保留用户数据”有明确说明。

## 18. 实施阶段

### 阶段 A：桌面壳（1–2 天）

- 初始化 Tauri 2。
- 固定 `1420` 开发端口。
- 完成窗口、图标、开发和生产构建。
- 验证现有画布、IndexedDB、API 配置和 `.disy` 导入导出。

### 阶段 B：文件桥与任务系统（2–3 天）

- 系统文件对话框。
- Rust job manager、事件进度、取消和临时目录。
- 前端 `desktop/bridge.ts` 与 Web fallback。

### 阶段 C：图片、视频、PDF（4–7 天）

- FFprobe 探测。
- 图片同格式压缩。
- 视频多容器转码和进度。
- PDF 合并与三档压缩。
- 工具箱结果统计和错误状态。

### 阶段 D：发布（2–4 天）

- Sidecar 许可证清单与校验值。
- NSIS/MSI 安装测试。
- Windows 代码签名。
- 崩溃日志、版本升级和回滚测试。

## 19. 第一阶段完成定义

只有同时满足以下条件，才算桌面首版完成：

1. Web 版构建和功能不回退。
2. `npm run desktop:dev` 固定连接 `127.0.0.1:1420`。
3. 安装包不依赖用户安装 FFmpeg。
4. 图片同格式输出经过文件头验证。
5. 视频压缩保留音频，支持取消并显示真实进度。
6. PDF 合并与压缩不破坏页面数量和可选文字。
7. 安装升级保留现有项目数据。
8. 所有 Tauri capability 和 command 均为最小权限。

## 20. 官方参考

- Tauri 2 现有前端初始化：https://v2.tauri.app/start/create-project/
- Windows 前置依赖：https://v2.tauri.app/start/prerequisites/
- Vite 集成：https://v2.tauri.app/start/frontend/vite/
- Shell sidecar 与权限：https://v2.tauri.app/plugin/shell/
- Dialog 插件：https://v2.tauri.app/plugin/dialog/
- Windows 安装包：https://v2.tauri.app/distribute/windows-installer/
- Windows 代码签名：https://v2.tauri.app/distribute/sign/windows/

