<p align="center">
  <img src=".github/assets/banner.jpg" width="100%" alt="OpenHanako Banner">
</p>

<p align="center">
  <img src=".github/assets/Hanako-280.png" width="80" alt="Hanako">
</p>

<h1 align="center">HanakoPro</h1>

<p align="center">基于 Hanako 的图形化 AI Agent 增强版</p>

<p align="center"><a href="README_EN.md">English</a></p>

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)](https://github.com/ZS520L/HanakoPro/releases)

---

## HanakoPro 是什么

HanakoPro 是基于官方 Hanako v0.194.2 分支源码构建的增强版 AI Agent。它保留了 Hanako 有记忆、有性格、会主动行动、多 Agent 协同工作的基础能力，并在开发体验、对话体验、终端日志查看和 Windows 安装体验上做了进一步增强。

作为助手，Ta 是温柔的：不需要写复杂的配置，不需要理解晦涩的术语。HanakoPro 不只面向 coder，而是为每一个坐在电脑前工作的人设计的助手。
作为工具，Ta 是强大的：记住你说过的每一件事，操作你的电脑，浏览网页，搜索信息，读写文件，执行代码，管理日程，还能自主学习新技能。

我开这个项目的初衷是：弥合绝大多数人和 AI Agent 之间的缝隙，让强大的 Agent 能力不再只局限于命令行里。于是我做了比传统 Coding Agent 更多一些的优化：一方面是强化 Agent「像人」的属性，是你和他们沟通更自然；另一方面，因为我本职也是一介文员，所以我也针对日常办公场景做了很多工具性和流程性的优化，敬请探索。
此外，HanakoPro 有比较完备的图形页面。

如果你用过 claude code、codex、Manus 等 CLI 或是图形化的 Agent，你会在 HanakoPro 这里找到熟悉又新奇的感觉。

## 功能特性

**文件 Diff** — 支持在对话中直接查看 AI 对文件的创建、修改和删除差异，新增 / 删除行清晰高亮，方便确认代码改动。

**内置终端实时日志** — 支持在对话中嵌入终端会话，实时查看程序运行日志、命令输出和执行状态，不需要频繁切换窗口。

**消息撤回** — 支持撤回消息，便于回退误发送或不满意的对话上下文。

**插话与打断优化** — 优化流式回复过程中的插话、打断和会话恢复体验，降低上下文丢失或后续继续失败的概率。

**记忆** — 结合主流的记忆方案，自己又发挥了一下，做了个记忆系统，近期的事情记得非常牢固，但目前确实有待优化。

**人格** — 不是千篇一律的"AI 助手"。通过人格模板和自定义人格文件塑造独特的性格，每个 Agent 都有自己的说话方式和行为逻辑，Agent 之间分离做得很好，备份方便，Agent 就是文件夹，后续还会添加备份功能。

**工具** — 读写文件、执行终端命令、浏览网页、通过浏览器后端或 API 搜索互联网、截图、媒体预览、检查网页。能力覆盖日常办公的绝大多数场景。

**SKILLS 支持** — 内置兼容庞大 SKILLS 社区生态，之外，我也做了一些主动的优化：有时候干活之前，Agent 会从 GitHub 安装社区技能，Agent 也可以自己编写并学会新技能，有比较不错的主动性。当然，默认情况给 Agent 做了比较严格的 SKILLS 审核，如果发现 SKILLS 装不上可以自行关闭。

**角色卡与技能包** — Agent 可以导入 / 导出为本地优先的角色卡 zip，按白名单携带人格、头像、可选记忆和 Skills。Skill Bundle 是独立的技能包基础设施，可以在技能管理页分组、拖拽、成组启用，并单独导出为 zip，方便迁移和分享。

**多 Agent** — 创建多个 Agent，各自有独立的记忆、人格和定时任务。Agent 之间可以通过频道群聊协作，也可以互相委派任务。

**书桌** — 每个 Agent 都有自己的书桌，可以放文件、写笺（类似便签，Agent 会主动读取并执行）。支持拖拽操作，文件预览，是你和 Agent 之间的异步协作空间。

**全屏媒体查看器** — 聊天里或书桌上的任意图片、SVG、视频，点开就是暗色遮罩的全屏预览：滚轮缩放、拖拽平移，`+` / `−` / `0` 键盘快捷，左右箭头在同会话或同目录的相邻媒体间切换。

**定时任务与心跳** — Agent 可以设置定时任务（Cron），也会定期巡检书桌上的文件变化。你不在的时候，Ta 也能按计划自主工作。

**安全沙盒** — 双层隔离：应用层 PathGuard 四级访问控制 + 操作系统级沙盒（macOS Seatbelt / Linux Bubblewrap / Windows AppContainer）。Agent 的权限在你的掌控之中。平时只能访问工作目录和一些用户文件，如果你想调整权限，可以在设置 → 安全页面修改沙盒级别。

**插件系统** — 约定优先的可扩展插件架构。拖拽安装社区插件，插件可以贡献工具、技能、命令、Agent 模板、HTTP 路由、事件钩子、LLM Provider、页面、侧栏 Widget、配置 schema 和后台任务。路由可直接访问核心服务（PluginContext 注入），通过 Session Bus 与 Agent 对话、获取历史、管理 session。两级权限模型（restricted / full-access）保障安全。

**多平台接入** — 同一个 Agent 可以同时接入 Telegram、飞书、QQ、微信机器人，在任何平台和 Ta 对话，可以远程操作电脑。

**国际化** — 界面支持中文、英文、日文、韩文、繁体中文 5 种语言。

**Windows 安装体验** — Windows 安装包支持修改安装路径。

## 截图

### 主界面

<p align="center">
  <img src=".github/assets/screenshot-main.jpg" width="100%" alt="HanakoPro 主界面">
</p>

### 文件 Diff

<p align="center">
  <img src="image/diff.png" width="100%" alt="HanakoPro 文件 Diff 展示">
</p>

### 内置终端实时日志

<p align="center">
  <img src="image/terminal.png" width="100%" alt="HanakoPro 内置终端实时日志">
</p>

## 快速开始

### 下载安装

**macOS（Apple Silicon / Intel）**：从 [Releases](https://github.com/ZS520L/HanakoPro/releases) 下载最新 `.dmg`。

应用已通过 Apple Developer ID 签名和公证，macOS 应该可以直接打开。

**Windows**：从 [Releases](https://github.com/ZS520L/HanakoPro/releases) 下载最新 `.exe` 安装包。

> **Windows SmartScreen 提示：** 安装包暂未经过代码签名，首次运行时 Windows Defender SmartScreen 可能会拦截，点击**更多信息** → **仍要运行**即可，未签名版本的正常现象。

**Linux**：从 [Releases](https://github.com/ZS520L/HanakoPro/releases) 下载最新 `.AppImage` 或 `.deb`。

### 首次运行

首次启动时，引导向导会带你完成配置：选择语言、输入你的名字、连接模型提供商（API key + base URL），并选择三个模型：**对话模型**（主对话）、**小工具模型**（轻量任务）、**大工具模型**（记忆编译和深度分析）。设置页还可以单独选择**视觉模型**，让文本模型通过 Vision Bridge 处理图片附件。HanakoPro 支持 OpenAI 兼容、Anthropic 风格、OAuth Provider 和 Ollama 本地模型等多类接入。
目前也添加了 OpenAI 的 OAuth 登录，鉴于 Anthropic 会有封号风险，所以暂时不提供。

## 架构

```
core/           引擎编排层 + Manager（含 PluginManager）
lib/            核心库（记忆、工具、沙盒、Bridge 适配器）
server/         Hono HTTP + WebSocket 服务（独立 Node.js 进程）
hub/            调度器、频道路由、事件总线
desktop/        Electron 应用 + React 前端
shared/         跨层共享工具（config schema、error bus、模型引用等）
plugins/        内置系统插件（随应用打包）
skills2set/     内置技能定义
scripts/        构建工具（server 打包、启动器、签名）
tests/          Vitest 测试
```

引擎层协调多个 Manager（Agent、Session、Model、Preferences、Skill、Channel、BridgeSession、Plugin 等），通过统一的 facade 暴露。Hub 负责后台任务（心跳巡检、定时任务、频道路由、Agent 间通信、DM 路由），独立于当前聊天会话运行。

Session 内的用户可见文件通过 `SessionFile` sidecar 统一登记，桌面端、Bridge 和未来移动端按各自能力消费同一份文件身份。Bridge 平台媒体发送规则见 `.docs/BRIDGE-MEDIA-CAPABILITIES.md`，插件文件贡献规则见 `PLUGINS.md`。

本机 staged 文件优先由各平台 adapter 直接上传：Telegram / 飞书 / 微信走各自上传接口，QQ 走官方 Bot 分片上传接口，再发送 `msg_type: 7` 富媒体消息。`preferences.bridge.mediaPublicBaseUrl` / `HANA_BRIDGE_PUBLIC_BASE_URL` 只用于仍需公网 URL 的平台或远程 fallback；该 URL 作为 `/api/bridge/media/:token` 临时文件路由的 origin，文件本身仍由短期 token、下载次数和本地路径白名单保护。Hana 不会自动开启公网 tunnel，公网入口必须由用户显式提供。

Server 以独立 Node.js 进程运行（由 Electron spawn 或独立启动），通过 Vite 打包，@vercel/nft 追踪依赖。与 Electron 渲染进程通过 WebSocket 通信。
用户数据目录由 `HANA_HOME` 决定（生产默认 `~/.hanako`，开发默认 `~/.hanako-dev`）。Pi SDK 自己的数据隔离在 `${HANA_HOME}/.pi/` 下。

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面端 | Electron 38 |
| 前端 | React 19 + Zustand 5 + CSS Modules |
| 构建 | Vite 7 |
| 服务端 | Hono + @hono/node-server |
| Agent 运行时 | [Pi SDK](https://github.com/nicepkg/pi) |
| 数据库 | better-sqlite3（WAL 模式） |
| 测试 | Vitest |
| 国际化 | 5 语言（zh / en / ja / ko / zh-TW） |

## 平台支持

| 平台 | 状态 |
|------|------|
| macOS (Apple Silicon) | 已支持（已签名公证） |
| macOS (Intel) | 已支持 |
| Windows | Beta |
| Linux | 已支持（AppImage / deb） |
| 移动端 (PWA) | 计划中 |

## 开发

```bash
# 安装依赖
npm install

# Electron 启动（自动构建 renderer）
npm start

# Vite HMR 开发（需先运行 npm run dev:renderer）
npm run start:vite

# 运行测试
npm test

# 类型检查
npm run typecheck
```

## 许可证

[Apache License 2.0](LICENSE)

## 链接

- [HanakoPro Releases](https://github.com/ZS520L/HanakoPro/releases)
- [提交 Issue](https://github.com/ZS520L/HanakoPro/issues)
- [安全页](https://github.com/ZS520L/HanakoPro/security)
- [上游项目 OpenHanako](https://github.com/liliMozi/openhanako)
- [安全政策](SECURITY.md)
- [插件开发指南](PLUGINS.md)
- [贡献指南](CONTRIBUTING.md)
