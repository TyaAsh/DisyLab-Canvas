<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-black.png" />
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/logo-white.png" />
    <img src="docs/assets/logo-white.png" width="520" alt="DisyLab Logo" />
  </picture>
</p>

<h1 align="center">DisyLab Canvas</h1>

<p align="center">
  <a href="README.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · English
</p>

<p align="center">
  <strong>Keep characters, references, prompts, and every creative attempt on one canvas that grows with your work.</strong>
</p>

<p align="center">
  A local-first AI infinite canvas for designers, commerce creatives, and content creators.
</p>

<p align="center">
  <a href="https://disylab.pages.dev">Live App</a> ·
  <a href="https://tyaash.github.io/DisyLab-Canvas/">Project Site</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#roadmap">Roadmap</a>
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-1.0.5-77bdf2" />
  <img alt="React" src="https://img.shields.io/badge/React-19-149eca" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6-3178c6" />
  <img alt="Vite" src="https://img.shields.io/badge/Vite-8-646cff" />
</p>

> [!IMPORTANT]
> **DisyLab is proprietary source-available software, not open-source software.** Commercial use, sale, rental, white-labeling, redistribution, relicensing, and paid services based on this project or modified versions require prior written permission from the copyright holder. See [LICENSE](LICENSE) and [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).

## Current highlights

- **Skill system:** open image and text Skills with `/`, run instant or configured tasks, and safely import and manage custom Skills.
- **Comic storyboard workflow:** move from content breakdown and layout selection to composition approval and asset generation in one editable node flow.
- **File toolbox:** lightweight image, video, and PDF utilities.
- **Personal workspace and projects:** a unified project home with search, grid/list views, batch selection, and import/export.
- **Interaction and stability fixes:** corrected overlay stacking, hidden dialogs, minimap dragging, and Skill panel readability.
- **Context-aware Disy Agent:** uses the originating project, canvas, selected nodes, references, and conversation history to decide between planning and execution.
- **Background canvas runs:** Agent and media tasks remain attached to their source canvas while users browse other projects.
- **Per-plan model selection:** each image and video confirmation card can select an available connection and model.
- **Recoverable video media:** generated videos are archived locally when possible, with controlled relay recovery for frame capture, trimming, and cropping.

## Core capabilities

- Infinite canvas, node connections, and multi-canvas projects.
- Text, upload, image, video, and Agent workflows.
- Image generation, video generation, trimming, cropping, and frame capture.
- Workflow templates, inspiration library, asset library, and generation history.
- Local-first storage with `.disy` project import and export.
- Configure the API connection you need directly in the app.
- API keys are stored separately and are not embedded in exported project packages.

## Quick start

Node.js 22.12 or newer is required.

```bash
npm install
npm run dev
```

Production checks:

```bash
npm run typecheck
npm test
npm run build
```

## Current scope

DisyLab currently focuses on the browser-based personal creative workflow. Accounts, cloud project sync, real-time collaboration, server-side key custody, public generation credits, and the desktop app are not included yet.

## License

Copyright © 2026 Ash / Tya. All rights reserved. See [LICENSE](LICENSE), [LICENSE.zh-CN.md](LICENSE.zh-CN.md), and [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).
