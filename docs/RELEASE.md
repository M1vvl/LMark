# LMark 发布与更新

## 数据边界

- 程序：安装在用户选择的安装目录，只由安装器和自动更新替换。
- 私有设置：`%APPDATA%\LMark`，包括加密后的 API 配置、主题、聊天历史和浏览器会话。
- 默认笔记：`%APPDATA%\LMark\Projects`；用户可以在设置中改到任意目录。
- `Mission`、开发机 `release`、源码目录中的个人文件不会进入安装包。
- 卸载或更新不会删除 `%APPDATA%\LMark` 和笔记目录。

API 密钥使用 Electron `safeStorage` 与当前 Windows 用户绑定加密。安装包和 GitHub Release 中不包含任何用户的密钥。

## 发布范围

客户端只检查 GitHub 上最新的非草稿、非预发布 Release，不提供稳定版/测试版或指定版本选择。维护者可以使用带 `-beta` 或 `-rc` 的标签在 GitHub Actions 中生成预发布包进行内部验证，但预发布包不会被客户端自动更新采用。

稳定发布使用 `x.y.z` 版本和 `vx.y.z` Git 标签。不要复用版本号，也不要覆盖已经发布的 Release。

## 发布

1. 在 `package.json` 更新版本号。
2. 执行 `npm run release:check` 和 `npm test`。
3. 提交代码并创建对应的 `v...` 标签。
4. 推送标签。GitHub Actions 只构建 Windows 目录版并生成便携 ZIP，再将便携包上传到 Release。
5. 下载便携 ZIP，在干净 Windows 用户中验证启动、数据隔离、升级和回滚。
6. 验证完成后在 GitHub 将 Draft 发布。客户端的“检查更新”和开启“自动更新”只会读取已发布的稳定 Release。

## 回滚

GitHub 中必须永久保留历史 Release 和安装器。新版本失败时：

1. 暂停或撤回有问题的 Release，避免继续更新。
2. 用户从前一个 GitHub Release 重新安装旧版程序。
3. 不删除或还原 `%APPDATA%\LMark` 和笔记目录。

设置迁移必须向前兼容。每次增加数据结构版本时，在 `src/main/storage/` 新增显式迁移，先备份设置，再迁移；不得移动、重写或上传用户笔记。
