import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// 复用已有的统一入口，不修改原有逻辑
import { createGeminiSession, disconnect } from './index.js';
import config from './config.js';
import { sleep } from './util.js';

const server = new McpServer({
  name: "gemini-mcp-server",
  version: "1.0.0",
});

// 注册工具
server.registerTool(
  "gemini_generate_image",
  {
    description: "调用后台的 Gemini 浏览器会话生成高质量图片。注意：生图过程较慢（通常 60~120 秒），请耐心等待",
    inputSchema: {
      prompt: z.string().describe("图片的详细描述词"),
      newSession: z.boolean().default(false).describe(
        "是否新建会话。true= 开启全新对话; false = 复用当前已有的 Gemini 会话页"
      ),
      referenceImages: z.array(z.string()).default([]).describe(
        "参考图片的本地文件路径数组，例如 [\"/path/to/ref1.png\", \"/path/to/ref2.jpg\"]。图片会在发送 prompt 前上传到 Gemini 输入框"
      ),
      fullSize: z.boolean().default(false).describe(
        "是否下载完整尺寸原图。true= 通过 CDP 拦截下载高清大图; false= 提取页面预览图"
      ),
      timeout: z.number().default(180000).describe(
        "等待 Gemini 生成回复的超时时间（毫秒），默认 180000（3 分钟）。生图较慢，建议不低于 120000"
      ),
    },
  },
  async ({ prompt, newSession, referenceImages, fullSize, timeout }) => {
    try {
      const { ops } = await createGeminiSession();

      // 前置检查：确保已登录
      const loginCheck = await ops.checkLogin();
      if (!loginCheck.ok || !loginCheck.loggedIn) {
        disconnect();
        return {
          content: [{ type: "text", text: `Gemini 未登录 Google 账号，请先在浏览器中完成登录后重试` }],
          isError: true,
        };
      }

      // 确保是 pro 模型（生图需要 Pro）
      await ops.ensureModelPro();

      // 如果有参考图，需要先新建会话再上传，最后 generateImage 不再新建
      if (referenceImages.length > 0) {
        if (newSession) {
          await ops.click('newChatBtn');
          await sleep(250);
        }
        for (const imgPath of referenceImages) {
          console.error(`[mcp] 正在上传参考图: ${imgPath}`);
          const uploadResult = await ops.uploadImage(imgPath);
          if (!uploadResult.ok) {
            disconnect();
            return {
              content: [{ type: "text", text: `参考图上传失败: ${imgPath}\n错误: ${uploadResult.error}` }],
              isError: true,
            };
          }
        }
        console.error(`[mcp] ${referenceImages.length} 张参考图上传完成`);
      }

      // 如果有参考图，已在上面手动新建会话，generateImage 内部不再新建
      // 如果没有参考图，newSession 直接传给 generateImage 内部处理
      const needNewChat = referenceImages.length > 0 ? false : newSession;
      const result = await ops.generateImage(prompt, { newChat: needNewChat, fullSize, timeout });

      // 执行完毕立刻断开，交还给 Daemon 倒计时
      disconnect();

      if (!result.ok) {
        return {
          content: [{ type: "text", text: `生成失败: ${result.error}` }],
          isError: true,
        };
      }

      // 完整尺寸下载模式：文件已由 CDP 保存到 outputDir
      if (result.method === 'fullSize') {
        console.error(`[mcp] 完整尺寸图片已保存至 ${result.filePath}`);
        return {
          content: [
            { type: "text", text: `图片生成成功！完整尺寸原图已保存至: ${result.filePath}` },
          ],
        };
      }

      // base64 提取模式：写入本地文件，只返回文件路径（不返回 base64 数据，避免 MCP 协议校验问题）
      const base64Data = result.dataUrl.split(',')[1];
      const mimeMatch = result.dataUrl.match(/^data:(image\/\w+);/);
      const ext = mimeMatch ? mimeMatch[1].split('/')[1] : 'png';

      mkdirSync(config.outputDir, { recursive: true });
      const filename = `gemini_${Date.now()}.${ext}`;
      const filePath = join(config.outputDir, filename);
      writeFileSync(filePath, Buffer.from(base64Data, 'base64'));

      console.error(`[mcp] 图片已保存至 ${filePath}`);

      return {
        content: [
          { type: "text", text: `图片生成成功！已保存至: ${filePath}` },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `执行崩溃: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// ─── 会话管理 ───

// 新建会话
server.registerTool(
  "gemini_new_chat",
  {
    description: "在 Gemini 中新建一个空白对话",
    inputSchema: {},
  },
  async () => {
    try {
      const { ops } = await createGeminiSession();
      const result = await ops.click('newChatBtn');
      disconnect();

      if (!result.ok) {
        return { content: [{ type: "text", text: `新建会话失败: ${result.error}` }], isError: true };
      }
      return { content: [{ type: "text", text: "已新建 Gemini 会话" }] };
    } catch (err) {
      return { content: [{ type: "text", text: `执行崩溃: ${err.message}` }], isError: true };
    }
  }
);

// 临时会话
server.registerTool(
  "gemini_temp_chat",
  {
    description: "进入 Gemini 临时对话模式（不保留历史记录，适合隐私场景）。注意：临时会话按钮仅在空白新会话页面可见，本工具会自动先新建会话再进入临时模式",
    inputSchema: {},
  },
  async () => {
    try {
      const { ops } = await createGeminiSession();

      // 临时会话按钮仅在空白新会话页可见，当前会话有内容时会被隐藏
      // 因此必须先新建会话，确保页面回到空白状态
      const newChatResult = await ops.click('newChatBtn');
      if (!newChatResult.ok) {
        disconnect();
        return { content: [{ type: "text", text: `前置步骤失败：无法新建会话（临时会话按钮仅在空白页可见）: ${newChatResult.error}` }], isError: true };
      }
      // 等待新会话页面稳定
      await sleep(250);

      const result = await ops.clickTempChat();
      disconnect();

      if (!result.ok) {
        return { content: [{ type: "text", text: `进入临时会话失败: ${result.error}` }], isError: true };
      }
      return { content: [{ type: "text", text: "已进入临时对话模式（自动先新建了空白会话）" }] };
    } catch (err) {
      return { content: [{ type: "text", text: `执行崩溃: ${err.message}` }], isError: true };
    }
  }
);

// ─── 模型切换 ───

server.registerTool(
  "gemini_switch_model",
  {
    description: "切换 Gemini 模型（pro / quick / think）",
    inputSchema: {
      model: z.enum(["pro", "quick", "think"]).describe("目标模型：pro=高质量, quick=快速, think=深度思考"),
    },
  },
  async ({ model }) => {
    try {
      const { ops } = await createGeminiSession();
      const result = await ops.switchToModel(model);
      disconnect();

      if (!result.ok) {
        return { content: [{ type: "text", text: `切换模型失败: ${result.error}` }], isError: true };
      }
      return {
        content: [{ type: "text", text: `模型已切换到 ${model}${result.previousModel ? `（之前是 ${result.previousModel}）` : ''}` }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `执行崩溃: ${err.message}` }], isError: true };
    }
  }
);

// ─── 文本对话 ───

server.registerTool(
  "gemini_send_message",
  {
    description: "向 Gemini 发送文本消息并等待回答完成（不提取图片，纯文本交互）",
    inputSchema: {
      message: z.string().describe("要发送给 Gemini 的文本内容"),
      timeout: z.number().default(120000).describe("等待回答完成的超时时间（毫秒），默认 120000"),
    },
  },
  async ({ message, timeout }) => {
    try {
      const { ops } = await createGeminiSession();
      const result = await ops.sendAndWait(message, { timeout });
      disconnect();

      if (!result.ok) {
        return { content: [{ type: "text", text: `发送失败: ${result.error}，耗时 ${result.elapsed}ms` }], isError: true };
      }
      return {
        content: [{ type: "text", text: `消息已发送并等待完成，耗时 ${result.elapsed}ms` }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `执行崩溃: ${err.message}` }], isError: true };
    }
  }
);

// ─── 图片上传 ───

server.registerTool(
  "gemini_upload_images",
  {
    description: "向 Gemini 当前输入框上传图片（仅上传，不发送消息），可配合 gemini_send_message 组合使用",
    inputSchema: {
      images: z.array(z.string()).min(1).describe("本地图片文件路径数组"),
    },
  },
  async ({ images }) => {
    try {
      const { ops } = await createGeminiSession();

      const results = [];
      for (const imgPath of images) {
        console.error(`[mcp] 正在上传: ${imgPath}`);
        const r = await ops.uploadImage(imgPath);
        results.push({ path: imgPath, ...r });
        if (!r.ok) {
          disconnect();
          return {
            content: [{ type: "text", text: `上传失败: ${imgPath}\n错误: ${r.error}\n\n已成功上传 ${results.filter(x => x.ok).length}/${images.length} 张` }],
            isError: true,
          };
        }
      }

      disconnect();
      return {
        content: [{ type: "text", text: `全部 ${images.length} 张图片上传成功` }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `执行崩溃: ${err.message}` }], isError: true };
    }
  }
);

// ─── 图片获取 ───

server.registerTool(
  "gemini_get_images",
  {
    description: "获取当前 Gemini 会话中所有已加载的图片列表（不下载，仅返回元信息）",
    inputSchema: {},
  },
  async () => {
    try {
      const { ops } = await createGeminiSession();
      const result = await ops.getAllImages();
      disconnect();

      if (!result.ok) {
        return { content: [{ type: "text", text: `未找到图片: ${result.error}` }], isError: true };
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ total: result.total, newCount: result.newCount, images: result.images }, null, 2) }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `执行崩溃: ${err.message}` }], isError: true };
    }
  }
);

server.registerTool(
  "gemini_extract_image",
  {
    description: "提取指定图片的 base64 数据并保存到本地文件。可从 gemini_get_images 获取图片 src URL",
    inputSchema: {
      imageUrl: z.string().describe("图片的 src URL（从 gemini_get_images 结果中获取）"),
    },
  },
  async ({ imageUrl }) => {
    try {
      const { ops } = await createGeminiSession();
      const result = await ops.extractImageBase64(imageUrl);
      disconnect();

      if (!result.ok) {
        return { content: [{ type: "text", text: `图片提取失败: ${result.error}${result.detail ? ' — ' + result.detail : ''}` }], isError: true };
      }

      // 保存到本地
      const base64Data = result.dataUrl.split(',')[1];
      const mimeMatch = result.dataUrl.match(/^data:(image\/\w+);/);
      const ext = mimeMatch ? mimeMatch[1].split('/')[1] : 'png';

      mkdirSync(config.outputDir, { recursive: true });
      const filename = `gemini_${Date.now()}.${ext}`;
      const filePath = join(config.outputDir, filename);
      writeFileSync(filePath, Buffer.from(base64Data, 'base64'));

      console.error(`[mcp] 图片已保存至 ${filePath}`);

      return {
        content: [
          { type: "text", text: `图片提取成功，已保存至: ${filePath}` },
        ],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `执行崩溃: ${err.message}` }], isError: true };
    }
  }
);

// ─── 完整尺寸图片下载 ───

server.registerTool(
  "gemini_download_full_size_image",
  {
    description: "下载完整尺寸的图片（高清大图）。默认下载最新一张，也可通过 index 指定第几张（从0开始，从旧到新排列）",
    inputSchema: {
      index: z.number().int().min(0).optional().describe(
        "图片索引，从0开始，按从旧到新排列。不传则下载最新一张"
      ),
    },
  },
  async ({ index }) => {
    try {
      const { ops } = await createGeminiSession();
      const result = await ops.downloadFullSizeImage({ index });
      disconnect();

      if (!result.ok) {
        let msg = `下载完整尺寸图片失败: ${result.error}`;
        if (result.detail) msg += `\n${result.detail}`;
        if (result.total != null) msg += `\n（共 ${result.total} 张图片）`;
        if (result.error === 'index_out_of_range') msg += `，请求的索引: ${result.requestedIndex}`;
        return { content: [{ type: "text", text: msg }], isError: true };
      }

      return {
        content: [{ type: "text", text: `完整尺寸图片已下载（第 ${result.index + 1} 张，共 ${result.total} 张）\n文件路径: ${result.filePath}\n原始文件名: ${result.suggestedFilename || '未知'}` }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `执行崩溃: ${err.message}` }], isError: true };
    }
  }
);

// ─── 文字回复获取 ───

server.registerTool(
  "gemini_get_all_text_responses",
  {
    description: "获取当前 Gemini 会话中所有文字回复内容（仅文字，不含图片等其他类型回复）",
    inputSchema: {},
  },
  async () => {
    try {
      const { ops } = await createGeminiSession();
      const result = await ops.getAllTextResponses();
      disconnect();

      if (!result.ok) {
        return { content: [{ type: "text", text: `未找到回复: ${result.error}` }], isError: true };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `执行崩溃: ${err.message}` }], isError: true };
    }
  }
);

server.registerTool(
  "gemini_get_latest_text_response",
  {
    description: "获取当前 Gemini 会话中最新一条文字回复（仅文字，不含图片等其他类型回复）",
    inputSchema: {},
  },
  async () => {
    try {
      const { ops } = await createGeminiSession();
      const result = await ops.getLatestTextResponse();
      disconnect();

      if (!result.ok) {
        return { content: [{ type: "text", text: `未找到回复: ${result.error}` }], isError: true };
      }

      return {
        content: [{ type: "text", text: result.text }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `执行崩溃: ${err.message}` }], isError: true };
    }
  }
);

// ─── 登录状态检查 ───

server.registerTool(
  "gemini_check_login",
  {
    description: "检查当前 Gemini 页面是否已登录 Google 账号",
    inputSchema: {},
  },
  async () => {
    try {
      const { ops } = await createGeminiSession();
      const result = await ops.checkLogin();
      disconnect();

      if (!result.ok) {
        return { content: [{ type: "text", text: `检测失败: ${result.error}` }], isError: true };
      }

      const status = result.loggedIn ? "已登录" : "未登录";
      return {
        content: [{ type: "text", text: `${status}（导航栏文本: "${result.barText}"）` }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `执行崩溃: ${err.message}` }], isError: true };
    }
  }
);

// ─── 页面状态 & 恢复 ───

server.registerTool(
  "gemini_probe",
  {
    description: "探测 Gemini 页面各元素状态（输入框、按钮、当前模型等），用于调试和排查问题",
    inputSchema: {},
  },
  async () => {
    try {
      const { ops } = await createGeminiSession();
      const result = await ops.probe();
      disconnect();

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `执行崩溃: ${err.message}` }], isError: true };
    }
  }
);

server.registerTool(
  "gemini_reload_page",
  {
    description: "刷新 Gemini 页面（页面卡住或状态异常时使用）",
    inputSchema: {
      timeout: z.number().default(30000).describe("等待页面重新加载完成的超时（毫秒），默认 30000"),
    },
  },
  async ({ timeout }) => {
    try {
      const { ops } = await createGeminiSession();
      const result = await ops.reloadPage({ timeout });
      disconnect();

      if (!result.ok) {
        return { content: [{ type: "text", text: `页面刷新失败: ${result.error}` }], isError: true };
      }
      return { content: [{ type: "text", text: `页面刷新完成，耗时 ${result.elapsed}ms` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `执行崩溃: ${err.message}` }], isError: true };
    }
  }
);

// ─── 浏览器信息 ───

// 查询浏览器信息
server.registerTool(
  "gemini_browser_info",
  {
    description: "获取 Gemini 浏览器会话的连接信息（CDP 端口、WebSocket 地址、Daemon 状态等），方便外部工具直连浏览器",
    inputSchema: {},
  },
  async () => {
    const daemonUrl = `http://127.0.0.1:${config.daemonPort}`;

    try {
      // 1. 检查 Daemon 健康状态
      const healthRes = await fetch(`${daemonUrl}/health`, { signal: AbortSignal.timeout(3000) });
      const health = await healthRes.json();

      if (!health.ok) {
        return {
          content: [{ type: "text", text: "Daemon 未就绪，浏览器可能未启动。请先调用 gemini_generate_image 触发自动启动。" }],
          isError: true,
        };
      }

      // 2. 获取浏览器连接信息
      const acquireRes = await fetch(`${daemonUrl}/browser/acquire`, { signal: AbortSignal.timeout(5000) });
      const acquire = await acquireRes.json();

      const info = {
        daemon: {
          url: daemonUrl,
          port: config.daemonPort,
          status: "running",
        },
        browser: {
          cdpPort: config.browserDebugPort,
          wsEndpoint: acquire.wsEndpoint || null,
          pid: acquire.pid || null,
          headless: config.browserHeadless,
        },
        config: {
          protocolTimeout: config.browserProtocolTimeout,
          outputDir: config.outputDir,
          daemonTTL: config.daemonTTL,
        },
      };

      return {
        content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{
          type: "text",
          text: `无法连接 Daemon (${daemonUrl})，浏览器可能未启动。\n错误: ${err.message}\n\n提示: 请先调用 gemini_generate_image 触发自动启动，或手动运行 npm run daemon`,
        }],
        isError: true,
      };
    }
  }
);

// 启动标准输入输出通信
async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Gemini MCP Server running on stdio"); // 必须用 console.error，避免污染 stdio
}

run().catch(console.error);
