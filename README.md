## 通过 CDP 操控 Gemini 网页版，实现 AI 生图、对话、图片提取等自动化操作。
<!-- PROJECT SHIELDS -->

<div align="center">

  <a href="https://github.com/WJZ-P/gemini-skill/graphs/contributors">
    <img src="https://img.shields.io/github/contributors/WJZ-P/gemini-skill.svg?style=flat-square" alt="Contributors" style="height: 30px">
  </a>
  &nbsp;
  <a href="https://github.com/WJZ-P/gemini-skill/network/members">
    <img src="https://img.shields.io/github/forks/WJZ-P/gemini-skill.svg?style=flat-square" alt="Forks" style="height: 30px">
  </a>
  &nbsp;
  <a href="https://github.com/WJZ-P/gemini-skill/stargazers">
    <img src="https://img.shields.io/github/stars/WJZ-P/gemini-skill.svg?style=flat-square" alt="Stargazers" style="height: 30px">
  </a>
  &nbsp;
  <a href="https://github.com/WJZ-P/gemini-skill/issues">
    <img src="https://img.shields.io/github/issues/WJZ-P/gemini-skill.svg?style=flat-square" alt="Issues" style="height: 30px">
  </a>
  &nbsp;
  <a href="https://github.com/WJZ-P/gemini-skill/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/WJZ-P/gemini-skill.svg?style=flat-square" alt="License" style="height: 30px">
  </a>

</div>

<br>

<!-- PROJECT LOGO -->

<p align="center">
  <a href="https://github.com/WJZ-P/gemini-skill/">
    <img src="markdown/gemini-color.svg" alt="Logo" width="96" height="96">
  </a>
</p>

<h1 align="center">Gemini Skill</h1>

<p align="center">
  <a href="#-使用">快速开始</a>
  ·
  <a href="https://github.com/WJZ-P/gemini-skill/issues">报告 Bug</a>
  ·
  <a href="https://github.com/WJZ-P/gemini-skill/issues">提出新特性</a>
</p>

<p align="center">
  <a href="./README.en.md">English</a> | 中文
</p>

<br>


<p align="center">
  <a href="https://www.bilibili.com/video/BV1e54y1z7XM">
    <img src="markdown/home.png" alt="纯蓝">
  </a>
</p>
<h2 align="center">

「剥开了尖刺 &nbsp; 却正如你曾经说

赖以生存的温柔只是白纸

盛着破碎的梦和我们的故事」

</h2>

## 目录

- [功能特性](#-功能特性)
- [架构](#️-架构)
- [安装](#-安装)
- [配置](#️-配置)
- [使用](#-使用)
- [MCP 工具列表](#-mcp-工具列表)
- [Daemon 生命周期](#-daemon-生命周期)
- [项目结构](#-项目结构)
- [注意事项](#️-注意事项)
- [To Do List](#-to-do-list)
- [License](#-license)

<br>

<!-- EXAMPLE -->

<p align="center">
  <img src="./markdown/example.png" alt="Gemini 生图示例" width="100%">
</p>

<p align="center"><em>▲ 通过 AI 对话自动生成表情包</em></p>

<br>

## ✨ 功能特性

|  | 功能 | 说明 |
|:---:|------|------|
| 🎨 | **AI 生图** | 发送 prompt 自动生成图片，支持高清原图下载 |
| 💬 | **文本对话** | 与 Gemini 进行多轮对话 |
| 🖼️ | **图片上传** | 上传参考图片，基于参考图生成新图 |
| 📥 | **图片提取** | 提取会话中的图片，支持 base64 和 CDP 完整尺寸下载 |
| 🔄 | **会话管理** | 新建会话、临时会话、切换模型、导航到历史会话 |
| 🧹 | **自动去水印** | 下载的图片自动移除 Gemini 水印 |
| 🤖 | **MCP Server** | 标准 MCP 协议接口，可被任何 MCP 客户端调用 |

<br>

## 🏗️ 架构

```
┌─────────────────────────────────────────────────────┐
│                   MCP Client (AI)                   │
│              Claude / CodeBuddy / ...               │
└──────────────────────┬──────────────────────────────┘
                       │ stdio (JSON-RPC)
                       ▼
┌─────────────────────────────────────────────────────┐
│               mcp-server.js (MCP 协议层)            │
│         注册所有 MCP 工具，编排调用流程              │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│            index.js → browser.js (连接层)           │
│   ensureBrowser() → 自动拉起 Daemon → CDP 直连      │
└──────────┬──────────────────────────────┬───────────┘
           │ HTTP (acquire/status)        │ WebSocket (CDP)
           ▼                              ▼
┌──────────────────────┐    ┌─────────────────────────┐
│   Browser Daemon     │    │     Chrome / Edge        │
│  (独立后台进程)       │───▶│   gemini.google.com     │
│  daemon/server.js    │    │                         │
│  ├─ engine.js        │    │  Stealth + 反爬检测      │
│  ├─ handlers.js      │    └─────────────────────────┘
│  └─ lifecycle.js     │
│     30 分钟惰性销毁   │
└──────────────────────┘
```

**核心设计理念：**

- **Daemon 模式** — 浏览器进程由独立 Daemon 管理，MCP 调用结束后浏览器不关闭，30 分钟无活动才自动释放
- **按需自启** — Daemon 未运行时 MCP 工具会自动拉起，无需手动启动
- **Stealth 反爬** — 使用 `puppeteer-extra-plugin-stealth` 绕过网站检测
- **职责分离** — `mcp-server.js`（协议层）→ `gemini-ops.js`（操作层）→ `browser.js`（连接层）→ `daemon/`（进程管理）

<br>

## 📦 安装

### 前置条件

- **Node.js** ≥ 18
- **Chrome / Edge / Chromium** — 系统上需安装任一浏览器（或通过 `BROWSER_PATH` 指定路径）
- 浏览器需提前 **登录 Google 账号**（Gemini 需要登录才能使用）

### 安装依赖

```bash
git clone https://github.com/WJZ-P/gemini-skill.git
cd gemini-skill
npm install
```

<br>

## ⚙️ 配置

所有配置通过环境变量或 `.env` 文件设置。项目根目录已提供 `.env` 模板，可直接修改。

**配置优先级：** `process.env` > `.env.development` > `.env` > 代码默认值

> `.env.development` 不会被 git 追踪，适合存放本地私有配置（如浏览器路径）。

### 浏览器配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `BROWSER_PATH` | 自动检测 | 浏览器可执行文件路径，支持 Chrome / Edge / Chromium。不设则自动按优先级检测系统已安装的浏览器 |
| `BROWSER_DEBUG_PORT` | `40821` | CDP 远程调试端口。多个 skill（如 douyin-upload-mcp-skill）共享同一端口即共享同一浏览器实例 |
| `BROWSER_HEADLESS` | `false` | 是否无头模式。首次使用建议关闭（`false`），方便登录 Google 账号 |
| `BROWSER_USER_DATA_DIR` | 自动解析 | 浏览器用户数据目录，保存登录态、cookies 等。不设则自动解析：`~/.wjz_browser_data` → 浏览器默认目录 |
| `BROWSER_PROTOCOL_TIMEOUT` | `60000` | CDP 协议超时时间（毫秒）。生图等长操作可适当增大 |

### Daemon 配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DAEMON_PORT` | `40225` | Daemon HTTP 服务端口 |
| `DAEMON_TTL_MS` | `1800000` | 闲置超时时间（毫秒），默认 30 分钟。超时后自动关闭浏览器并退出 Daemon，下次调用时自动重新拉起 |

### 其他配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OUTPUT_DIR` | `./gemini-image` | 图片输出目录 |

### 关于 OpenClaw 浏览器复用

[OpenClaw](https://github.com/) 的默认 CDP 端口是 **18800**。如果你希望复用 OpenClaw 已启动的浏览器会话，可以将 `BROWSER_DEBUG_PORT` 改为 `18800`：

```env
BROWSER_DEBUG_PORT=18800
```

**但请注意**：OpenClaw 自带的浏览器会话**没有集成 Stealth 反爬插件**，在反检测能力上不如本项目自行维护的浏览器实例。本项目使用 `puppeteer-extra-plugin-stealth` 提供了完整的反爬保护（隐藏 webdriver 标记、模拟真实浏览器指纹等），能更好地规避网站的自动化检测。

**建议**：除非有特殊需求，推荐使用默认端口 `40821`，让项目自行管理浏览器实例以获得最佳的反爬效果。

<br>

## 🚀 使用

### 方式一：作为 MCP Server（推荐）

在 MCP 客户端配置文件中添加：

```json
{
  "mcpServers": {
    "gemini": {
      "command": "node",
      "args": ["<项目绝对路径>/src/mcp-server.js"]
    }
  }
}
```

启动后 AI 即可通过 MCP 协议调用所有工具。

### 方式二：命令行启动

```bash
# 启动 MCP Server（stdio 模式，供 AI 客户端调用）
npm run mcp

# 单独启动 Browser Daemon（通常不需要，MCP 会自动拉起）
npm run daemon

# 运行 Demo 示例
npm run demo
```

### 方式三：作为库调用

```javascript
import { createGeminiSession, disconnect } from './src/index.js';

const { ops } = await createGeminiSession();

// 生图
const result = await ops.generateImage('画一只可爱的猫咪', { fullSize: true });
console.log('图片保存至:', result.filePath);

// 用完断开（不关浏览器，由 Daemon 继续守护）
disconnect();
```

<br>

## 🔧 MCP 工具列表

### 核心生图

| 工具名 | 说明 | 主要参数 |
|--------|------|----------|
| `gemini_generate_image` | 完整生图流程（耗时 60~120s） | `prompt`, `newSession`, `referenceImages`, `fullSize`, `timeout` |

### 会话管理

| 工具名 | 说明 | 主要参数 |
|--------|------|----------|
| `gemini_new_chat` | 新建空白对话 | 无 |
| `gemini_temp_chat` | 进入临时对话模式 | 无 |
| `gemini_navigate_to` | 导航到指定 Gemini URL（如历史会话） | `url`, `timeout` |

### 模型与对话

| 工具名 | 说明 | 主要参数 |
|--------|------|----------|
| `gemini_switch_model` | 切换模型（pro/quick/think） | `model` |
| `gemini_send_message` | 发送文本并等待回复（耗时 10~60s） | `message`, `timeout` |

### 图片操作

| 工具名 | 说明 | 主要参数 |
|--------|------|----------|
| `gemini_upload_images` | 上传图片到输入框 | `images` |
| `gemini_get_images` | 获取会话中所有图片元信息 | 无 |
| `gemini_extract_image` | 提取图片 base64 并保存本地 | `imageUrl` |
| `gemini_download_full_size_image` | 下载完整尺寸高清图片 | `index` |
| `gemini_share_latest_image` | 为图片创建公开分享链接并返回 `https://gemini.google.com/share/...` | `index`, `timeout`, `copyToClipboard`, `closeDialog` |

### 文字回复

| 工具名 | 说明 | 主要参数 |
|--------|------|----------|
| `gemini_get_all_text_responses` | 获取所有文字回复 | 无 |
| `gemini_get_latest_text_response` | 获取最新一条文字回复 | 无 |

### 诊断与管理

| 工具名 | 说明 | 主要参数 |
|--------|------|----------|
| `gemini_check_login` | 检查 Google 登录状态 | 无 |
| `gemini_probe` | 探测页面元素状态 | 无 |
| `gemini_reload_page` | 刷新页面 | `timeout` |
| `gemini_browser_info` | 获取浏览器连接信息 | 无 |

<br>

## 🔄 Daemon 生命周期

```
首次 MCP 调用
  │
  ├─ Daemon 未运行 → 自动 spawn（detached + unref）
  │                    → 轮询等待就绪（最多 15s）
  │
  ├─ GET /browser/acquire → 启动/复用浏览器 + 重置 30 分钟倒计时
  │
  ├─ MCP 工具执行完毕 → disconnect()（断开 WebSocket，不关浏览器）
  │
  ├─ 30 分钟内再次调用 → 重置倒计时（续命）
  │
  └─ 30 分钟无人使用 → 关闭浏览器 + 关闭 HTTP 服务 + 退出进程
                         （下次调用时自动重新拉起）
```

**Daemon API 端点：**

| 端点 | 说明 |
|------|------|
| `GET /browser/acquire` | 获取浏览器连接（会续命） |
| `GET /browser/status` | 查询浏览器状态（不续命） |
| `POST /browser/release` | 主动销毁浏览器 |
| `GET /health` | Daemon 健康检查 |

<br>

## 📁 项目结构

```
gemini-skill/
├── src/
│   ├── index.js               # 统一入口
│   ├── mcp-server.js          # MCP 协议服务（注册所有工具）
│   ├── gemini-ops.js          # Gemini 页面操作（核心逻辑）
│   ├── operator.js            # 底层 DOM 操作封装
│   ├── browser.js             # 浏览器连接器（面向 Skill）
│   ├── config.js              # 统一配置中心
│   ├── util.js                # 工具函数
│   ├── watermark-remover.js   # 图片去水印（基于 sharp）
│   ├── demo.js                # 使用示例
│   ├── assets/                # 静态资源
│   └── daemon/                # Browser Daemon（独立进程）
│       ├── server.js          # HTTP 微服务入口
│       ├── engine.js          # 浏览器引擎（launch/connect/terminate）
│       ├── handlers.js        # API 路由处理器
│       └── lifecycle.js       # 生命周期控制（惰性销毁倒计时）
├── references/                # 参考文档
├── SKILL.md                   # AI 调用规范（MCP 客户端读取）
├── package.json
└── .env                       # 环境配置（需自行创建）
```

<br>

## ⚠️ 注意事项

1. **首次使用需登录** — 第一次运行时浏览器会打开 Gemini 页面，请手动完成 Google 账号登录。登录状态会保存在 `userDataDir` 中，后续无需重复登录。

2. **不要同时运行多个实例** — 同一个 CDP 端口只能有一个浏览器实例，否则会端口冲突。

3. **Windows Server 注意** — 已内置路径规范化和 Safe Browsing 绕过，但仍建议检查：
   - Chrome/Edge 已正确安装
   - 输出目录有写入权限
   - 防火墙未阻断 localhost 通信

4. **生图耗时较长** — 通常 60~120 秒，MCP 客户端的 `timeoutMs` 建议设为 ≥ 180000（3 分钟）。

<br>

## 📝 To Do List

- [x] **MCP 协议全量工具注册**
- [x] **Daemon 进程按需自启**
- [x] **高清原图 CDP 下载**
- [x] **自动去水印**
- [x] **参考图上传 & 图生图**
- [x] **历史会话导航**
- [ ] **多浏览器实例并行支持**
- [ ] **支持音乐生成**
- [ ] **支持视频生成**
<br>

## 📄 License

该项目签署了 MIT 授权许可，详情请参阅 [LICENSE](https://github.com/WJZ-P/gemini-skill/blob/main/LICENSE)

## LINUX DO

本项目支持 [LINUX DO](https://linux.do) 社区

<br>

## 如果觉得好用，请给个 ⭐ 支持一下！

## ⭐ Star 历史

[![Stargazers over time](https://starchart.cc/WJZ-P/gemini-skill.svg?variant=adaptive)](https://starchart.cc/WJZ-P/gemini-skill)
