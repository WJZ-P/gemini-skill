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
import { platform } from 'node:os';
import { createGeminiSession, disconnect } from './index.js';

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

    // 3. 发送一句话
    console.log('\n[3] 发送提示词...');
    const result = await ops.sendAndWait('Hello Gemini!', {
      timeout: 60_000,
      onPoll(poll) {
        console.log(`  polling... status=${poll.status}`);
      },
    });
    console.log('result:', JSON.stringify(result, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    disconnect();
    console.log('\n[done]');
  }
}

main().catch(console.error);
