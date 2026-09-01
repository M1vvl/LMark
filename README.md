# LMark

LMark 是一款面向 Windows 11 的开源桌面知识工作区，用于组织本地 Markdown 笔记、整理学习内容，并在需要时接入 AI 辅助阅读与写作。

它适合用来：

- 建立个人知识库和长期学习档案
- 按工作栏、项目和知识文件管理本地资料
- 编辑带图片、公式、文字样式、高亮和备注的 Markdown 笔记
- 通过 OpenAI 兼容 API 整理知识，并将结果保存到当前项目
- 在可调整宽度的附着窗口中使用 API 对话或浏览器 AI
- 预览 PDF，并将整理后的笔记导出为 PDF

LMark 将程序与用户资料明确分开。应用更新只替换程序文件，不覆盖笔记、项目、API 配置或对话历史。

## 设计原则

- **文件优先**：笔记保存在用户可直接访问的 `.md` 文件中，图片使用项目内的相对路径，不依赖封闭数据库。
- **基于标准**：笔记使用 Markdown 和 YAML front matter，可由常见文本编辑器和 Markdown 工具继续读取。
- **本地优先**：默认项目位于 `%APPDATA%\LMark\Projects`，也可以选择其他保存位置。没有 LMark，文件仍然属于用户。
- **隐私优先**：API 密钥使用 Electron `safeStorage` 与当前 Windows 用户绑定加密，不进入源码、安装包或 GitHub Release。
- **AI 可选**：不配置 AI 也能完整管理和编辑本地笔记；配置后可使用 OpenAI 兼容 API，或打开 ChatGPT、Claude、Kimi、DeepSeek 浏览器工作区。
- **模块化**：知识编辑、AI、项目管理、主题、Wallpaper Engine、MCP 和休闲区均按模块组织，便于独立维护。
- **可恢复更新**：稳定版与测试版分开发布，用户数据与程序更新隔离，并保留历史 Release 作为回滚来源。

## 当前功能

### 本地知识工作区

- 可伸缩工作栏以及多工作栏、项目和知识文件层级
- 项目文件夹同步创建、重命名、打开、置顶和删除
- 标准 Markdown 编辑与预览
- 字体、字号、加粗、下划线、文字颜色和自定义高亮
- 图片插入、数学公式显示、文档备注和选中文字注释
- PDF 拖入预览与笔记导出 PDF
- 中文与 English 界面切换

### AI 工作区

- OpenAI 兼容 API 端点、模型与请求协议配置
- 模型列表读取、连接测试、请求中断和推理强度选择
- 独立附着式聊天窗口，可调整宽度或隐藏
- 新建对话、历史对话、删除历史以及 Fork 对话
- 选中文字后询问 AI，并将整理后的回答写入项目 Markdown 文件
- 浏览器 AI 工作区及独立窗口模式

### 个性化与扩展

- 本地图片、视频与 Wallpaper Engine 项目主题
- 内置 MCP 服务，可搜索、读取、创建和追加本地笔记
- 工作区与休闲区切换
- 小恐龙和俄罗斯方块小游戏

## 安装

Windows 11 用户可从 [GitHub Releases](https://github.com/M1vvl/LMark/releases) 下载最新稳定版。首次公开版本为 `v0.1.0`。

安装和更新不会删除 `%APPDATA%\LMark`、用户选择的项目目录或 Markdown 笔记。卸载时也默认保留用户数据。

## 本地开发

环境要求：

- Windows 11
- Node.js 22+
- npm

```powershell
git clone https://github.com/M1vvl/LMark.git
cd LMark
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm start
```

常用检查：

```powershell
npm run privacy:audit
npm run release:check
```

代码入口和主要模块位于：

- `src/main.js`：Electron 主进程与 IPC 协调
- `src/main/storage/`：用户数据目录、设置迁移和隐私边界
- `src/main/ai/`：OpenAI 兼容协议适配
- `src/main/notes/`：笔记导出
- `src/main/updater/`：GitHub Releases 自动更新
- `src/main/mcp-server.js`：本地知识 MCP 服务
- `src/renderer/modules/knowledge/`：Markdown 富文本编辑与注释
- `src/renderer/modules/leisure/`：休闲区游戏
- `src/renderer/modules/sidebar-visual/`：工作栏视觉与交互

更完整的发布、数据迁移与回滚规则见 [`docs/RELEASE.md`](docs/RELEASE.md)。

## 数据与安全

以下内容不会进入安装包或 GitHub 仓库：

- 用户的 Markdown 笔记、附件和项目目录
- API 密钥与私人 API 配置
- AI 对话历史和浏览器登录状态
- 开发者电脑上的个人路径、运行数据和本地构建产物

每次发布都必须通过隐私审计、版本校验和自动化测试。安全问题请通过 GitHub 仓库的私密联系方式报告，不要在公开 Issue 中提交密钥、私人笔记或账号信息。

## 发布通道

- 稳定版：`v0.1.0`、`v0.2.0`
- 测试版：`v0.2.0-beta.1`

推送版本标签后，GitHub Actions 使用仓库内置的 `GITHUB_TOKEN` 构建 Windows 安装程序并创建 Draft Release。维护者验证安装、升级、数据隔离和回滚后再公开发布。

## 许可证

LMark 使用 [MIT License](LICENSE) 发布。
