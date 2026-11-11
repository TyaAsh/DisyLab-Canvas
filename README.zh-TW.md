# DisyLab Canvas 2.0

面向設計師與內容創作者的本機優先 AI 無限畫布。可在同一個專案裡整理參考、產生圖像和影片，並保留可重複使用的素材。

[線上體驗](https://disylab.pages.dev/) · [下載 Windows x64 版](https://github.com/TyaAsh/DisyLab-Canvas/releases/tag/v2.0.0) · [简体中文](README.md) · [English](README.en.md)

- Disy Agent 提供專案記憶、任務中心與可設定的團隊角色。產生內容前可在確認卡選擇模型、數量與支援的規格。
- 在對話中使用逐步引導 Skill，或從文字、圖像和影片節點直接套用相容的 Skill。
- 圖層面板可浮動或固定，支援群組、複製、重新命名和拖曳排序。
- Windows 桌面版支援即夢官方 CLI 授權與獨立的 Muse 網頁登入工作階段。macOS 版稍後推出。

在「API 設定」新增自己的廠商連線，再啟用需要的模型。專案保存在本機，可透過 `.disy` 專案包移轉。

使用 Node.js 22.12+、npm 10.8+。執行 `npm ci`、`npm run dev` 啟動，`npm test` 驗證，`npm run build` 產生正式版本。Windows 建置與部署方式見[主說明](README.md)。

DisyLab 為原始碼公開可見的專有軟體。詳見[授權聲明](LICENSE.zh-CN.md)與[第三方聲明](NOTICE.md)。
