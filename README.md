<h1 align="center">HanakoPro</h1>

<p align="center">基于官方 Hanako v0.194.2 的增强版 AI Agent 桌面应用</p>

<p align="center">
  <a href="https://github.com/ZS520L/HanakoPro/releases">下载 Release</a>
  ·
  <a href="https://github.com/ZS520L/HanakoPro/issues">反馈问题</a>
  ·
  <a href="https://github.com/liliMozi/openhanako">上游项目 OpenHanako</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License"></a>
  <a href="https://github.com/liliMozi/openhanako"><img src="https://img.shields.io/badge/base-Hanako%20v0.194.2-purple.svg" alt="Base"></a>
  <a href="https://github.com/ZS520L/HanakoPro/releases"><img src="https://img.shields.io/badge/platform-Windows-lightgrey.svg" alt="Platform"></a>
</p>

---

## 项目说明

HanakoPro 是我基于官方 Hanako v0.194.2 分支源码开发的增强版本。

这个仓库不是官方原版 Hanako，而是在保留原版 AI Agent、记忆、多工具调用、桌面端界面等基础能力的前提下，重点增强了日常使用和开发调试体验。

当前重点面向 Windows 使用场景，主要改进集中在：文件修改可视化、终端运行日志查看、消息撤回、插话 / 打断体验、记忆系统、系统提示词与工具描述自定义、桌宠以及前端消息展示细节。

## 主要特性

### 支持Deepseek strict模式

支持选择开启deepseek beta模式，提高工具调用准确性。

<p align="center">
  <img src="image/deepseek官方对strict模式的介绍.png" width="100%" alt="deepseek官方对strict模式的介绍">
</p>

<p align="center">
  <img src="image/支持strict模式提升工具调用准确性.png" width="100%" alt="支持strict模式提升工具调用准确性">
</p>

### 文件 Diff 展示

HanakoPro 支持在对话中直接展示 AI 对文件的修改结果。新增、删除和变更内容会以 Diff 形式呈现，方便快速确认 AI 改了什么。

<p align="center">
  <img src="image/修改文件展示差异.png" width="100%" alt="修改文件展示差异">
</p>

### 文件编辑打字机效果

AI 写入或编辑文件时，会以打字机效果逐步展示修改过程，实时反馈当前编辑位置和写入进度，让文件变更状态一目了然。

<p align="center">
  <img src="image/文件编辑打字机效果.png" width="100%" alt="文件编辑打字机效果">
</p>

### 内置终端实时日志

支持在对话中嵌入终端运行结果，可以直接查看程序运行日志、命令输出和执行状态。终端输出支持流式更新，实时反映命令执行进度。

<p align="center">
  <img src="image/内置终端流式更新日志.png" width="100%" alt="内置终端流式更新日志">
</p>

### 消息撤回

支持撤回消息，方便在误发送、上下文不合适或想重新组织指令时回退对话。

### 插话体验优化

在 AI 流式回复过程中，用户可以更自然地追加新指令。新的插话机制确保追加的指令被及时捕获和响应，不再需要等待当前回复完全结束再操作。

### 打断体验优化

全面优化打断逻辑：降低打断后会话不可用、上下文丢失或后续继续失败的概率。打断后会话能够安全恢复，上下文保持完整，后续对话可以正常衔接。

### 前端消息展示优化

优化对话流中的思考块、工具调用块、终端卡片和文件修改卡片的展示逻辑，减少内容错位、覆盖、换行丢失等问题。辅助视觉元素经过精细调整，整体界面一致性更好。

<p align="center">
  <img src="image/辅助视觉前端优化.png" width="100%" alt="辅助视觉前端优化">
</p>

### 记忆系统优化

记忆前端展示效果全面升级：
- **分条展示**：每条记忆独立呈现，方便逐一查看和管理
- **快速跳转定位**：支持点击记忆项直接跳转到对应对话位置
- **简化维护**：更直观的增删改操作，降低记忆管理成本

<p align="center">
  <img src="image/记忆前端优化.png" width="100%" alt="记忆前端优化">
</p>

<p align="center">
  <img src="image/简化记忆系统.png" width="100%" alt="简化记忆系统">
</p>

### 系统提示词与工具描述自定义

系统提示词和工具描述全量开放，支持用户自定义：
- **系统提示词**：可以完全自定义 AI 的行为准则、角色设定和工作方式，不再受限于内置模板
- **工具描述**：支持自定义每个工具的功能说明、参数描述和使用指引，让 AI 更精准地使用工具
- **完全透明**：所有 Prompt 内容对用户可见，不存在隐藏指令
- **性能可控**：自定义内容的长短和复杂度由用户自主决定

<p align="center">
  <img src="image/支持自定义系统提示词.png" width="100%" alt="支持自定义系统提示词">
</p>

<p align="center">
  <img src="image/支持自定义工具描述.png" width="100%" alt="支持自定义工具描述">
</p>

### 桌宠

新增桌面桌宠，让 AI 陪伴更自然地融入桌面环境：
- **后台提问**：通过桌宠即可发起对话，不必始终停留在主界面
- **形象自定义**：支持更换桌宠的视觉形象，打造个性化的 AI 伙伴

<p align="center">
  <img src="image/桌宠效果.png" width="100%" alt="桌宠效果">
</p>

<p align="center">
  <img src="image/桌宠形象支持自定义.png" width="100%" alt="桌宠形象支持自定义">
</p>

### Windows 安装体验优化

Windows 安装包支持选择安装路径，不再只能使用默认安装位置。

## 相比官方 Hanako v0.194.2 的主要改动

- 增加文件 Diff 展示。
- 增加文件编辑打字机效果。
- 增加内置终端流式更新日志。
- 增加消息撤回支持。
- 优化插话体验：流式回复中可自然追加新指令。
- 优化打断体验：降低打断后会话不可用、上下文丢失的概率。
- 优化前端消息展示细节：思考块、工具块、终端卡片、文件编辑卡片展示更稳定。
- 优化辅助视觉元素：整体界面一致性提升。
- 记忆系统前端重构：支持分条展示、快速跳转定位、简化管理。
- 系统提示词全量开放：支持用户自定义。
- 工具描述全量开放：支持用户自定义。
- 新增桌宠：支持后台提问、形象自定义。
- 修复部分流式消息块顺序和覆盖问题。
- 修复 Windows 终端输出中部分换行丢失的问题。
- 改进 CRLF / CR / ANSI 控制符处理。
- Windows 安装包支持修改安装路径。

## 下载

请前往 Releases 下载 Windows 安装包：

```text
https://github.com/ZS520L/HanakoPro/releases
```

当前发布版本：

```text
HanakoPro v0.194.6
```

Windows 用户下载 `.exe` 安装包即可。

> Windows SmartScreen 可能会提示未知发布者。如果你信任该版本，可以点击"更多信息" → "仍要运行"。这是未购买代码签名证书时的常见现象。

## 从源码运行

### 环境要求

- Node.js 22 LTS 或更高版本。
- npm 10 或更高版本。
- Windows 建议安装 Visual Studio Build Tools 2022，并勾选 C++ 桌面开发组件。
- 首次运行需要配置可用的模型服务，例如 OpenAI 兼容接口、DeepSeek、Ollama 等。

### 启动开发版

```bash
npm ci
npm run start:dev
```

### 常见问题

如果启动时报 `better-sqlite3.node was compiled against a different Node.js version`，说明原生模块和当前 Node ABI 不匹配，执行：

```bash
npm rebuild better-sqlite3
```

如果终端相关能力异常，可以执行：

```bash
npm rebuild node-pty
```

## 自行打包

Windows 打包命令：

```bash
npm run dist:win
```

需要注意：Windows 打包配置会引用 `vendor/git-portable`。该目录体积较大，源码仓库默认不包含它。如果你要自己打包 Windows 安装包，需要自行准备 `vendor/git-portable`，或修改 `package.json` 中的 `build.win.extraResources` 配置。

如果打包时遇到 Node.js heap out of memory，可以临时提高 Node 堆内存：

```powershell
$env:NODE_OPTIONS="--max-old-space-size=8192"
npm run dist:win
```

## 与上游项目的关系

HanakoPro 基于官方 Hanako v0.194.2 分支源码开发。

上游项目：

```text
https://github.com/liliMozi/openhanako
```

本项目不是官方原版 Hanako 发布，功能、问题和维护节奏以本仓库为准。

## 许可证

本项目沿用上游项目许可证：

```text
Apache License 2.0
```

详见 [LICENSE](LICENSE)。
