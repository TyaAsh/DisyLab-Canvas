# DisyLab 动效模块技术实施方案

> 版本：v1.1  
> 日期：2026-08-21  
> 对应项目：Disy Motion

## 1. 现有基础评估

当前仓库可直接复用的基础包括：React 19、TypeScript 6、Vite 8、React Flow、Zustand、GSAP、Framer Motion、Three.js、IndexedDB、项目包导入导出、媒体历史、视频节点和保留中的 SVG 动效节点。

现有优势是素材生产和本地项目闭环已经成立；主要结构风险是大量编辑器逻辑集中于 `src/App.tsx`。动效工作空间不得继续以内嵌分支形式扩张，应先建立独立模块边界。

## 2. 总体架构

```text
Workspace Shell
├─ Design Workspace（现有 React Flow 编辑器）
├─ Motion Workspace
│  ├─ Motion Store
│  ├─ Stage Renderer
│  ├─ Timeline Editor
│  ├─ Preset Engine
│  ├─ Playback Engine
│  └─ Export Pipeline
└─ Whiteboard Workspace（预留）

Shared Services
├─ Project / Canvas Repository
├─ Asset Repository
├─ History / Undo Manager
├─ Agent / Provider Layer
└─ Bundle Import / Export
```

原则：UI 组件不直接读写 IndexedDB；存储通过 repository；动画数学与 React 分离；预览和导出共用同一套采样函数。

## 3. 工作空间数据模型

建议将 `WorkspaceCanvas` 从“隐含设计画布”升级为带类型的记录：

```ts
type WorkspaceKind = 'design' | 'motion' | 'whiteboard'

type WorkspaceDocument =
  | { kind: 'design'; schemaVersion: 1; document: DesignDocument }
  | { kind: 'motion'; schemaVersion: 1; document: MotionDocument }
  | { kind: 'whiteboard'; schemaVersion: 1; document: WhiteboardDocument }
```

兼容策略：历史画布缺少 `kind` 时按 `design` 处理；读取后不立即覆盖原数据，只有下一次保存时升级。`.disy` 包版本可先维持外层版本，通过文档内 `schemaVersion` 演进；若外层结构变化再升包版本。

## 4. 动效领域模型

```ts
type MotionDocument = {
  id: string
  name: string
  schemaVersion: 1
  fps: 30 | 60
  durationMs: number
  width: number
  height: number
  background: string
  scenes: MotionScene[]
  activeSceneId: string
}

type MotionScene = {
  id: string
  name: string
  durationMs: number
  layerIds: string[]
  layers: Record<string, MotionLayer>
}

type MotionLayer = {
  id: string
  type: 'text' | 'image' | 'svg' | 'shape' | 'video' | 'group'
  name: string
  parentId?: string
  visible: boolean
  locked: boolean
  inMs: number
  outMs: number
  source: MotionSource
  base: MotionBaseStyle
  tracks: MotionTrack[]
}

type MotionTrack = {
  id: string
  property: 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation' | 'opacity' | 'blur'
  keyframes: MotionKeyframe[]
}

type MotionKeyframe = {
  id: string
  timeMs: number
  value: number
  easing: MotionEasing
}
```

所有持久化时间使用整数毫秒，界面按帧吸附。避免以浮点帧作为唯一真值，减少 29.97/60fps 扩展时的迁移成本。

## 5. 动画解释规则

- 同一图层的同一属性只允许一条轨道。
- 相邻关键帧之间插值；首关键帧之前使用首值，末关键帧之后使用末值。
- 预设不作为运行时黑盒保存，而是生成标准轨道与关键帧。
- 组合预设若写入同一属性，界面提示“覆盖 / 保留现有 / 取消”。
- Group MVP 只继承父级 transform 和 opacity；遮罩与混合模式在 P1 引入。
- 播放时间由单一 clock 提供，所有图层基于同一 `currentTimeMs` 采样。

## 6. 推荐目录

```text
src/
├─ workspaces/
│  ├─ WorkspaceRouter.tsx
│  ├─ workspaceTypes.ts
│  ├─ design/
│  ├─ motion/
│  │  ├─ MotionWorkspace.tsx
│  │  ├─ model/
│  │  │  ├─ types.ts
│  │  │  ├─ schema.ts
│  │  │  ├─ migration.ts
│  │  │  └─ defaults.ts
│  │  ├─ engine/
│  │  │  ├─ interpolate.ts
│  │  │  ├─ easing.ts
│  │  │  ├─ sample.ts
│  │  │  └─ playbackClock.ts
│  │  ├─ store/
│  │  │  ├─ motionStore.ts
│  │  │  └─ commands.ts
│  │  ├─ stage/
│  │  ├─ timeline/
│  │  ├─ presets/
│  │  └─ export/
│  └─ whiteboard/
└─ shared/
   ├─ assets/
   ├─ history/
   └─ persistence/
```

第一轮不必搬完现有设计代码；先加 Router，让旧 `App` 成为 `DesignWorkspace` 的适配入口，再逐步拆分。

## 7. 状态与命令系统

建议 Motion 使用独立 Zustand store，分为：

- **Document state**：可持久化、可撤销的数据。
- **Editor state**：选中项、面板展开、时间轴缩放、播放头等会话状态。
- **Runtime state**：播放、缓存、导出进度、临时 Blob URL。

文档修改必须经过 command：

```ts
type MotionCommand =
  | { type: 'layer.add'; payload: AddLayerPayload }
  | { type: 'layer.update'; payload: UpdateLayerPayload }
  | { type: 'keyframe.upsert'; payload: UpsertKeyframePayload }
  | { type: 'preset.apply'; payload: ApplyPresetPayload }
```

撤销/重做保存 command 前后的最小 patch；拖动过程中只更新预览，pointerup 时合并成一个历史项，避免一次拖拽产生数百步撤销。

## 8. 渲染与播放

### 8.1 舞台

- DOM/SVG 作为 P0 舞台渲染器，利于文字、SVG 和样式编辑。
- 图层输出统一 transform，优先使用 `translate3d/scale/rotate/opacity`。
- 使用 `requestAnimationFrame` 驱动播放；编辑暂停时只在状态变化后重采样。
- 图片和视频使用代理尺寸预览，原文件仅在导出读取。

### 8.2 GSAP 的位置

GSAP 可用于编辑器 UI 动画和预设生成参考，但持久化模型不能保存 GSAP timeline 实例。核心播放应由可序列化轨道采样驱动；必要时创建临时 GSAP timeline 作为播放器适配层，但导出仍以标准采样为真值。

### 8.3 性能预算

- P0 标准工程：1920×1080、30fps、10 秒、20 图层、80 条属性轨道。
- 播放时不触发 React 全树每帧 render；通过 CSS custom properties、refs 或隔离渲染层更新。
- 时间轴只渲染可见轨道，缩放和横向滚动使用虚拟窗口。

## 9. 时间轴实现

时间轴拆为四层：时间标尺、播放头、图层条、关键帧层。统一使用：

```ts
px = timeMs * pixelsPerMs
timeMs = snap(px / pixelsPerMs, 1000 / fps)
```

P0 交互：单击定位、拖动播放头、关键帧拖动、框选、Delete 删除、`Space` 播放/暂停、`Home/End` 跳转。缩放锚点保持在鼠标或播放头位置，避免视图跳动。

## 10. 预设系统

```ts
type MotionPreset = {
  id: string
  version: 1
  name: string
  category: 'entrance' | 'emphasis' | 'exit' | 'text'
  supportedLayerTypes: MotionLayer['type'][]
  defaultDurationMs: number
  build(input: PresetBuildInput): MotionTrackPatch[]
}
```

首批建议 18 个：Fade、Slide 四方向、Scale、Pop、Bounce、Elastic、Rotate In、Blur In、Wipe（P1）、Typewriter（P1）、Stagger Up/Down（P1）、Fade Out、Scale Out。

预设库最终目标不少于 40 个。预设、模板和组件是三个不同层级：预设生成一个或多个动画轨道；模板包含场景、图层、素材占位和动画；组件是文件内或跨文件复用并允许实例覆盖的可更新对象。三者不得共用一个含糊的数据结构。

## 10.1 模板库架构

```ts
type MotionTemplateManifest = {
  id: string
  version: number
  name: string
  category: string
  tags: string[]
  cover: { type: 'image' | 'video'; path: string }
  variables: TemplateVariable[]
  document: MotionDocument
  requiredFeatures: MotionFeatureKey[]
}
```

- 官方模板以只读版本化资源发布，禁止模板升级静默改写用户项目。
- 个人模板存入 IndexedDB，并可随 `.disy` 项目包或单独模板包导出。
- 模板素材使用 manifest 相对引用和内容哈希，避免 Data URL 与重复媒体。
- 模板实例化时生成新的 scene/layer/keyframe id，同时保留 `sourceTemplateId/version` 用于兼容提示。
- 模板变量至少覆盖文字、图片、颜色、字体、比例和场景开关。
- 模板搜索索引与编辑器主体解耦，支持分类、标签、收藏和最近使用。

## 10.2 动效组件

- 组件定义保存内部图层树、轨道和可公开属性。
- 实例只保存源组件 id、源版本和 override patch。
- 源组件更新必须提供差异预览；冲突的实例覆盖优先保留。
- 跨项目复用时打包依赖素材和字体信息，不保留悬空引用。

## 11. 导出方案与技术尖峰

第 1 周必须用原型验证以下矩阵后再锁定实现：

| 路线 | 优点 | 风险 | 定位 |
|---|---|---|---|
| WebCodecs + Canvas | 性能好、浏览器原生 | 容器封装与兼容复杂 | 首选验证 |
| ffmpeg.wasm | 格式灵活 | 包体、内存、启动慢 | 兼容/转码备选 |
| MediaRecorder | 实现快 | 帧稳定性和编码控制弱 | 仅原型或降级 |
| 服务端渲染 | 稳定、可扩展 | 成本、账号、上传隐私 | P2 以后 |

P0 建议先保证 WebM，再按验证结果增加 MP4。导出器按固定时间步逐帧采样，不复用实时播放时钟。导出前检查跨域素材、字体加载、视频解码、内存预算和不支持效果。

Lottie 只导出兼容子集：transform、opacity、基础 shape/path。视频、CSS blur、复杂混合模式和部分文字拆分需阻止导出或栅格化；不得承诺“任意工程 1:1 Lottie”。

导出中心使用统一任务协议：

```ts
type ExportJob = {
  id: string
  sceneIds: string[]
  format: 'webm' | 'mp4' | 'gif' | 'lottie' | 'png' | 'frames'
  width: number
  height: number
  fps: number
  quality: number
  transparent: boolean
  status: 'queued' | 'preflight' | 'rendering' | 'encoding' | 'done' | 'failed' | 'cancelled'
}
```

每种格式实现 `preflight → render → encode → package` 四段接口。这样批量导出、透明背景、帧序列和未来桌面/服务端渲染可复用任务层，不需要重写编辑器。

## 12. 跨工作空间传递

设计 → 动效采用不可变资产快照：

1. 将设计节点输出保存为项目资产。
2. 创建 MotionLayer，记录 `assetId`、原始尺寸和来源元数据。
3. 后续设计资产变化不自动覆盖动效；用户主动选择“更新来源”。

动效 → 设计把导出结果作为视频/GIF/Lottie 资产插入，不把动效内部轨道塞入设计节点。

## 13. 存储与迁移

- 为 motion document 建 Zod schema，读取时校验。
- 每个 schema 版本提供纯函数 `migrateVnToVn1`。
- 自动保存使用 500–1000ms debounce；切换画布与 `visibilitychange` 时 flush。
- 媒体继续存 IndexedDB，文档只保存 mediaId/assetId，不保存大型 Data URL。
- 项目导入前沿用现有备份机制；迁移失败不覆盖原工作区。

## 14. 测试策略

### 单元测试

- easing 边界与插值。
- 时间/像素/帧换算。
- 关键帧排序、覆盖和删除。
- 预设生成结果。
- schema 迁移与非法数据拒绝。
- command undo/redo。

### 集成测试

- 创建动效工作空间并刷新恢复。
- 导入图片、应用预设、修改关键帧。
- 设计素材发送到动效。
- 导出成功、取消和失败重试。

### 视觉与导出验收

- 在 0%、25%、50%、75%、100% 采样点比较舞台与导出帧。
- 预置黄金工程：文字、SVG、图片、视频各一个。
- Chrome/Edge 当前稳定版；Windows 为首期主验收平台。

## 15. 安全与资源管理

- 不执行导入 SVG 中的脚本、外链和事件属性；进入舞台前净化。
- 跨域媒体需先转为本地 Blob 或经允许的 relay 获取。
- 导出任务提供取消，并在完成/失败后释放 canvas、decoder 和 Blob URL。
- 对画布尺寸、时长、图层数、文件大小设软警告和硬上限。

## 16. 开工前技术门槛

2026-08-28 前必须完成并评审：

- 工作空间 kind/schema 方案及旧项目迁移测试。
- MotionDocument 与轨道采样原型。
- 10 秒动画的 WebM/MP4 导出尖峰报告。
- `App.tsx` 与 MotionWorkspace 的边界代码骨架。
- 一份包含性能、格式、包体和兼容性的导出路线决策记录。

任一项未通过，不进入完整时间轴开发。
