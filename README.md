# Lingua Atelier

外语学习中的录音、双语字幕、结构化笔记和思维导图，放在同一个 Obsidian 工作台。

[项目源码](https://github.com/Rseam-07/lingua-atelier) · [安装包与版本](https://github.com/Rseam-07/lingua-atelier/releases) · [问题反馈](https://github.com/Rseam-07/lingua-atelier/issues)

A local-first foreign-language learning notebook for Obsidian. Currently supports **Chinese, English and French**. Free, open source, and currently a **0.8.0 public beta**.

## 能做什么

- 边录音边生成中文、英语或法语原文及中文译文；原始音频分段保存，可回听和重试。
- 结合原句整理课堂主题与要点，生成可缩放、折叠的 Markmap 导图。
- 使用原生 Markdown 保存笔记，导出 SRT 双语字幕及 Obsidian Canvas。
- 一键归档测试与课堂记录；重整内容前保留版本，手写区域保留。
- 第一次打开提供引导：分别选择语音和文字模型，点击下载、检查，之后直接录音。
- 手机可尝试内置本地 Whisper 与 Qwen 文字模型，无需电脑；也可选在线识别或在线翻译。
- 桌面保留 Qwen3-ASR 增强识别和已有 Ollama；下载本地组件前必须手动点击。
- 内置使用提示，支持下载进度、文件校验、失败重试和模型加载检查。

自动识别、翻译和笔记都可能有误，嘈杂教室与中法句内切换尤其需要回听。这里使用约 4–10 秒音频分段，不是逐词流式字幕；没有经过人工标注的准确率测试，不能承诺固定识别率。

当前支持中文、英语和法语。英语／法语可单独选择；自动混合模式与双路核对目前针对中法课堂，尚未提供三语自动路由。

## 平台状态

| 平台 | 插件与笔记 | 语音处理 | 验证状态 |
| --- | --- | --- | --- |
| Mac · Apple Silicon | Markdown、字幕、整理与导图 | 本机 Qwen3-ASR 1.7B / MLX；麦克风及可选系统音频 | 已在 M4 / 24 GB 的原型上使用；发布包另做自动回归 |
| Windows x64 | 同一份插件 | 可接已有服务；附实验性 Qwen / Transformers 安装器，优先 NVIDIA GPU | 尚未 Windows 真机验收；CPU 不保证实时速度 |
| Mac · Intel | 同一份插件 | 连接已有服务或实验性 Transformers CPU 后端 | 尚未真机验收 |
| Android / iPhone / iPad | 同一份插件、首次引导、笔记和导图 | 可选设备本地 Whisper / Qwen 文字模型，或手机直连在线服务；连接电脑为高级选项 | 无 Node 加载、网络与离线工作线程测试；移动端本地模型、麦克风、内存与锁屏仍需真机验收 |

需要 **Obsidian 1.11.4+**（SecretStorage API）；已验证的桌面版本为 1.14.4。Apple Silicon 的本地识别组件需要能运行对应 MLX 版本的 macOS，最低 macOS 14。移动端本地模式使用轻量模型而非桌面的 1.7B Qwen-ASR，不保证嘈杂课堂准确率或实时速度；锁屏持续录音不在当前测试版承诺范围。

## 安装

当前可通过 BRAT 安装，或使用分享 ZIP 手动安装。尚未上架 Obsidian 社区目录。

1. 解压 `Lingua-Atelier-0.8.0-beta.zip`。
2. Mac / Windows：结束录音、关闭 Obsidian，运行 `Install-Mac.command` 或 `Install-Windows.ps1`，按提示选择仓库。脚本只复制本插件的三个文件，并备份旧文件，不修改密钥、其他插件或仓库外观。
3. 也可把 `lingua-atelier/` 文件夹复制到仓库的 `<配置目录>/plugins/`。默认配置目录是 `.obsidian`；移动端可在可访问的仓库目录复制，或通过 BRAT 安装。
4. 打开 Obsidian，在第三方插件中启用 Lingua Atelier，然后打开插件设置。

## 第一次打开：三个步骤

1. **选语音模型**：手机选“本地 · 当前设备”，再选 Whisper Tiny（约 42 MB）、Base（约 77 MB）或 Small（约 241 MB）；Mac / Windows 也可选择桌面 Qwen3-ASR。点击“下载 / 修复”，等文件校验和首次加载通过。也可选择在线识别，无需下载语音模型。
2. **选文字处理**：本地 Qwen2.5 0.5B（约 496 MB）或较大的 1.5B（约 1.5 GB），同样手动下载；或选择自己的 DeepSeek / 百炼 API。已有 Ollama 可继续使用。0.5B 只适合轻量体验，法语翻译、长文和结构化整理可能有明显错误。
3. 点击 **“检查并完成”**，阅读内置使用提示，先试录一分钟；确认字幕、翻译和保存正常后再上完整课程。

以后打开 Obsidian 即可开始录音，不必重新下载模型或打开终端。模型不随安装包预置，首次下载需要网络与足够空间。本地推理的 JS / WebAssembly 已包含在插件文件中，不从 CDN 动态加载代码。模型数据保存到当前仓库配置目录中本插件的 `local-models/`；请留意同步软件的排除规则，避免把数百 MB 模型同步到其他设备。

**手机离线模式仍为测试功能。** 语音轻量模型建议至少 4 GB 设备内存，0.5B 文字模型建议至少 6 GB；这些是建议，不能据此保证加载成功。插件轮换加载语音与文字模型，减少同时占用。低内存设备、旧系统可能无法运行；可选择“本地识别 + 在线文字”或全部在线。不保证实时速度，也不保证后台 / 锁屏录音。纯本地模式下载完成后不上传音频或文字；在线功能不会作为失败后的静默回退。

在线识别使用阿里云百炼 Qwen3-ASR-Flash，支持中文、英语和法语；北京与新加坡密钥不可混用。只有用户在快速设置中确认后，录音分段才会发送到选择的百炼地域。在线文字处理接收转写和提纲。每位使用者提供自己的密钥，服务商可能收费；DeepSeek 是文字接口，不能用来语音识别。本项目不提供共享 API 额度。

桌面 Qwen 环境可在引导中点击安装，也保留下载包 `desktop-service/Setup-*` 独立安装方式。Apple Silicon 模型约 2.5 GB，Windows / Intel 约 4.7 GB，另需运行环境空间；Windows 无 NVIDIA GPU 时可能很慢。下载过程不会读取笔记或上传录音。

完整说明见 [快速开始](docs/QUICKSTART.md)，发布流程见 [发布说明](docs/PUBLISHING.md)。

## 可选高级方式：手机连接自有电脑

在已安装识别组件的电脑上运行 `Share-to-phone-Mac.command` 或 `Share-to-phone-Windows.ps1`。共享服务使用独立端口 **8183**，需要每台电脑安装时生成的连接密钥，不改变桌面自身的 8182 服务。

手机设置中填写电脑的局域网／VPN 地址和“识别服务连接密钥”。手机上的 `127.0.0.1` 指手机自身。录音将发送到这台电脑处理，笔记和原始音频仍保存在当前 Obsidian 仓库。跨公网应由服务管理者配置 HTTPS；iOS 的本地网络权限与 HTTP 限制需要在实际设备上验证。

## 隐私与外部访问

- 无遥测、广告、账户系统或自建数据收集服务。无需注册本项目账户。
- 原始音频、字幕、会话 JSON、Markdown、Canvas 和重整备份保存在用户仓库。使用 Obsidian Sync 或其他同步工具时，按用户的同步设置处理。
- 内置本地模式只在当前设备处理音频和文字。已有 Qwen／Whisper 服务模式会把音频发送到配置的服务；手机连接电脑时音频到达该电脑。在线识别在明确确认后发送到所选百炼地域。
- 使用远程文字 API 时，转写文字、必要上下文与提纲发送到该服务用于翻译、候选判断和整理；不会通过文字接口发送原始音频。
- API Key 和识别连接密钥使用 Obsidian SecretStorage，不进入笔记或插件 `data.json`。每位使用者自行配置，不附带开发者密钥。
- 桌面版在用户操作时读取配置的模型和可执行文件，并可启动 Python、Whisper、Ollama 或 Mac 系统音频组件。这些路径可能在仓库之外。
- 用户手动点击的本地模型下载访问 Hugging Face 固定版本，权重使用 SHA-256 校验；配置文件需解析为有效 JSON。缓存完整性不足时会要求修复，不自动改用在线服务。
- 独立安装器及快速设置的桌面增强安装器访问 uv 官方 PyPI 分发、Python 包索引及 Python 运行环境下载源、PyTorch 下载源（Windows）及 Hugging Face 下载依赖／模型。下载来源和模型版本在安装器中明确固定；依赖详情见 requirements 文件。推理时设置离线模式。
- 可选系统音频组件源代码在 `native/SystemAudio.swift`。分发的二进制尚未做开发者公证，系统可能阻止运行；可自行从公开源码构建。

## 开发与构建

Node.js 24，`npm ci --ignore-scripts` 后运行：

```sh
npm test
npm run build
npm run test:portable
npm run package:share
```

`dist/lingua-atelier/` 是构建结果。`releases/` 中的 ZIP 由明确的文件白名单生成，不包含笔记、音频、个人配置、API Key、开发运行环境或模型权重。公开源代码包包含运行测试所需的源码与合成测试资料；个人录音基准脚本不发布。

Python 契约测试使用隔离环境安装 `fastapi`、`httpx`、`python-multipart` 和 `numpy` 后运行 `python -m unittest discover -s tests -p '*_test.py'`。不需要真实课堂录音或模型权重。

## 致谢与许可

本项目代码使用 [MIT License](LICENSE)。[Markmap](https://github.com/markmap/markmap) 用于 Markdown 导图；[DOMPurify](https://github.com/cure53/DOMPurify) 用于清理导图 HTML（采用其 Apache-2.0 许可选项）。完整依赖声明随安装包发布，并嵌入 `main.js`，执行代码不从 CDN 加载。

语音模型和推理组件按其各自许可分发或下载：[Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR)、[MLX Audio](https://github.com/Blaizzy/mlx-audio)、[MLX 转换模型](https://huggingface.co/mlx-community/Qwen3-ASR-1.7B-8bit)。Qwen 模型使用 Apache-2.0；本项目安装包不包含模型权重。内置 Whisper 模型遵循其原始许可；Transformers.js 使用 Apache-2.0，ONNX Runtime 与 fflate 使用 MIT。已有 whisper.cpp / Ollama 是高级选项，须自行安装。
