# Gemini Flow

## 1) 登录校验

最小校验项：
- 页面存在可输入提问的输入框
- 右上角有用户头像或账户入口

若未登录：提示用户先在 openclaw profile 浏览器中登录。

## 2) 模型策略

优先级：
1. Gemini 3.1 Pro
2. 当前页面可见的次优 Pro/Advanced 模型

若切换失败，保留默认并告知用户。

## 3) 按钮状态检测

`.send-button-container` 内的按钮通过 `aria-label` 区分三种状态：

- **空闲（idle）**：aria-label 为麦克风相关，按钮 disabled，输入框为空。
- **可发送（ready）**：aria-label 为"发送"/"Send"，输入框有内容。
- **生成中（loading）**：aria-label 为"停止"/"Stop"，Gemini 正在输出。

使用方式：
- `GeminiOps.getStatus()` → 返回 `{status: 'idle'|'ready'|'loading', label, disabled}`
- `GeminiOps.pollStatus()` → 返回 `{status, label, pageVisible, ts}`，**毫秒级返回**，供调用端分段轮询

### CDP 保活轮询（重要）

**禁止**在页面内做长 Promise 等待（旧版 `waitForComplete` 已移除）。

正确做法：调用端每 8~10 秒 evaluate 一次 `GeminiOps.pollStatus()`，自行累计耗时并判断超时。
这确保 CDP WebSocket 通道持续有消息流量，避免被网关判定空闲而断开连接。

## 4) 生图结果获取

优先顺序：
1. 图片右上角"下载原图"
2. 右键另存为（标清）

下载到本地后再通过渠道回传。

## 5) 用户提示文案（建议）

- 开始生图：
  - `已收到，正在用 Gemini 给你绘图中 🎨`
- 生成中超时：
  - `还在渲染中，我继续盯着，马上回你。`
- 完成：
  - `画好了，给你发图啦～`
