---
name: gemini-skill
description: 通过 Gemini 官网（gemini.google.com）执行生图、对话等操作。用户提到"生图/画图/绘图/nano banana/nanobanana/生成图片"等关键词时触发。操作方式分三级优先级：首选 MCP 工具 → 次选 Skill 脚本 → 最次连接 Skill 浏览器手动操作（需用户授权）。禁止自行启动外部浏览器访问 Gemini。
---

# Gemini Skill

## ⚠️ 操作优先级（必须遵守）

与 Gemini 的一切交互，按以下优先级选择方式：

1. **🥇 首选：调用 MCP 工具** — 直接调用本 Skill 暴露的 MCP 工具完成操作，覆盖绝大多数场景
2. **🥈 次选：运行 Skill 脚本** — 当 MCP 工具无法满足需求时，可运行本 Skill 项目中提供的脚本来完成
3. **🥉 最次：连接 Skill 管理的浏览器** — 仅当前两种方式都无法解决时，可通过 `gemini_browser_info` 获取 CDP 连接信息，主动连接到本 Skill 管理的浏览器进行操作。**此方式必须先征得用户同意**

**绝对禁止**：自行启动新的浏览器实例访问 Gemini 页面（如使用 OpenClaw 浏览器、另起 Puppeteer 等），这会导致会话冲突。

> 浏览器 Daemon 未运行时 MCP 工具会自动拉起，无需任何手动操作。

## 📡 进度同步 & 长耗时工具规则

MCP 工具调用（尤其是生图、等待回复等）可能耗时较长（60~180 秒）。必须遵守以下规则：

- **本 Skill 所有 MCP 工具均为同步阻塞调用**，会等到最终结果才返回。不存在"中间状态"需要轮询。
- 调用长耗时工具时，`timeoutMs` 必须设为 ≥180000（3 分钟），避免传输层提前超时截断。
- **禁止在未收到工具最终返回前结束对话**或向用户报告"还在运行"/"工具超时"。
- 每隔 15~30 秒向用户发送一条进度消息（如"正在等待 Gemini 生成图片…已等待 30 秒…"），保持反馈。
- 拿到最终结果后**立即**回传产物（文件路径）或报告错误，不得遗漏。
- 若 `fullSize` 模式失败，可降级重试 `fullSize=false`（预览图模式更稳定）。

## 触发关键词

- **生图任务**：`生图`、`画`、`绘图`、`海报`、`nano banana`、`nanobanana`、`image generation`、`生成图片`
- 若请求含糊，先确认用户是否需要生图

## 使用方式

本 Skill 通过 MCP Server 暴露工具，AI 直接调用即可。

浏览器启动、会话管理、图片提取、文件保存等流程已全部封装在工具内部。

### ⚠️ 强制规则

> **AI 必须始终通过 MCP 工具完成所有操作。**
>
> 禁止绕过 MCP 自行编写临时脚本（如 `node -e "..."` 或创建 `.js` 临时文件）来
> `import` / `require` 本项目导出的函数（如 `createGeminiSession`、`createOps` 等）。
>
> 如果 MCP 工具确实无法满足当前需求，AI **必须先向用户说明原因并获得明确同意**，
> 才能编写临时脚本调用底层 API。未经用户同意，一律禁止。

### 可用工具

**核心生图（封装完整流程）：**

| 工具名 | 说明 | 入参 |
|--------|------|------|
| `gemini_generate_image` | 完整生图流程：新建会话→发prompt→等待→提取图片→保存本地（耗时约 60~120 秒） | `prompt`，`newSession`（默认false），`referenceImages`（参考图路径数组），`fullSize`（默认true，高清原图；false则预览图），`timeout`（默认120000ms） |

**会话管理：**

| 工具名 | 说明 | 入参 |
|--------|------|------|
| `gemini_new_chat` | 新建一个空白对话 | 无 |
| `gemini_temp_chat` | 进入临时对话模式（不保留历史记录） | 无 |

**模型切换：**

| 工具名 | 说明 | 入参 |
|--------|------|------|
| `gemini_switch_model` | 切换 Gemini 模型 | `model`（`pro` / `quick` / `think`） |

**文本对话：**

| 工具名 | 说明 | 入参 |
|--------|------|------|
| `gemini_send_message` | 发送文本消息并等待回答完成，直接返回 Gemini 的回复文本 | `message`，`timeout`（默认120000ms） |

**图片操作：**

| 工具名 | 说明 | 入参 |
|--------|------|------|
| `gemini_upload_images` | 上传图片到输入框（仅上传不发送，可配合 send_message） | `images`（路径数组） |
| `gemini_get_images` | 获取会话中所有已加载图片的元信息 | 无 |
| `gemini_extract_image` | 提取指定图片的 base64 并保存到本地 | `imageUrl`（从 get_images 获取） |
| `gemini_download_full_size_image` | 下载完整尺寸的高清图片，默认最新一张，可指定索引 | `index`（可选，从0开始，从旧到新） |
| `gemini_share_latest_image` | 为图片创建公开分享链接并直接返回链接，默认最新一张 | `index`（可选），`timeout`，`copyToClipboard`，`closeDialog` |

**文字回复提取：**

| 工具名 | 说明 | 入参 |
|--------|------|------|
| `gemini_get_all_text_responses` | 获取会话中所有文字回复（仅文字，不含图片） | 无 |
| `gemini_get_latest_text_response` | 获取最新一条文字回复 | 无 |

**登录状态：**

| 工具名 | 说明 | 入参 |
|--------|------|------|
| `gemini_check_login` | 检查是否已登录 Google 账号 | 无 |

**页面导航：**

| 工具名 | 说明 | 入参 |
|--------|------|------|
| `gemini_navigate_to` | 打开指定的 Gemini 页面 URL（如历史会话链接），仅允许 gemini.google.com 域名 | `url`（目标 URL），`timeout`（默认30000ms） |

**诊断 & 恢复：**

| 工具名 | 说明 | 入参 |
|--------|------|------|
| `gemini_probe` | 探测页面各元素状态（输入框、按钮、模型等） | 无 |
| `gemini_reload_page` | 刷新页面（卡住或异常时使用） | `timeout`（默认30000ms） |
| `gemini_browser_info` | 获取浏览器连接信息（CDP 端口、wsEndpoint 等） | 无 |

### 典型用法

**快速生图（一步到位）：**
1. 调用 `gemini_generate_image`，传入 prompt → 返回本地图片路径

**生图并拿分享链接：**
1. 调用 `gemini_generate_image` 生成图片
2. 调用 `gemini_share_latest_image` 返回公开链接

**灵活组合（细粒度控制）：**
1. `gemini_new_chat` — 新建会话
2. `gemini_switch_model` → `pro` — 切换到高质量模型
3. `gemini_upload_images` — 上传参考图
4. `gemini_send_message` — 发送描述词
5. `gemini_get_images` → `gemini_extract_image` — 获取并保存图片

**排障：**
1. `gemini_probe` — 看看页面元素有没有就位
2. `gemini_reload_page` — 页面卡了就刷新
3. `gemini_browser_info` — 获取 CDP 信息自行连接调试

## MCP 客户端配置

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

也可通过 `npm run mcp` 手动启动。

## 失败处理

工具内部已包含重试逻辑。若仍然失败，返回值的 `isError: true` 和错误信息会告知原因：

- **生成超时** — 建议用户简化描述词后重试
- **Daemon 未启动** — 工具会自动拉起，若仍失败可手动 `npm run daemon`
- **页面异常** — 可调用 `gemini_browser_info` 查看浏览器状态排查

## 参考

- 详细执行与回退：`references/gemini-flow.md`
- 关键词与路由：`references/intent-routing.md`
