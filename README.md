# DisyLab Canvas 2.0

面向设计师和内容创作者的本地优先 AI 无限画布。在同一个项目里整理参考、生成图像和视频、保存素材，并和 Disy Agent 一起推进创作。

[在线体验](https://disylab.pages.dev/) · [项目介绍](https://tyaash.github.io/DisyLab-Canvas/) · [下载 Windows 版](https://github.com/TyaAsh/DisyLab-Canvas/releases/tag/v2.0.0) · [English](README.en.md) · [繁體中文](README.zh-TW.md)

## 2.0 更新

- **Disy Agent** 支持项目记忆、任务中心和按创作目标配置的团队角色。生成确认卡可调整模型、数量和模型支持的规格。涉及画布改动时，可先在对话中审阅方案。
- **Skill** 有两种使用方式。逐步引导在对话里一次显示一个问题，支持选项和自由输入。直接应用的 Skill 可以从文本、图像和视频节点调用。
- **画布图层** 可以悬浮或固定在左侧，支持打组、复制、重命名和拖动排序。项目、素材和生成历史保存在本机，可通过 `.disy` 项目包迁移。
- **API 连接** 包括 GRS AI、HFSY API、万象 API、MiniMax、xAI、火山方舟等。配置连接后，按文本、图像、视频启用所需模型。
- **文件工具箱** 提供图片、视频和 PDF 压缩、PDF 合并，以及图像和视频的选区去水印。公开媒体链接能否读取取决于来源和平台限制。
- **Windows 桌面版** 支持独立窗口、系统浏览器链接、即梦官方 CLI 授权和 Muse 账号连接。Muse 账号连接使用桌面端的独立网页会话，具体能力取决于账号权限。macOS 版稍后推出。

## 开始使用

1. 打开网页版，或到 GitHub Release 下载 Windows x64 安装包。
2. 在「API 设置」添加厂商连接、输入自己的 API Key，再启用需要的模型。Windows 上使用「即梦」时需要先安装官方 CLI。使用「Muse 账号」时，在弹出的官网窗口内登录。
3. 新建项目后，可以直接创建节点，或打开 Disy Agent。需要引导时，从对话输入区选一个 Skill。准备生成时，在确认卡里核对模型、数量和规格。
4. 在 Agent 顶部打开「项目记忆」或「任务中心」查看项目约定和任务状态。跨设备迁移前，导出 `.disy` 项目包。

项目和资产默认保存在本机。API Key 保存在当前应用会话中，不包含在项目包里。生成时，模型厂商会收到运行任务所需的提示词和参考素材。

## 本地运行与构建

需要 Node.js 22.12+、npm 10.8+。在仓库根目录执行：

```sh
npm ci
npm run dev
npm test
npm run build
```

开发地址为 `http://127.0.0.1:1420/`，生产构建输出到 `dist/`。

Windows 桌面开发需要 Rust MSVC 工具链、Visual Studio C++ Build Tools 和 WebView2。

```powershell
npm run desktop:dev
npm run desktop:build
```

安装包输出到 `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`。

## 部署

- **Cloudflare Pages** 运行在线画布。项目名为 `disylab`，生产分支为 `main`，构建命令为 `npm run build`，输出目录为 `dist`。发布时保留仓库根目录的 `functions/`，供 API 与媒体转发使用。
- **GitHub Pages** 发布 `site/` 项目介绍页。修改后由仓库的 Pages 工作流部署。

有 Cloudflare 项目权限时，可在仓库根目录执行：

```sh
npm run build
npx wrangler pages deploy dist --project-name disylab --branch main
```

## 授权

DisyLab 是源码公开可见的专有软件。商用、白标、再分发等用途需获得书面授权。详见[中文授权声明](LICENSE.zh-CN.md)、[许可证](LICENSE)和[第三方声明](NOTICE.md)。
