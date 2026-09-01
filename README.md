# LMark

LMark 是面向 Windows 11 的本地知识工作区。推荐双击 `release/启动最新版 LMark.lnk`，实际运行文件位于 `release/win-unpacked/`。

## 数据格式

- 笔记是带 YAML 前置的标准 Markdown 文件，正文和图片可由其他 Markdown 工具直接读取。
- 标题、文档备注与文字注释保存在同一个 `.md` 文件的 YAML 前置中，不依赖私有数据库。
- 图片复制到项目的 `assets/` 文件夹，并以相对 Markdown 路径引用。
- API 密钥只加密保存在当前 Windows 用户目录中，不写入源码或 release。

## 主要模块

- `src/renderer/modules/knowledge-workspace.js`：知识编辑器协调层。
- `src/renderer/modules/knowledge/frontmatter.js`：YAML 前置和注释数据。
- `src/renderer/modules/knowledge/selection-toolbar.js`：选中文字的浮动格式栏。
- `src/main/notes/pdf-export.js`：使用 Electron 打印引擎导出 A4 PDF。
- `src/renderer/modules/i18n.js`：中文与英文界面切换。
- `src/main/ai/` 与 `src/renderer/ai-sidecar.*`：OpenAI 兼容 API 和外部 AI 侧栏。
- `src/main/wallpaper-engine.js`：本地图片、视频和 Wallpaper Engine 项目解析。
- `src/renderer/modules/leisure/`：休闲区游戏。

## 开发

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm start
```

## 发布与隐私

- 正式安装包使用 NSIS；自动更新通过 GitHub Releases 和 `electron-updater`。
- `%APPDATA%\LMark` 与用户选择的笔记目录永远不进入安装包，也不会被程序更新覆盖。
- 发布前必须执行 `npm run privacy:audit`。完整流程见 `docs/RELEASE.md`。
- 稳定版使用 `x.y.z`，测试版使用 `x.y.z-beta.n`；历史 GitHub Release 必须保留用于程序回滚。

项目不再包含本地翻译模型、llama.cpp、PaddleOCR 或 Poppler 运行时。
