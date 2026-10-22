# 公开发布

0.8.0 按免费开源测试版准备。分发包可直接给朋友；社区目录尚未提交，Windows 与移动端尚待真机验收。

## 生成并检查

```sh
npm ci --ignore-scripts
npm test
npm run build
npm run test:portable
npm run package:share
```

公开源代码由 `scripts/package-share.mjs` 的白名单导出到 `releases/public-source/`。**只从这个目录创建公开仓库**；不要将开发工作区整体上传，它可能含有个人课程文件或历史测试记录。

安装包为 `releases/Lingua-Atelier-0.8.0-beta.zip`，另有源代码 ZIP 和 `SHA256SUMS.txt`。安装包没有模型、笔记、录音、API 密钥、真实个人配置或开发者的固定路径。用户点击后才下载模型与组件。

## GitHub + BRAT

1. 在自己的 GitHub 账户创建新的 **public** 仓库，建议命名 `lingua-atelier`，上传 `public-source/` 中的源码。不要覆盖已有的其他项目。
2. 仓库包含 README、LICENSE、manifest、versions、源码、测试、独立组件和发布 workflow。
3. 创建标签 **0.8.0**，必须与 manifest 一致，无 `v` 前缀。附带的 workflow 会构建并创建 GitHub **草稿预发布**；检查后再发布。
4. Release 必须单独附加 `main.js`、`manifest.json`、`styles.css`。不能只放 ZIP；Obsidian / BRAT 不会从 ZIP 中解压这些文件。
5. 同时附加分享 ZIP、源代码 ZIP 和校验文件，供手动安装与桌面组件安装使用。
6. 公开 Release 后，朋友在 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 中添加该 GitHub 仓库地址即可安装并检查后续版本。BRAT 只安装插件文件；启用后由用户在快速设置中选择并下载模型。

本插件没有内置自我更新，更新交给 Obsidian / BRAT。下载与环境安装只在用户点击后运行，录音期间不要更新或重载。

当前含用户手动触发的桌面依赖安装器。官方社区政策禁止插件安装或更新自身依赖，因此此版本通过 GitHub / BRAT 测试分发，尚不能宣称满足社区上架条件。正式提交前需要继续将桌面安装拆到独立组件，或依据 Obsidian 审核意见调整。内置本地推理的执行代码已随插件打包。

## Obsidian 社区目录

依据 2026-10-20 查阅的[官方发布流程](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)：

1. 先公开 GitHub 源码与对应 Release。
2. 登录 [Obsidian Community](https://community.obsidian.md/)，连接自己的 GitHub 账户，添加插件仓库。
3. 提交者阅读并接受[开发者政策](https://docs.obsidian.md/community-directory/developer-policies)及维护要求，处理自动审核反馈。
4. 审核并发布通过后，用户才能在 Obsidian 插件市场直接安装。

正式提交前建议补齐 Windows / Android / iOS 真机录音与权限测试，以及独立桌面组件在新电脑上的完整安装记录。准备了移动端 manifest 并不等于完成真机验收。

## 发布边界

- 插件免费开源，第三方文字 API 由使用者自行付费与配置。
- 分享给朋友安装，是各自使用同一个工具。多人实时编辑同一份笔记需要另行选择同步／协作机制。
- 当前定位是 Obsidian 插件；独立桌面或手机 App 是另一阶段产品，不是把插件 ZIP 改名即可上架 App Store。
