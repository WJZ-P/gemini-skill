---
name: gemini-skill
description: 通过 Gemini 官网（gemini.google.com）执行问答与生图操作。用户提到"问问Gemini/让Gemini回答/去Gemini问"，或出现"生图/画图/绘图/nano banana/nanobanana/生成图片"等关键词时触发。默认使用可用模型中最强档（优先 Gemini 3.1 Pro），按任务切换文本问答或图片生成流程，并把结果回传给用户。
---

# Gemini Web Ops

## 核心规则

1. 使用 OpenClaw 内置浏览器，`profile="openclaw"`。
2. 涉及生图关键词（如：生图、绘图、画一张、nano banana）时，优先用无头浏览器流程执行。
3. 文本问答任务（如"问问Gemini xxx"）走 Gemini 文本提问链路。
4. 默认模型：可用列表中最强模型，优先 `Gemini 3.1 Pro`。
5. 执行生图后先向用户回报"正在绘图中"，完成后回传图片。

## 任务分流

- **文本问答**触发词：`问问Gemini`、`让Gemini回答`、`去Gemini问`。
- **生图任务**触发词：`生图`、`画`、`绘图`、`海报`、`nano banana`、`nanobanana`、`image generation`。
- 若请求含糊，先确认：是文本回答还是要出图。

## 标准执行流程

### 按钮状态机

Gemini 页面的操作按钮（`.send-button-container` 内）通过 `aria-label` 反映当前状态：

| aria-label | 状态 | 含义 |
|---|---|---|
| 麦克风 | `idle` | 输入框为空，空闲中 |
| 发送 / Send | `ready` | 输入框有内容，可发送 |
| 停止 / Stop | `loading` | 已发送，正在生成回答 |

可通过 `GeminiOps.getStatus()` 获取当前状态，通过 `GeminiOps.pollStatus()` 分段轮询等待生成完毕。

### A. 文本问答
1. 打开 `https://gemini.google.com`。
2. 校验登录态（头像/输入框可见）。
3. 新建会话：`click('newChatBtn')`，确保干净上下文。
4. 选择最强可用模型（优先 Gemini 3.1 Pro）。
5. 将用户问题原样输入并发送。
6. **分段轮询等待**（见下方"CDP 保活轮询策略"）。
7. 等待完整输出，提炼后回传（必要时附原文要点）。

### B. 生图流程
1. 打开 Gemini 页面并确认登录。
2. 新建会话：`click('newChatBtn')`，确保干净上下文。
3. 选择最强可用模型（优先 Gemini 3.1 Pro）。
4. 将用户提示词原样输入。
5. 发送后立即通知用户：正在绘图中。
6. **分段轮询等待**（见下方"CDP 保活轮询策略"，生图超时上限 120s）。
7. 结果出现后：
   - 优先用"下载原图"按钮获取原图。
   - 若无下载按钮或失败，可对图片右键另存（通常是标清图）。
8. 把图片返回用户；若有多张，按顺序全部回传。

## CDP 保活轮询策略

> **核心原则**：绝不在页面内做长时间 Promise 等待。每次 `evaluate` 必须毫秒级返回，由调用端控制循环。

生图/问答发送后，按以下方式等待结果：

1. 每隔 **8~10 秒**调用一次 `GeminiOps.pollStatus()`。
2. 该函数立即返回 `{status, label, pageVisible, ts}`。
3. 调用端根据 `status` 判断：
   - `loading` → 继续等待，累计已耗时。
   - `idle` → 生成完毕，进入结果获取阶段。
   - `unknown` → 页面可能异常，做一次 snapshot 兜底排查。
4. 累计耗时超过上限（文本 60s / 生图 120s）→ 走超时回退逻辑。

**为什么这样做**：OpenClaw 通过 CDP（Chrome DevTools Protocol）WebSocket 控制浏览器。若长时间（>30s）无消息往来，网关/代理可能判定连接空闲并断开。分段短轮询保证 CDP 通道始终有心跳流量。

## 失败回退

1. 元素定位失败：刷新页面后重试一次。
2. 模型不可用：降级到次优 Gemini 模型并告知。
3. 生成超时：回报"仍在生成中"，继续等待一次；再次超时则请用户换短提示词。

## 低 token 优先策略

- 优先使用 `scripts/gemini_ui_shortcuts.js` 的快捷选择器。
- 先 evaluate 批量动作，再 snapshot 精准兜底。
- 避免高频全量快照。

## 参考

- 详细执行与回退：`references/gemini-flow.md`
- 关键词与路由：`references/intent-routing.md`
