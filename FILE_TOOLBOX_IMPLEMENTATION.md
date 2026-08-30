# DisyLab 本地文件工具箱实施手册

## 1. 项目目标

在 DisyLab 网页端提供一个本地文件处理工具箱，让用户可以在浏览器中完成常用的文件处理操作：

- 图片压缩
- 视频压缩
- PDF 合并
- PDF 轻量压缩
- 后续可扩展格式转换、批量处理和任务历史

所有已支持的处理默认在用户浏览器本地完成，文件不上传到 DisyLab 服务器。

## 2. 当前实现状态

项目已经具备第一版工具箱入口和面板：

- 入口集成在 DisyLab 主画布界面
- 工具面板组件：`src/ToolboxPanel.tsx`
- 主应用接入：`src/App.tsx`
- 样式体系：`src/styles.css`
- PDF 处理依赖：`pdf-lib`
- 图片处理：浏览器 `createImageBitmap` + `canvas.toBlob`
- 视频处理：浏览器 `MediaRecorder` + `captureStream`

当前已通过 TypeScript 类型检查：

```bash
npm run typecheck
```

## 3. 技术方案

### 3.1 网页端架构

```text
React 19 + TypeScript
        |
        +-- ToolboxPanel.tsx       工具选择、文件队列、参数、结果下载
        +-- Browser APIs            图片/视频本地处理
        +-- pdf-lib                 PDF 读取、合并、保存
        +-- styles.css              DisyLab 玻璃拟态视觉系统
```

网页端版本优先采用浏览器原生能力，理由是：

1. 不需要部署文件处理服务器。
2. 用户隐私更容易解释和保证。
3. 可以直接复用现有 React、动画和样式体系。
4. 小型图片和 PDF 任务响应速度足够快。

### 3.2 桌面端能力的边界

浏览器不能直接可靠调用系统级 `FFmpeg`、`LibreOffice` 或 `ImageMagick`。因此网页端需要区分两类能力：

| 能力 | 网页端本地实现 | 适合方案 |
|---|---:|---|
| 图片压缩/转 WebP | 支持 | Canvas、Web Worker |
| PDF 合并 | 支持 | pdf-lib |
| PDF 轻量保存优化 | 支持 | pdf-lib |
| 视频转码为 WebM | 部分支持 | MediaRecorder |
| MP4/H.264 精确转码 | 不稳定 | FFmpeg WASM 或桌面端 FFmpeg |
| Word/Excel/PPT 转换 | 不建议纯浏览器实现 | 服务端或 Tauri + LibreOffice |
| PSD/AI 等专业格式 | 不建议纯浏览器实现 | 专用解析器或桌面端引擎 |

## 4. 功能设计

### 4.1 工具入口

工具箱作为主画布上的浮动入口，点击后打开侧边面板。面板需要保持以下行为：

- 支持鼠标和键盘操作
- `Esc` 关闭面板
- 点击遮罩关闭面板
- 入口有激活态和无障碍标签
- 不离开当前画布即可完成处理

### 4.2 文件队列

统一使用以下概念表示待处理文件：

```ts
type ToolFile = {
  id: string
  file: File
}
```

队列应支持：

- 拖拽添加
- 点击选择
- 删除单个文件
- 批量文件处理
- PDF 合并时拖拽调整顺序
- 显示文件名和大小
- 显示总文件数和总大小

### 4.3 输出策略

处理完成后使用浏览器 Blob 下载：

```ts
const url = URL.createObjectURL(blob)
const anchor = document.createElement('a')
anchor.href = url
anchor.download = outputName
anchor.click()
URL.revokeObjectURL(url)
```

输出文件名统一保留原文件名，并增加处理后缀，例如：

- `photo-compressed.webp`
- `clip-compressed.webm`
- `disy-merged.pdf`

## 5. 各功能实施方案

### 5.1 图片压缩

处理流程：

1. 读取 `File`。
2. 使用 `createImageBitmap` 解码。
3. 根据最长边限制计算缩放比例。
4. 绘制到 Canvas。
5. 使用 `canvas.toBlob` 输出 JPEG、WebP 或 PNG。
6. 触发本地下载。

注意事项：

- 超大图片应转移到 Web Worker，避免阻塞界面。
- PNG 默认转 WebP 时要明确提示可能改变透明通道表现。
- 需要在移动端限制最大像素数，避免内存溢出。

### 5.2 视频压缩

第一阶段使用浏览器 `MediaRecorder` 输出 WebM：

1. 创建隐藏 video 元素并读取元数据。
2. 通过 `captureStream()` 获取视频流。
3. 使用 `MediaRecorder` 以目标码率重新录制。
4. 完成后输出 WebM Blob。

兼容性说明：

- Safari、部分移动浏览器支持不完整。
- 不能保证输出 MP4。
- 需要提供“当前浏览器不支持本地视频压缩”的明确错误提示。

第二阶段如需要高兼容性，应引入 `ffmpeg.wasm`，并将转码任务放到 Worker。

### 5.3 PDF 合并

使用 `pdf-lib`：

1. 创建新的 `PDFDocument`。
2. 依次读取每个源 PDF。
3. 复制所有页面。
4. 按队列顺序加入目标 PDF。
5. 保存为 Blob 并下载。

风险控制：

- 对加密 PDF 提示暂不支持。
- 对损坏文件单独报告文件名。
- 多文件合并前要求至少选择两个文件。

### 5.4 PDF 压缩

网页端使用 PDF.js 将页面按用户选择的最长边渲染，再以 JPEG 质量参数重编码并由 pdf-lib 重新封装。该方式能实际压缩扫描件和图片型 PDF，但会将页面栅格化，因此界面必须明确提示可选文字、链接与表单不会保留。

处理完成后比较输入与输出大小。只有输出确实更小时才下载，并显示节省的字节数和比例；若输出不小于原文件，不生成伪装成 `compressed` 的原文件，而是提示“原 PDF 已较小”。

## 6. 代码组织建议

当前第一版集中在 `ToolboxPanel.tsx`，适合快速验证。功能扩大后建议拆分为：

```text
src/file-tools/
├── fileTypes.ts
├── download.ts
├── imageCompressor.ts
├── videoCompressor.ts
├── pdfTools.ts
├── useToolQueue.ts
└── ToolResult.tsx
```

拆分原则：

- 处理引擎不依赖 React。
- React 只负责状态、交互和错误展示。
- 下载、文件名和文件大小格式化统一复用。
- 每种格式转换器返回统一的 `{ blob, name, mimeType }`。

## 7. 后续扩展路线

### Phase 1：当前网页端 MVP

- 图片压缩
- 视频 WebM 压缩
- PDF 合并
- PDF 轻量优化
- 本地下载

### Phase 2：增强网页端

- 图片格式转换：PNG/JPG/WebP/AVIF
- 图片批量改尺寸
- PDF 拆分和页面删除
- Web Worker
- 任务进度和取消
- IndexedDB 临时任务记录

### Phase 3：专业格式转换

- `ffmpeg.wasm`：MP4、MOV、WebM、音频格式
- `LibreOffice`：DOCX、XLSX、PPTX、PDF
- `Pandoc`：Markdown、HTML、DOCX、LaTeX
- `qpdf/Ghostscript`：高级 PDF 优化

这一阶段更适合提供 Tauri 桌面端，或增加一个用户本地运行的转换服务。纯网页端不建议直接承诺完整 Office 格式互转。

## 8. 测试清单

### 功能测试

- 单个图片压缩
- 多个图片批量压缩
- 透明 PNG 转 WebP
- 视频压缩成功和不支持浏览器提示
- 两个以上 PDF 合并
- PDF 顺序拖拽调整
- 空队列不能执行
- 处理失败后可以重试

### 兼容性测试

- Chrome / Edge
- Firefox
- Safari
- Windows / macOS
- 移动端浏览器

### 安全与隐私测试

- 文件不会被请求发送到服务器
- 页面刷新后临时文件不被错误持久化
- 下载完成后及时释放 Blob URL
- 超大文件有明确的资源限制提示

### 工程验证

```bash
npm run typecheck
npm run build
```

## 9. 发布说明建议

产品文案应明确区分：

- “本地处理”：文件在浏览器内处理，不上传。
- “浏览器兼容性”：视频转换能力取决于浏览器。
- “压缩效果”：PDF 轻量优化不保证一定减小体积。
- “专业格式转换”：Office、MP4 精确编码等能力需要桌面引擎或额外运行时。

## 10. 验收标准

本功能达到以下条件即可视为网页端第一阶段完成：

1. 用户能从 DisyLab 主界面打开文件工具箱。
2. 用户能拖入或选择文件。
3. 图片压缩、PDF 合并可以稳定下载结果。
4. 视频不兼容时有清晰提示，不造成页面崩溃。
5. 文件处理过程中界面有处理中状态。
6. 所有第一阶段处理不依赖后端上传。
7. `npm run typecheck` 和 `npm run build` 均通过。
