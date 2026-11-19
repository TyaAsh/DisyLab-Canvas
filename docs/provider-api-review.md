# 厂商 API 文档巡检

检查日期：2026-11-19（Asia/Shanghai）。范围由 `src/apiProviders.ts` 的在售厂商决定，不限 HFSY。Muse API / Muse 账号已退役；HFSY 仍是独立支持的厂商。

## 覆盖与来源

| 厂商 | 官方来源 | 本次检查 |
| --- | --- | --- |
| HFSY | https://www.hfsyapi.cn/docs/api · https://www.hfsyapi.cn/api/docs | 已读取动态文档数据，schemaVersion=1，73 个文档记录（包含工具配置及别名，不代表 73 个账户可用模型） |
| GRS AI | https://grsai.com/documents/chat | 官网文档入口可访问；动态正文需要后续巡检继续读取 |
| 万象 API | https://relayonapi.com/docs | 本次浏览读取失败；不能据此认定模型已下架 |
| MiniMax | https://platform.minimax.io/docs/api-reference/video-generation-v2-create | 官方 H3 文档及索引可访问 |
| xAI | https://docs.x.ai/overview | 官方模型、图像、视频及文本 API 索引可访问 |
| 火山方舟 | https://docs.volcengine.com/docs/ark/model-list?lang=zh | 官方模型页可访问，包含 Seedance / Seedream 等家族 |
| 即梦 | https://bytedance.larkoffice.com/wiki/FVTwwm0bGiishxkKOoScdHR2nsg | 本次浏览读取失败；账号授权模式不使用通用 /models 刷新 |
| APIMart | https://docs.apimart.ai/ | 官方模型元数据和各生成 API 文档入口可访问 |
| OpenAI | https://developers.openai.com/api/docs/models | 官方模型页可访问 |
| Gemini | https://aistudio.google.com/docs/models | 官方模型页可访问 |
| RunningHub | https://www.runninghub.cn/runninghub-api-doc-cn/ | 官方接入说明可访问；模型和 LLM API 的密钥权限与工作流 API 不同 |
| 自定义 | 用户配置的接口地址 | 按 /models 获取目录；未知厂商没有可推断的官方文档地址 |

## HFSY 本次核对

动态页面脚本读取公开 `/api/docs`，并结合 `/api/pricing` 展示目录。对话使用 `/v1/chat/completions`；原生图像、视频使用各自的 create/query 接口。文档中包含 GPT Image 2.6、Nano Banana 2.1、Seedream 5.5、SD 2.5 和 Wan 3.0 等记录；现有适配器已有这些家族的处理。文档提及的模型不直接加入账户列表，必须由认证模型目录返回。

## 更新机制与边界

- Codex 周期巡检：每 6 小时判断一次是否到期，只有随机 48–72 小时的文档巡检期限到达后才工作；检查所有支持厂商，记录变化，验证本地适配。Codex 不可运行期间无法执行，恢复后补检查。
- 项目运行时：每连接随机 48–72 小时同步模型目录；每 15 分钟及页面恢复/联网时检查是否到期，初次启动或无记录立即同步。项目关闭期间不运行。
- 目录同步只更新模型可见性、名称、能力分类与默认勾选；复杂的新端点/参数由文档巡检核实并测试后更新适配代码，不将任意网页文本直接当成可执行配置。
- 推荐模型为各账户实际返回的 GPT、Claude、DeepSeek 主流代表；已有列表会补推荐。用户之后的明确启停优先。
- 网络、权限错误或空目录保留最后成功的目录，6 小时后重试，不假装更新成功。用户授权型厂商不走通用 API Key 目录请求。
