# DisyLab Skill 系统实施手册

**版本**：v1.0（面向 DisyLab v1.0.4）  
**状态**：实施基线  
**适用范围**：浏览器本地优先的个人创作工作台；Cloudflare Pages、Netlify 或 Vercel 部署。  
**不适用范围**：账号体系、共享额度、多租户协作、服务端托管用户密钥。

## 1. 目标与边界

Skill 是可复用的“创作意图 + 参数契约 + 执行策略”单元。它应让同一能力能被画布节点、工作流模板、Agent 和快捷命令一致地发现、校验、预览与执行。

本项目不是新建一条模型调用链。Skill 必须复用既有的多连接配置、`src/imageApi.ts` 生成入口、`src/providerLifecycle.ts` 的异步任务解析，以及现有同源 relay。API Key 继续仅保存于 `sessionStorage`；Skill 及其草稿、任务恢复信息可保存于 IndexedDB。

### 成功标准

1. 官方 Skill 可以配置化新增，不触碰供应商请求实现。
2. Skill 节点能从已连接节点收取类型正确的提示词、图片或视频引用。
3. 视频任务刷新页面后可恢复显示和继续查询；不把“已提交”误写为“已完成”。
4. Agent 只能提议或调用允许的 Skill，付费生成仍沿用现有确认流程。
5. 导入的 Skill 不可能执行 JavaScript、注入请求头、覆盖模型端点或读取 API Key。

## 2. 当前工程事实与设计决定

| 工程事实 | Skill 设计决定 |
|---|---|
| React 19、TypeScript 6、Vite 8 | 使用现有版本；不按旧方案降回 React 18。 |
| `@xyflow/react` 已承担画布与连线 | Skill 是一种节点能力与数据契约，不另起节点编辑器。 |
| `src/imageApi.ts` 已支持图像、视频、超时、任务轮询和多供应商兼容 | 只新增 `SkillRunner` 映射层，禁止 Skill 直接 `fetch` 供应商。 |
| `src/providerLifecycle.ts` 已抽取任务 ID、状态及结果 | 视频恢复复用该层，避免每个 Skill 猜测供应商响应。 |
| APIYI 有同源 relay；其他直连服务需 CORS | Skill 不承诺任意 API 都能纯浏览器直连。 |
| API Key 位于 `sessionStorage`，公开配置在 `localStorage` | Skill 不保存、导出、日志化或显示 API Key。 |
| `localDb.ts` 已管理本地项目/画布 | 扩展现有数据库版本与迁移，不建立第二套孤立持久化规则。 |

## 3. 总体架构

```text
画布节点 / 工作流模板 / Agent 方案 / 快捷命令
                    │
             SkillRegistry
                    │
     Manifest 校验 → 参数解析 → Prompt 渲染
                    │
        SkillRunner（能力与参数映射）
                    │
  imageApi.ts + providerLifecycle.ts + 同源 relay/供应商 CORS
                    │
    输出历史、画布节点状态、IndexedDB 任务恢复记录
```

**关键规则**：Manifest 描述“要做什么”，Runner 决定“怎样调用当前项目的真实模型能力”。前者不可携带 URL、Authorization、任意请求体片段或可执行代码。

## 4. 依赖与目录

新增依赖仅限配置和编辑体验：`zod`、`handlebars`、`idb`；可视化编辑器阶段再引入 CodeMirror。不要为 Skill 再安装另一套画布、状态管理或 HTTP 客户端。

```text
src/
├─ skills/
│  ├─ manifests/official/        # 静态官方 Skill JSON
│  ├─ types.ts                   # Manifest、端口、运行记录类型
│  ├─ manifestSchema.ts           # Zod 白名单校验
│  ├─ registry.ts                 # 官方 + 用户 Skill 查询
│  ├─ prompt.ts                   # 非 HTML 的 prompt 渲染
│  ├─ runner.ts                   # 映射至 imageApi.ts
│  ├─ taskRecovery.ts              # 仅恢复异步任务状态
│  ├─ storage.ts                  # 通过 localDb 的表/迁移访问
│  └─ importExport.ts
├─ skill-ui/                      # 选择器、参数表单、编辑器（后续）
└─ App.tsx                        # 只接入入口与节点状态，不堆积规则
```

## 5. Manifest 协议

### 5.1 最小可发布字段

```ts
type SkillKind = 'image' | 'video'
type PortType = 'text' | 'image' | 'video'

interface SkillManifest {
  id: string                 // 官方：稳定 ID；用户：UUID
  slug: string               // ^[a-z0-9]+(?:-[a-z0-9]+)*$
  version: string            // semver；发布后不可改写
  name: string
  description: string
  kind: SkillKind
  source: 'official' | 'user'
  enabled: boolean
  parameters: SkillParameter[]
  inputs: SkillPort[]
  output: SkillPort
  template: { prompt: string; negativePrompt?: string }
  capability: SkillCapability
  createdAt: number
  updatedAt: number
}

interface SkillParameter {
  name: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'enum'
  required?: boolean
  default?: string | number | boolean
  enum?: string[]
  min?: number
  max?: number
  bind?: 'prompt' | 'aspectRatio' | 'seconds' | 'referenceImages' | 'firstFrame' | 'lastFrame'
}

interface SkillPort { name: string; type: PortType; required?: boolean; multiple?: boolean }
interface SkillCapability {
  supportedModes: string[]   // 必须映射现有 VideoGenerationOptions.mode
  requiresReference?: boolean
  allowedModelCapabilities: ('image' | 'video')[]
}
```

`id + version` 是不可变发布键；`slug` 只是人类可读别名。用户修改已被工作流引用的 Skill 时必须创建新版本，而不是覆盖旧记录。

### 5.2 禁止字段

导入协议不得出现：`baseUrl`、`apiKey`、`headers`、`endpoint`、`fetch`、`script`、`adapter`、HTML 模板、任意对象型 `default_params`。模型选择始终来自已验证的 `ApiConnection` 与启用模型列表。

### 5.3 示例

```json
{
  "id": "official.product-cinematic",
  "slug": "product-cinematic",
  "version": "1.0.0",
  "name": "产品电影感主视觉",
  "description": "生成具有棚拍光影和干净构图的产品主视觉。",
  "kind": "image",
  "source": "official",
  "enabled": true,
  "parameters": [
    { "name": "subject", "label": "产品主体", "type": "string", "required": true, "bind": "prompt" },
    { "name": "aspectRatio", "label": "画面比例", "type": "enum", "enum": ["1:1", "16:9", "9:16"], "default": "16:9", "bind": "aspectRatio" }
  ],
  "inputs": [{ "name": "references", "type": "image", "multiple": true }],
  "output": { "name": "image", "type": "image" },
  "template": { "prompt": "{{subject}}，产品电影感主视觉，棚拍光影，构图干净，细节清晰" },
  "capability": { "supportedModes": ["text2image", "image_reference"], "allowedModelCapabilities": ["image"] },
  "createdAt": 0,
  "updatedAt": 0
}
```

## 6. 校验与 Prompt 渲染

1. 用 Zod 严格解析 Manifest；未知字段默认拒绝，官方包也必须经过同一校验。
2. 命令解析采用显式 token 规则：支持双引号与 `--name value`，拒绝未闭合引号、未知参数、重复必填参数和非有限数字。
3. 渲染时禁止 HTML 转义结果直接进入 prompt。Handlebars 仅允许受控变量与只读 helper；渲染后应限制长度、清理控制字符，而不是把引号转为 `&quot;`。
4. 入参完成校验后，才按 `bind` 映射到 `ImageGenerationOptions` 或 `VideoGenerationOptions`。

## 7. 执行与模型策略

`SkillRunner` 调用现有生成函数，使用用户在设置中已启用的连接和模型。没有匹配能力的模型时，返回可操作提示，不做隐式降级。

```text
validate manifest + form values
  → resolve selected connection/model
  → validate model capability and references
  → render prompt
  → call generateImage / generateVideo in imageApi.ts
  → write existing node/history state
```

图像任务沿用现有请求取消、错误分类与结果记录。视频任务提交后立即保存 `taskId`、连接 ID、模型 ID、节点 ID、开始时间和非敏感参数；轮询由既有 provider lifecycle 解释结果。页面重新打开时，只对未终态的记录恢复查询。默认使用 15 分钟级别超时与退避策略，不使用固定两秒无限轮询。

## 8. 节点与工作流集成

Skill 节点的输入端口由 `inputs` 和可绑定参数生成；连线在创建时验证 `PortType`。运行前再次验证，不能只依赖 UI 拦截。

* 图像输出仅连接图像输入或允许图片引用的参数。
* 视频输出仅连接视频输入；视频未完成时下游节点为 `waiting`，不得把 taskId 当作视频 URL。
* 文本节点输出可绑定到 prompt 参数；多个上游文本按可见、可编辑的组合规则拼接。
* 运行结果写回当前项目和既有历史记录；删除任务来源节点时遵循现有破坏性操作保护。

工作流模板引用 `skillId@version`。加载缺失版本时显示“Skill 不可用”，不自动替换为同 slug 的新版本。

## 9. Agent 集成

第一阶段不把每一个 Skill 直接暴露为独立 LLM function。Agent 使用聚合工具：`searchSkills`、`proposeSkillRun`、`confirmSkillRun`。这样可以控制工具数量、统一权限与确认体验。

Agent 只能提出已启用 Skill、给出经过 schema 校验的参数草案，并显示目标模型、引用媒体与预计的生成类型。用户确认后，复用现有“先方案、后执行”的图片/视频工作流。工具调用结果只返回非敏感状态、结果 URL 或任务状态，绝不回传 Key、完整请求头或 relay 内部信息。

## 10. 存储、导入与迁移

扩展 `localDb.ts` 的数据库版本，建议新增：

| 集合 | 主键 | 内容 |
|---|---|---|
| `skill_manifests` | `id@version` | 用户 Skill 的不可变发布版本 |
| `skill_aliases` | `id` | 当前编辑版本与可见性 |
| `skill_task_recovery` | `taskId` | 非敏感视频恢复信息 |

封面不内联 base64 到 Manifest；应存为现有媒体/资产引用，避免 IndexedDB 配额和导出文件失控。导出 `.disy-skill.json` 只包含 Manifest 与可选公开封面引用，不包含 API Key、任务日志、项目媒体或私有连接信息。

导入流程：读取大小限制 → JSON 解析 → Zod 严格校验 → slug/id 冲突策略（生成新的用户 ID，保留原作者元数据）→ 保存草稿 → 用户发布。重复导入必须幂等或明确提示，不产生 `custom-custom-*` 链式 slug。

## 11. 安全与隐私

* API Key 继续只在 `sessionStorage`，关闭会话清除；Skill 设置页不得复制 Key 到任何持久库。
* APIYI 继续走已有 relay；其他提供商明确要求 CORS。relay 只转发请求，不承担匿名共享额度。
* 自定义 Skill 不能定义 endpoint、header、脚本或 HTML。Prompt 是文本，不允许写入 `dangerouslySetInnerHTML`。
* 生成日志对 base64 媒体、token 和 Authorization 做脱敏；导出项目包同样不含秘密。
* 若未来提供共享额度，必须先引入登录、服务端限流、账单归属、内容审核与审计，而不是扩展前端 Manifest。

## 12. 分阶段计划与验收

### 阶段 A：内部官方 Skill 基础（优先）

实现 types、schema、registry、一个图像 Skill、一个视频 Skill、Runner 和节点类型校验。验收：两种 Skill 都能在现有画布完成一次生成；视频刷新后能恢复状态；Key 不出现在 IndexedDB/localStorage/导出文件中。

### 阶段 B：工作流与 Agent

将 Skill 节点加入模板库、支持版本引用、加入 Agent 提议与确认卡。验收：未确认不发起付费请求；视频下游会等待终态；缺失版本有明确降级提示。

### 阶段 C：用户 Skill 编辑与导入导出

提供有限字段编辑器、测试面板、导入导出与版本发布。验收：恶意/未知字段被拒绝；更新不破坏旧工作流；大封面不造成数据库异常。

### 阶段 D：可观测性与公开测试

补充匿名失败分类、任务恢复统计、模型兼容矩阵和跨部署测试。验收：Cloudflare Pages、Netlify、Vercel 的 relay 路由分别通过提交、轮询和媒体回传测试。

## 13. 测试清单

* Manifest：合法/未知字段/坏 semver/重复端口/非法 enum。
* 解析：中文引号、未闭合引号、重复命名参数、`NaN`、越界数字。
* 渲染：中文、引号、`&`、长 prompt、参考图组合，不出现 HTML 实体。
* 模型：无 Key、连接断开、模型禁用、能力不匹配、CORS 和 relay 错误。
* 视频：提交成功、轮询网络失败后恢复、刷新恢复、成功无 URL、失败、超时、取消。
* 工作流：连线时和执行前均阻断错误类型；下游不消费未完成视频。
* 安全：导入 JSON 无法改变端点/头；`.disy` 与 Skill 导出均不含 Key。

## 14. 实施决策记录

本手册刻意不采用“浏览器把 Key 永久存进 IndexedDB”“Skill 直接 fetch 任意供应商”“每个 Skill 自动变成一个 LLM function”“固定两秒前端轮询”这四种做法。它们看似减少初期代码，实际会破坏本项目现有的会话密钥保护、relay 兼容性、生成确认交互和异步任务可靠性。

Skill 系统的第一目标是让 DisyLab 当前的真实能力结构化、可复用和可验证；不是把模型供应商差异重新复制一遍。

## 15. 漫画分镜 Skill：从外部模板提炼的可复用模式

### 15.1 采用边界

外部的 `niuniu-comic` 包提供了成熟的两阶段漫画生产流程，但其声明为富途内部专有内容，并依赖固定角色资产、私有 `futu-llm-proxy`、Cursor 和 Figma MCP。DisyLab **只采用流程思想和通用数据结构**，不复制“牛牛”角色设定、参考图、结构锁、代理脚本、品牌语言、路径、成本数字或任何 Figma 自动化代码。

可直接采用的设计经验：

* 用户内容以区块为最小语义单元；一个区块中的“小标签 + 正文/要点”不能被工作流自动拆散或重排。
* 把“切割方式”与“视觉风格”分开决策；排版参考图只能影响布局，不得吸收其画风或角色。
* 对有成本的成品生产设置确认闸门：草图选择、构图粗稿确认、素材包生成是三个不同状态。
* 正式可编辑文字不烤进生成图；粗稿可以用占位文案，最终文字由画布文本节点或后续设计工具承载。

### 15.2 新的 Skill 类型：`storyboard_comic`

`storyboard_comic` 不是新的供应商能力，实际仍调用现有 `image` Skill。它是一个受控的工作流编排器，输出草图、构图粗稿和素材清单；只有用户确认后才允许创建批量 image 任务。

```ts
interface StoryboardComicManifest extends SkillManifest {
  kind: 'storyboard_comic'
  workflow: {
    deliveryMode: 'draft_first'
    stages: ['content_review', 'layout_choice', 'composition_review', 'asset_generation']
    layoutPresets: ('spread' | 'vertical' | 'zigzag')[]
    allowedStyles: ('2d' | '3d' | 'hybrid')[]
    layoutReferencePolicy: 'layout_only'
    finalTextPolicy: 'editable_overlay'
    confirmationRequiredBefore: 'asset_generation'
  }
}

interface ComicSection {
  id: string
  label?: string
  body?: string
  points?: string[]
  visualNote?: string
  keepTogether: true
}

interface ComicBoard {
  boardId: string
  sourceSkillId: string
  sections: ComicSection[]
  layoutChoice?: 'spread' | 'vertical' | 'zigzag'
  status: 'draft' | 'layout_pending' | 'composition_pending' | 'approved_for_assets' | 'completed' | 'cancelled'
}
```

### 15.3 用户输入与结构守恒

界面可接受用户给出的“区块 / 小标签 / 主要内容 / 要点 / 画面要求”，但保存时必须转换为 `ComicSection[]`。`keepTogether: true` 表示：同一小标签及其要点必须作为一个连续的逻辑组显示；它可映射为一格或同一区块内相邻的多个小格，但不得在不同章节之间穿插。

`格数: 自动` 的含义应是“由区块及其要点生成一个建议”，而不是任意随机切分。Agent 或规则层需要在内容确认卡中展示：预计格数、每个区块对应的格、哪些要点将共用一个标签。未经用户确认不能改变区块顺序，也不能自行添加编号。

### 15.4 状态机与确认闸门

```text
draft
  → content_review
  → layout_pending       （生成三张低成本布局预览：A/B/C）
  → composition_pending  （用户选布局后，仅生成一张构图粗稿）
  → approved_for_assets  （仅由明确“确认生成素材”动作进入）
  → completed
```

* `layout_pending` 的预览是灰阶/低细节布局，不创建角色 cutout、背景或高成本批量任务。
* `composition_pending` 只允许生成一张构图粗稿。文本可为占位框或低可信预览，不能当作最终文案。
* 任何改动（区块内容、风格、画幅、布局）都使已批准状态失效，退回相应确认步骤。
* 只有显式的 UI 确认按钮能够进入 `approved_for_assets`；不能用模型输出中的“OK”字符串自动触发。

### 15.5 节点、资产与交付映射

| 漫画产物 | DisyLab 表达方式 | 是否可在确认前生成 |
|---|---|---|
| 区块脚本 | 文本节点 + `ComicBoard` 元数据 | 是 |
| A/B/C 切割草图 | 三个低成本图像节点或前端 SVG 预览 | 是 |
| 构图粗稿 | 一个图像节点，状态 `composition_pending` | 是 |
| 角色/主体 cutout | 透明图像资产，带来源面板 ID | 否 |
| 道具、场景、背景 | 可复用资产，带来源面板 ID | 否 |
| 正式文字/气泡 | 文本节点或可编辑覆盖层 | 不烤入图 |

优先用前端 SVG/CSS 生成 A/B/C 线框草图，而不是调用图像模型；这更快、稳定且没有不必要成本。构图粗稿和素材包可调用当前已连接的图像模型，且每个资产记录模型、提示词摘要、源面板和生成时间，沿用既有生成历史。

### 15.6 风格、角色与参考图政策

`2d`、`3d`、`hybrid` 仅是视觉方向，不承诺某一外部品牌的固定角色。若产品未来提供“角色设定集”，它必须由 DisyLab 或用户明确拥有并在项目资产库内选择；角色参考图只可用于该项目请求，不能被导出到 Skill Manifest。

排版参考图使用 `layoutReferencePolicy: 'layout_only'`：系统抽取格数、相对高度、留白和阅读动线，拒绝复制其画风、角色、商标、画面文字或受保护表达。解析结果保存为抽象布局 token（如 `vertical`、`heroRatio`、`gapStyle`），而不是保存来源图的风格描述。

### 15.7 MVP 验收

1. 粘贴两个区块、各含两个要点后，预览中没有跨区块拆散或擅自编号。
2. 用户可选 A/B/C 布局；选定前不创建正式图像任务。
3. 构图粗稿确认前，系统 API 调用日志中没有素材包任务。
4. 点击“修改布局”会使素材确认失效；旧素材仍保留历史但不再标为当前版本。
5. 导出项目包含脚本、布局 token、素材关联和可编辑文字，不包含 API Key、第三方专有角色参考或外部模板代码。

### 15.8 推荐实施位置

漫画 Skill 应在阶段 B 之后、用户自定义 Skill 编辑器之前实现。先交付一个官方 `storyboard_comic` Skill 和三种前端布局预览，验证确认流程与资产关联；之后再开放用户保存的故事板模板。不要在第一版加入 Figma 自动化、分层抠图或专用角色锁定脚本，这些都应是未来独立集成，并需要明确的资产授权与运行环境。

## 16. 漫画 Skill 的可用性路线图

### 16.1 让用户少写、少猜、少等

**从自然语言到结构化脚本。** 用户可以粘贴一段长文，Agent 先提出区块、小标签、要点和推荐格数；界面把每一个建议标为“可编辑”，用户一键接受或改动。保存的始终是结构化区块，避免模型每次重新理解长文。

**用决策卡替代空白表单。** 先问三个真正影响结果的问题：要传达什么、读者是谁、画幅投放在哪里。其余采用默认值，并以卡片呈现“社媒长图 / 横向文章首图 / 方形轮播”“科普 / 故事 / 宣传”“轻快 / 紧张 / 温暖”等选择。

**每一步都给可比较的结果。** A/B/C 不只是布局代号，应附上“阅读路径、预计格数、适合场景、首屏重点”的简短解释；风格对比只在用户主动开启时生成，避免三倍成本。

**支持局部反馈语言。** 用户可直接点某一格说“把情绪从惊讶改成警惕”“这里不要角色，只保留场景”“第 3 格文字放右侧”。系统将反馈绑定至面板 ID，不要求用户重新描述全稿。

### 16.2 让画面真的可控

**区块固定、镜头可变。** 每个面板保存独立的 `message`, `shot`, `subject`, `emotion`, `scene`, `textSafeArea` 字段。重生成某一格时锁住前四项中的用户确认项，只变化被指定的维度。

**镜头节奏检查器。** 在构图粗稿前自动发现连续三个“正面中景”、连续相同表情、信息密度过高、角色缺席过久或文本安全区不足，并以建议而非强制规则提示。

**文字安全区成为一等数据。** 每格添加可拖动的气泡/标题安全区。生成 prompt 带“为文字留空”，但最终文字由 DisyLab 文本节点渲染。这样可稳定支持中文、繁体、英文及后续改稿。

## 执行模式与用户上传（当前实现）

每个 Skill 必须声明一种执行模式，并在 `/` 面板中显示，不再把所有 Skill 都当作提示词预填：

* `instant`（⚡ 直接执行）：适合文案精修、结构化摘要、光影校正、多机位探索等单步任务。选择后立即把 Skill 与当前节点内容、引用素材合成请求，并调用当前节点模型。
* `configured`（◫ 配置后执行）：适合漫画分镜、角色/场景/产品设定、创意 Brief、故事规划等需要用户决策的任务。选择后打开可拖动的磨砂玻璃配置器；确认一次后自动写入节点并执行。用户上传的 Skill 未声明模式时默认采用此模式，避免意外消耗额度。

图像节点与文本节点均可在编辑器内按 `/` 呼出各自 Skill 面板。配置型 Skill 的参数来自 Manifest 的 `parameters`，支持字符串、数字、布尔值与枚举；参数会和节点正文、`@` 引用及项目级提示词一起进入现有生成链路。

### 用户上传 Skill

当前安全包格式为单个 `.disy-skill.json`，也可以选择一个包含多个 JSON Manifest 的文件夹批量导入。导入流程如下：

* 限制单文件 256 KB，先解析 JSON，再用严格 Schema 校验；未知字段和字段类型错误会拒绝导入。
* 禁止 `baseUrl`、`apiKey`、`headers`、`endpoint`、`fetch`、`script`、`adapter` 等可联网或执行代码的字段。自定义 Skill 只能描述参数、输入输出和 Prompt，不获得代码执行权。
* 导入后强制标记为 `source: user`，按 `id@version` 保存到浏览器 IndexedDB；用户可从“管理 Skill”查看或删除。
* 原始 Codex/Claude `SKILL.md`、`.txt` 不能直接作为可执行包。应先转换成 DisyLab Manifest 并预览校验结果；后续可增加只读转换器，但转换动作不能绕过同一套 Schema 与安全检查。

最小 Manifest 需要：`id`、`slug`、`version`、`name`、`description`、`kind`、`execution`、`parameters`、`inputs`、`output`、`template`、`capability`、`enabled`、`source`、`createdAt` 和 `updatedAt`。`kind` 可为 `text`、`image`、`video` 或 `storyboard_comic`。

**角色一致性分层。** 用户资产库中的角色可建立“角色卡”：名称、允许服装、颜色、参考图、不可改变特征。每个请求只引用明确选中的项目资产；若模型输出偏离，提供“保持构图重绘角色”而非全图重做。

**版式不依赖图片模型。** A/B/C、网格、斜切、破框、留白都应由前端 SVG 布局引擎精确生成。模型只负责单格画面，避免它把文字、格线和分割比例画错。

### 16.3 让返工、成本和资产可管理

**三档质量与预算。** 布局预览为零模型成本；构图粗稿低分辨率且限制一张；用户确认后才以正式分辨率批量生成。提交前展示“将生成 X 张、使用当前连接/模型、预计耗时”，不虚构价格。

**差异化重生。** 允许四种动作：重生画面、保持角色只换背景、保持背景只换姿势、保持图像仅改文字。每次操作只产生必要的新任务，并保留前版本可回退。

**素材自动去重与标签。** 角色、道具、背景存入资产库时写入来源项目、风格、透明度、色调、面板 ID 和可复用范围。下次故事板可搜索“同角色 / 同场景 / 同色板”，而不是再生成。

**完整可复现。** 每张图关联：故事板版本、区块、面板、模型、参数摘要、引用资产和确认记录；导出项目时保留这些关系，以便日后重生成或迁移，而不暴露密钥。

### 16.4 让它成为画布的一部分

**故事板视图与画布双向同步。** 故事板视图适合按顺序审稿；画布适合发散、连接参考和复用资产。拖动面板排序会更新故事板，画布中修改引用也会标记对应面板“需要复核”。

**面板依赖图。** 当一个角色或背景资产被多个面板使用时，显示其影响范围；修改角色卡后允许用户选择“仅新面板使用”或“标记 4 个引用面板待重绘”。

**把漫画变成工作流模板。** 常用的“知识卡片”“剧情反转”“步骤教学”“产品功能介绍”等都可以是可配置故事板模板：模板只定义区块角色和节奏，不携带第三方角色、品牌或受保护画风。

**交付不是文件夹，而是可打开的包。** 一键导出应包含最终合成图、可编辑文字层、单格图片、资产清单、`board.json`、README 与许可证/来源说明；使用者可以在 DisyLab 内重新打开它继续编辑。

### 16.5 智能能力，但不越权

* 为每个区块生成“信息是否完整、是否存在歧义、是否需要事实核查”的编辑建议；不把建议伪装成事实。
* 给金融、医疗、法律等主题加可选的“事实待确认”标记，生成前提醒用户复核，而不是由 Skill 自动补全结论。
* 用内容安全和版权风险提示拦截明显的真人仿冒、未授权角色复刻、恶意欺诈画面；提示用户改用原创角色和布局灵感。
* 将 Agent 保持在“提议、整理、解释”角色；任何批量付费生成、覆盖资产、导出外部文件均需要清晰的用户操作。

### 16.6 建议优先级

| 优先级 | 能力 | 价值 |
|---|---|---|
| P0 | 结构化区块、SVG A/B/C、构图确认闸门、局部反馈 | 立即降低返工和误生成。 |
| P1 | 文字安全区、单格差异重生、资产来源与复用 | 让结果能进入真实生产。 |
| P2 | 角色卡、镜头节奏检查、故事板/画布双向同步 | 明显提升连续性与创作体验。 |
| P3 | 模板市场、自动交付包、协作审阅、外部设计工具集成 | 适合产品验证后扩展。 |
