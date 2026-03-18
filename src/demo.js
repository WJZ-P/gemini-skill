/**
 * demo.js — 使用示例
 *
 * 两种启动方式：
 *
 * 方式 1（推荐）：先手动启动浏览器，再运行 demo
 *   chrome --remote-debugging-port=9223 --user-data-dir="~/.gemini-skill/browser-data"
 *   （也可以用 Edge：msedge --remote-debugging-port=9223 --user-data-dir=...）
 *   node src/demo.js
 *
 * 方式 2：让 skill 自动检测并启动浏览器
 *   node src/demo.js
 *   （或指定路径：BROWSER_PATH="C:/..." node src/demo.js）
 *
 * 所有配置项见 .env，可直接编辑或通过命令行设环境变量。
 */
import { execSync } from 'node:child_process';
import { platform, homedir } from 'node:os';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createGeminiSession, disconnect } from './index.js';

const prompt = 'Gemini你好！请你仿造这个风格，给我生成更多表情包吧！来一张玩手机中。。。';

// ── Demo 专用：杀掉所有 Chromium 系浏览器进程 ──
function killAllBrowserProcesses() {
  const os = platform();
  const commands = os === 'win32'
    ? [
        'taskkill /F /IM msedge.exe /T',
        'taskkill /F /IM chrome.exe /T',
        'taskkill /F /IM chromium.exe /T',
      ]
    : [
        'pkill -f msedge || true',
        'pkill -f chrome || true',
        'pkill -f chromium || true',
      ];

  for (const cmd of commands) {
    try {
      execSync(cmd, { stdio: 'ignore', timeout: 5000 });
    } catch {
      // 进程不存在时会报错，忽略
    }
  }
  console.log('[demo] 已清理所有浏览器进程');
}

/** 异步等待 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 创建会话，如果因浏览器目录被锁而失败，自动杀掉全部浏览器进程后重试一次
 */
async function createSessionWithRetry() {
  // 禁止 Puppeteer 在 Ctrl+C 等信号时自动杀浏览器进程，
  // 由 demo 自己处理 SIGINT → disconnect，浏览器保持运行可复用。
  const opts = {
    debugOpts: {
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    },
  };

  try {
    return await createGeminiSession(opts);
  } catch (err) {
    const msg = err.message || '';
    const isLocked = msg.includes('EPERM') || msg.includes('lock') || msg.includes('already');

    if (!isLocked) throw err;

    console.warn(
      `[demo] 浏览器数据目录被占用，正在清理所有浏览器进程后重试...\n` +
      `  原始错误：${msg}`
    );

    killAllBrowserProcesses();
    await sleep(2000);

    // 重试一次，还失败就直接抛出
    return await createGeminiSession(opts);
  }
}

async function main() {
  console.log('=== Gemini Skill Demo ===\n');

  // 创建会话：自带杀进程重试逻辑
  const { ops } = await createSessionWithRetry();

  // ── Ctrl+C 时只断开连接，不杀浏览器进程（下次可复用） ──
  process.on('SIGINT', () => {
    console.log('\n[demo] Ctrl+C 收到，断开浏览器连接（浏览器保持运行）...');
    disconnect();
    process.exit(0);
  });

  try {
    // 1. 进入临时会话（不留聊天记录，保持账号干净）
    console.log('[1] 进入临时会话...');
    const tempResult = await ops.clickTempChat();
    if (!tempResult.ok) {
      console.warn('[1] 临时会话按钮未找到，跳过（可能已在临时模式或页面结构变化）');
    } else {
      console.log('[1] 已进入临时会话');
    }

    // 2. 探测页面状态
    console.log('\n[2] 探测页面元素...');
    const probe = await ops.probe();
    console.log('probe:', JSON.stringify(probe, null, 2));

    // 3. 确保使用 Pro 模型
    console.log('\n[3] 检查模型...');
    if (probe.currentModel.toLowerCase() === 'pro') {
      console.log('[3] 当前已是 Pro 模型，跳过');
    } else {
      console.log(`[3] 当前模型: ${probe.currentModel || '未知'}，切换到 Pro...`);
      const switchResult = await ops.ensureModelPro();
      if (switchResult.ok) {
        console.log(`[3] 已切换到 Pro（之前: ${switchResult.previousModel || '未知'}）`);
      } else {
        console.warn(`[3] 切换 Pro 失败: ${switchResult.error}，继续使用当前模型`);
      }
    }

    // 4. 上传图片
    console.log('\n[4] 上传图片...');

    const uploadResult = await ops.uploadImage('./gemini-image/miku_fighting.jpg');
    if (uploadResult.ok) {
      console.log(`[4] ✅ 图片上传完成 (${uploadResult.elapsed}ms)`);
      if (uploadResult.warning) console.warn(`[4] ⚠ ${uploadResult.warning}`);
    } else {
      console.warn(`[4] ⚠ 图片上传失败: ${uploadResult.error} — ${uploadResult.detail}`);
    }

    // 5. 发送一句话
    console.log('\n[5] 发送提示词...');
    const result = await ops.sendAndWait(prompt, {
      timeout: 120_000,
      onPoll(poll) {
        console.log(`  polling... status=${poll.status}`);
      },
    });
    console.log('result:', JSON.stringify(result, null, 2));

    // 6. 等待图片加载完成
    if (result.ok) {
      console.log('\n[6] 等待图片加载完成...');
      const imgLoadStart = Date.now();
      while (Date.now() - imgLoadStart < 30_000) {
        const { loaded } = await ops.checkImageLoaded();
        if (loaded) break;
        console.log('  图片加载中...');
        await sleep(500);
      }
      console.log(`[6] 图片加载完成 (${Date.now() - imgLoadStart}ms)`);

      // 7. 获取最新图片并保存到本地
      console.log('\n[7] 查找最新生成的图片...');

      const imgInfo = await ops.getLatestImage();
      console.log('imgInfo:', JSON.stringify(imgInfo, null, 2));

      if (imgInfo.ok && imgInfo.src) {
        console.log(`[7] 找到图片 (${imgInfo.width}x${imgInfo.height}, isNew=${imgInfo.isNew})`);

        // 提取 base64 数据
        console.log(`[7] 提取图片数据 (src=${imgInfo.src})...`);
        const b64Result = await ops.extractImageBase64(imgInfo.src);

        if (b64Result.ok && b64Result.dataUrl) {
          // dataUrl 格式: data:image/png;base64,iVBOR...
          const matches = b64Result.dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
          if (matches) {
            const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
            const base64Data = matches[2];
            const buffer = Buffer.from(base64Data, 'base64');

            // 保存到 ./gemini-image/
            const outputDir = './gemini-image';
            if (!existsSync(outputDir)) {
              mkdirSync(outputDir, { recursive: true });
            }
            const filename = `gemini_${Date.now()}.${ext}`;
            const filepath = join(outputDir, filename);

            writeFileSync(filepath, buffer);
            console.log(`[7] ✅ 图片已保存: ${filepath} (${(buffer.length / 1024).toFixed(1)} KB, method=${b64Result.method})`);
          } else {
            console.warn('[7] ⚠ dataUrl 格式无法解析');
          }
        } else {
          console.warn(`[7] ⚠ 提取图片数据失败: ${b64Result.error || 'unknown'}`);
        }
      } else {
        console.log('[7] 未找到图片（可能本次回答不含图片）');
      }
    }

  } catch (err) {
    console.error('Error:', err);
  }

  console.log('\n[done] 功能执行完毕，浏览器保持运行。按 Ctrl+C 退出。');
}

main().catch(console.error);
