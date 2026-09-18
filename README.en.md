## Automate Gemini web via CDP — AI image generation, conversations, image extraction, and more.
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
  &nbsp;
  <a href="https://atomgit.com/WJZ-P/gemini-skill">
    <img src="https://atomgit.com/WJZ-P/gemini-skill/star/new_badge.svg" alt="AtomGit Stars" style="height: 30px">
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
  <a href="#-usage">Quick Start</a>
  ·
  <a href="https://github.com/WJZ-P/gemini-skill/issues">Report Bug</a>
  ·
  <a href="https://github.com/WJZ-P/gemini-skill/issues">Request Feature</a>
</p>

<p align="center">
  English | <a href="./README.md">中文</a>
</p>

<br>


<p align="center">
  <a href="https://www.bilibili.com/video/BV1e54y1z7XM">
    <img src="markdown/home.png" alt="Pure Blue">
  </a>
</p>
<h2 align="center">

"Thorns peeled away, &nbsp; yet just as you once said,

The tenderness we clung to is but a blank page,

Cradling shattered dreams and the story we made."

</h2>

## Table of Contents

- [Features](#-features)
- [Architecture](#️-architecture)
- [Installation](#-installation)
- [Configuration](#️-configuration)
- [Atlas Cloud Provider](#-atlas-cloud-provider)
- [Bloome](#-too-lazy-to-set-up-run-gemini-skill-in-the-cloud)
- [Usage](#-usage)
- [MCP Tools](#-mcp-tools)
- [Daemon Lifecycle](#-daemon-lifecycle)
- [Project Structure](#-project-structure)
- [Notes](#️-notes)
- [To Do List](#-to-do-list)
- [License](#-license)

<br>

<!-- EXAMPLE -->

<p align="center">
  <img src="./markdown/example.png" alt="Gemini image generation example" width="100%">
</p>

<p align="center"><em>▲ Auto-generate sticker images through AI conversation</em></p>

<br>

## 🆕 What's New

**v1.1.1** (2026-05) — Adapted to the new model menu UI:

- ✅ Model enum updated: `pro` / `flash` / `flash-lite` (replacing legacy `pro` / `quick` / `think`)
- ✅ Current model read via `.picker-primary-text` innerText
- ✅ Model switching now iterates menu items + matches label text (i18n-safe)
- 🆕 New thinking-depth controls: `getThinkingDepth()` / `setThinkingDepth('standard'|'extended')`
- 🆕 New MCP tool: `gemini_set_thinking_depth`

**v1.1.0** (2026-05) — Adapted to the **May 2026 Gemini UI redesign**:

- ✅ Plus panel button (`gem-icon-button[arialabel="Upload and tools"]`)
- ✅ Send button (`gem-icon-button.send-button`)
- ✅ Download full-size button (`download-generated-image-button` custom element)
- ✅ Image upload completion detection (`.gem-attachment-content.loading`)
- ✅ Status detection compatible with the new `gem-icon-button` wrapper
- ♻️ All selectors retain legacy UI fallbacks — both old and new versions work

<br>

## ☁️ Atlas Cloud Provider

<p align="center">
  <img src="./markdown/atlas-cloud-provider.png" alt="Atlas Cloud Logo" width="100%">
</p>

> Atlas Cloud is a full-modal AI inference platform that gives developers a single AI API to access video generation, image generation, and LLM APIs. Instead of managing multiple vendor integrations, you connect once and get unified access to 300+ curated models across all modalities.
>
> Official link: [https://www.atlascloud.ai/?utm_source=github&utm_medium=link&utm_campaign=gemini-skill](https://www.atlascloud.ai/?utm_source=github&utm_medium=link&utm_campaign=gemini-skill)
>
> Atlas Cloud also offers a new coding plan promotion for more budget-friendly API access:
> `https://www.atlascloud.ai/console/coding-plan`

This repository now includes a **minimal-change** Atlas Cloud provider path:

- Keeps the original Gemini browser automation flow intact
- Adds an OpenAI-compatible Atlas Cloud API provider
- Supports model listing, standard chat completion, and streaming validation
- Makes the project usable as both a Gemini automation skill and a MaaS provider integration example

## ☁️ Too lazy to set up? Run gemini-skill in the cloud

<p align="center">
  <a href="https://bloome.im/agent/join/5ic86aCp?ref=bvsEWoFx">
    <img src="./markdown/Bloome.jpg" alt="Bloome" width="100%">
  </a>
</p>

No Node.js install, no environment setup — click once on [Bloome](https://bloome.im/agent/join/5ic86aCp?ref=bvsEWoFx) and
gemini-skill runs in the cloud, on desktop and mobile. Invite teammates into a group and use it together.

<br>

## ✨ Features

|  | Feature | Description |
|:---:|---------|-------------|
| 🎨 | **AI Image Generation** | Send prompts to generate images, with full-size high-res download support |
| 💬 | **Text Conversations** | Multi-turn dialogue with Gemini |
| 🖼️ | **Image Upload** | Upload reference images for image-to-image generation |
| 📥 | **Image Extraction** | Extract images from sessions via base64 or CDP full-size download |
| 🔄 | **Session Management** | New chat, temp chat, model switching, navigate to historical sessions |
| 🧹 | **Auto Watermark Removal** | Downloaded images automatically have the Gemini watermark stripped |
| 🤖 | **MCP Server** | Standard MCP protocol interface, callable by any MCP client |
| ☁️ | **Atlas Cloud Provider** | Adds an OpenAI-compatible provider for model listing, text generation, and streaming validation |

<br>

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│                   MCP Client (AI)                   │
│              Claude / CodeBuddy / ...               │
└──────────────────────┬──────────────────────────────┘
                       │ stdio (JSON-RPC)
                       ▼
┌─────────────────────────────────────────────────────┐
│            mcp-server.js (MCP Protocol Layer)       │
│          Registers all MCP tools, orchestrates      │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│           index.js → browser.js (Connection Layer)  │
│   ensureBrowser() → auto-start Daemon → CDP link    │
└──────────┬──────────────────────────────┬───────────┘
           │ HTTP (acquire/status)        │ WebSocket (CDP)
           ▼                              ▼
┌──────────────────────┐    ┌─────────────────────────┐
│   Browser Daemon     │    │     Chrome / Edge        │
│  (standalone process)│───▶│   gemini.google.com     │
│  daemon/server.js    │    │                         │
│  ├─ engine.js        │    │  Stealth + anti-detect   │
│  ├─ handlers.js      │    └─────────────────────────┘
│  └─ lifecycle.js     │
│     30-min idle TTL  │
└──────────────────────┘
```

**Core Design Principles:**

- **Daemon Mode** — The browser process is managed by a standalone Daemon. After MCP calls finish, the browser stays alive; it auto-terminates only after 30 minutes of inactivity.
- **On-demand Auto-start** — If the Daemon isn't running, MCP tools will automatically spawn it. No manual startup required.
- **Stealth Anti-detect** — Uses `puppeteer-extra-plugin-stealth` to bypass website bot detection.
- **Separation of Concerns** — `mcp-server.js` (protocol) → `gemini-ops.js` (operations) → `browser.js` (connection) → `daemon/` (process management)

<br>

## 📦 Installation

### Prerequisites

- **Node.js** ≥ 18
- **Chrome / Edge / Chromium** — Any one of these must be installed on your system (or specify a path via `BROWSER_PATH`)
- The browser must be **logged into a Google account** beforehand (Gemini requires authentication)

### Install Dependencies

```bash
git clone https://github.com/WJZ-P/gemini-skill.git
cd gemini-skill
npm install
```

<br>

## ⚙️ Configuration

All configuration is done via environment variables or `.env` files. A `.env` template is provided in the project root — you can edit it directly.

**Priority order:** `process.env` > `.env.development` > `.env` > code defaults

> `.env.development` is git-ignored, making it ideal for local/private settings (e.g. browser path).

### Browser Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `BROWSER_PATH` | Auto-detect | Path to the browser executable (Chrome / Edge / Chromium). If unset, the system's installed browsers are detected automatically by priority |
| `BROWSER_DEBUG_PORT` | `40821` | CDP remote debugging port. Multiple skills (e.g. douyin-upload-mcp-skill) sharing the same port will share the same browser instance |
| `BROWSER_HEADLESS` | `false` | Headless mode. Keep it `false` for first-time use so you can log in to your Google account |
| `BROWSER_USER_DATA_DIR` | Auto-resolve | Browser user data directory for persisting login sessions, cookies, etc. Auto-resolves to `~/.wjz_browser_data` → browser default dir |
| `BROWSER_PROTOCOL_TIMEOUT` | `60000` | CDP protocol timeout (ms). Increase for long-running operations like image generation |

### Daemon Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `DAEMON_PORT` | `40225` | Daemon HTTP service port |
| `DAEMON_TTL_MS` | `1800000` | Idle timeout (ms), default 30 minutes. After timeout, the browser is closed and the Daemon exits. It will auto-respawn on the next call |

### Other Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `OUTPUT_DIR` | `./gemini-image` | Image output directory |
| `ATLAS_BASE_URL` | `https://api.atlascloud.ai/v1` | Atlas Cloud OpenAI-compatible API base URL |
| `ATLAS_API_KEY` | empty | Atlas Cloud API key, recommended in `.env.development` |
| `ATLAS_MODEL` | `openai/gpt-4o-mini` | Default Atlas Cloud model |
| `ATLAS_REQUEST_TIMEOUT_MS` | `60000` | Atlas Cloud request timeout in milliseconds |

### Reusing OpenClaw's Browser Session

[OpenClaw](https://github.com/)'s default CDP port is **18800**. If you want to reuse OpenClaw's existing browser session, set `BROWSER_DEBUG_PORT` to `18800`:

```env
BROWSER_DEBUG_PORT=18800
```

**However, please note**: OpenClaw's browser session **does not include the Stealth anti-detection plugin**, making it less resistant to bot detection compared to browser instances managed by this project. This project uses `puppeteer-extra-plugin-stealth` to provide comprehensive anti-detection measures (hiding the webdriver flag, simulating real browser fingerprints, etc.), which better avoids automated detection by websites.

**Recommendation**: Unless you have specific needs, use the default port `40821` and let the project manage its own browser instance for the best anti-detection results.

<br>

## ☁️ Atlas Cloud Provider

### Configuration

Store your local private key in `.env.development`:

```env
ATLAS_API_KEY=your_atlas_api_key
ATLAS_BASE_URL=https://api.atlascloud.ai/v1
ATLAS_MODEL=openai/gpt-4o-mini
ATLAS_REQUEST_TIMEOUT_MS=60000
```

### Capability Summary

- `atlas_list_models`: list all models visible to the current API key
- `atlas_send_message`: run a non-streaming text chat request
- `atlas_stream_message`: consume Atlas streaming output and return the aggregated text for integration checks

### Design Principles

- Pure API path with no browser or Gemini login dependency
- Directly compatible with Atlas Cloud's OpenAI-style payloads
- Leaves all existing `gemini_*` MCP tools unchanged

<br>

## 🚀 Usage

### Option 1: As an MCP Server (Recommended)

Add the following to your MCP client configuration:

```json
{
  "mcpServers": {
    "gemini": {
      "command": "node",
      "args": ["<absolute-path-to-project>/src/mcp-server.js"]
    }
  }
}
```

Once started, the AI can invoke all tools via the MCP protocol.

### Option 2: Command Line

```bash
# Start MCP Server (stdio mode, for AI clients)
npm run mcp

# Start Browser Daemon standalone (usually unnecessary — MCP auto-starts it)
npm run daemon

# Run the demo
npm run demo
```

### Option 3: As a Library

```javascript
import { createGeminiSession, disconnect } from './src/index.js';

const { ops } = await createGeminiSession();

// Generate an image
const result = await ops.generateImage('Draw a cute cat', { fullSize: true });
console.log('Image saved to:', result.filePath);

// Disconnect when done (browser stays alive, managed by Daemon)
disconnect();
```

### Option 4: Call the Atlas Cloud Provider

```javascript
import { createAtlasProvider } from './src/index.js';

const atlas = createAtlasProvider();

const result = await atlas.createChatCompletion({
  model: 'openai/gpt-4o-mini',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Reply with OK only.' }
  ],
  temperature: 0,
  max_tokens: 16,
});

console.log(result.choices[0].message.content);
```

<br>

## 🔧 MCP Tools

### Atlas Cloud Provider

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `atlas_list_models` | Get all models visible to the current Atlas Cloud API key | — |
| `atlas_send_message` | Send a non-streaming Atlas Cloud chat request | `model`, `messages`, `temperature`, `max_tokens` |
| `atlas_stream_message` | Validate Atlas Cloud streaming and return the aggregated output | `model`, `messages`, `temperature`, `max_tokens` |

### Image Generation

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `gemini_generate_image` | Full image generation pipeline (takes 60–120s) | `prompt`, `newSession`, `referenceImages`, `fullSize`, `timeout` |

### Session Management

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `gemini_new_chat` | Start a new blank conversation | — |
| `gemini_temp_chat` | Enter temporary chat mode (no history saved) | — |
| `gemini_navigate_to` | Navigate to a specific Gemini URL (e.g. a saved session) | `url`, `timeout` |

### Model & Conversation

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `gemini_switch_model` | Switch model (pro / quick / think) | `model` |
| `gemini_send_message` | Send text and wait for reply (takes 10–60s) | `message`, `timeout` |

### Image Operations

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `gemini_upload_images` | Upload images to the input box | `images` |
| `gemini_get_images` | List all images in the current session (metadata only) | — |
| `gemini_extract_image` | Extract image base64 data and save locally | `imageUrl` |
| `gemini_download_full_size_image` | Download full-size high-res image | `index` |
| `gemini_share_latest_image` | Create a public share link and return `https://gemini.google.com/share/...` | `index`, `timeout`, `copyToClipboard`, `closeDialog` |

### Text Responses

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `gemini_get_all_text_responses` | Get all text responses in the session | — |
| `gemini_get_latest_text_response` | Get the latest text response | — |

### Diagnostics & Management

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `gemini_check_login` | Check Google login status | — |
| `gemini_probe` | Probe page element states | — |
| `gemini_reload_page` | Reload the page | `timeout` |
| `gemini_browser_info` | Get browser connection info | — |

<br>

## 🔄 Daemon Lifecycle

```
First MCP call
  │
  ├─ Daemon not running → auto-spawn (detached + unref)
  │                        → poll until ready (up to 15s)
  │
  ├─ GET /browser/acquire → launch/reuse browser + reset 30-min countdown
  │
  ├─ MCP tool finishes → disconnect() (closes WebSocket, keeps browser alive)
  │
  ├─ Another call within 30 min → countdown resets (extends TTL)
  │
  └─ 30 min with no activity → close browser + stop HTTP server + exit process
                                 (next call will auto-respawn)
```

**Daemon API Endpoints:**

| Endpoint | Description |
|----------|-------------|
| `GET /browser/acquire` | Acquire browser connection (resets TTL) |
| `GET /browser/status` | Query browser status (does NOT reset TTL) |
| `POST /browser/release` | Manually destroy the browser |
| `GET /health` | Daemon health check |

<br>

## 📁 Project Structure

```
gemini-skill/
├── src/
│   ├── index.js               # Unified entry point
│   ├── mcp-server.js          # MCP protocol server (registers all tools)
│   ├── gemini-ops.js          # Gemini page operations (core logic)
│   ├── operator.js            # Low-level DOM operation wrappers
│   ├── browser.js             # Browser connector (Skill-facing)
│   ├── config.js              # Centralized configuration
│   ├── util.js                # Utility functions
│   ├── watermark-remover.js   # Image watermark removal (via sharp)
│   ├── demo.js                # Usage examples
│   ├── assets/                # Static assets
│   └── daemon/                # Browser Daemon (standalone process)
│       ├── server.js          # HTTP micro-service entry
│       ├── engine.js          # Browser engine (launch/connect/terminate)
│       ├── handlers.js        # API route handlers
│       └── lifecycle.js       # Lifecycle control (lazy shutdown timer)
├── references/                # Reference documentation
├── SKILL.md                   # AI invocation spec (read by MCP clients)
├── package.json
└── .env                       # Environment config (create manually)
```

<br>

## ⚠️ Notes

1. **First-time login required** — On the first run, the browser will open the Gemini page. Complete Google account login manually. Login state is persisted in `userDataDir`, so subsequent runs won't require re-login.

2. **Single instance only** — Only one browser instance can use a given CDP port. Running multiple instances will cause port conflicts.

3. **Windows Server considerations** — Path normalization and Safe Browsing bypass are built-in, but double-check:
   - Chrome/Edge is properly installed
   - The output directory is writable
   - The firewall is not blocking localhost traffic

4. **Image generation takes time** — Typically 60–120 seconds. Set your MCP client's `timeoutMs` to ≥ 180000 (3 minutes).

<br>

## 📝 To Do List

- [x] **Full MCP tool registration**
- [x] **On-demand Daemon auto-start**
- [x] **Full-size CDP image download**
- [x] **Auto watermark removal**
- [x] **Reference image upload & image-to-image**
- [x] **Historical session navigation**
- [ ] **Multi-browser instance parallel support**
- [ ] **Music generation support**
- [ ] **Video generation support**

<br>

## 📄 License

This project is licensed under the MIT License — see [LICENSE](https://github.com/WJZ-P/gemini-skill/blob/main/LICENSE) for details.

## LINUX DO

This project supports the [LINUX DO](https://linux.do) community.

<br>

## If you find this useful, give it a ⭐!

## ⭐ Star History

[![Stargazers over time](https://starchart.cc/WJZ-P/gemini-skill.svg?variant=adaptive)](https://starchart.cc/WJZ-P/gemini-skill)
