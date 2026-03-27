/**
 * demo2.js — 文字对话能力测试
 *
 * 运行：
 *   node src/demo2.js
 *
 * 测试内容：
 *   1. 创建会话、探测页面状态
 *   2. 发送一条文字消息并等待回复
 *   3. 提取最新一条文字回复
 *   4. 再发送一条追问，测试上下文连贯性
 *   5. 获取全部回复，验证多轮对话
 */
import { createGeminiSession, disconnect } from './index.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 测试用的对话 ──
const MESSAGES = [
  '你好！请用一句话介绍一下你自己。',
  '刚才你说的那句话里有多少个字？请数一下。',
];

async function main() {
  console.log('=== Gemini Skill Demo 2 — 文字对话测试 ===\n');

  const { ops } = await createGeminiSession();

  // Ctrl+C 优雅退出
  process.on('SIGINT', () => {
    console.log('\n[demo2] Ctrl+C，断开连接...');
    disconnect();
    process.exit(0);
  });

  try {
    // ── 1. 探测页面状态 ──
    console.log('[1] 探测页面元素...');
    const probe = await ops.probe();
    console.log(`    输入框: ${probe.promptInput ? '✅' : '❌'}  模型: ${probe.currentModel || '未知'}  状态: ${probe.status?.status || '?'}`);

    // ── 2. 新建会话（确保干净上下文） ──
    console.log('\n[2] 新建会话...');
    const newChatResult = await ops.click('newChatBtn');
    if (newChatResult.ok) {
      console.log('    ✅ 已新建会话');
      await sleep(500);
    } else {
      console.warn('    ⚠ 新建会话按钮未找到，继续使用当前会话');
    }

    // ── 3. 第一轮对话 ──
    console.log(`\n[3] 发送第一条消息: "${MESSAGES[0]}"`);
    const start1 = Date.now();
    const result1 = await ops.sendAndWait(MESSAGES[0], {
      timeout: 60_000,
      onPoll(poll) {
        process.stdout.write(`    polling... status=${poll.status}\r`);
      },
    });
    console.log(''); // 换行

    if (!result1.ok) {
      console.error(`    ❌ 发送失败: ${result1.error} (${result1.elapsed}ms)`);
      disconnect();
      return;
    }
    console.log(`    ✅ Gemini 已回复 (${result1.elapsed}ms)`);

    // ── 4. 提取最新回复 ──
    console.log('\n[4] 获取最新文字回复...');
    const latestResp = await ops.getLatestTextResponse();
    if (latestResp.ok) {
      console.log(`    ─── Gemini 回复（第 ${latestResp.index + 1} 条）───`);
      console.log(`    ${latestResp.text.split('\n').join('\n    ')}`);
      console.log('    ────────────────────────');
    } else {
      console.warn(`    ⚠ 未获取到回复: ${latestResp.error}`);
    }

    // ── 5. 第二轮对话（追问，测试上下文） ──
    console.log(`\n[5] 发送追问: "${MESSAGES[1]}"`);
    const result2 = await ops.sendAndWait(MESSAGES[1], {
      timeout: 60_000,
      onPoll(poll) {
        process.stdout.write(`    polling... status=${poll.status}\r`);
      },
    });
    console.log('');

    if (!result2.ok) {
      console.error(`    ❌ 追问发送失败: ${result2.error} (${result2.elapsed}ms)`);
    } else {
      console.log(`    ✅ Gemini 已回复 (${result2.elapsed}ms)`);

      const latestResp2 = await ops.getLatestTextResponse();
      if (latestResp2.ok) {
        console.log(`    ─── Gemini 回复（第 ${latestResp2.index + 1} 条）───`);
        console.log(`    ${latestResp2.text.split('\n').join('\n    ')}`);
        console.log('    ────────────────────────');
      }
    }

    // ── 6. 获取全部回复，验证多轮记录 ──
    console.log('\n[6] 获取全部文字回复...');
    const allResp = await ops.getAllTextResponses();
    if (allResp.ok) {
      console.log(`    共 ${allResp.total} 条回复：`);
      for (const r of allResp.responses) {
        const preview = r.text.length > 80 ? r.text.slice(0, 80) + '...' : r.text;
        console.log(`    [${r.index}] ${preview}`);
      }
    } else {
      console.warn(`    ⚠ 获取全部回复失败: ${allResp.error}`);
    }

  } catch (err) {
    console.error('Error:', err);
  }

  console.log('\n[done] 文字对话测试完毕。按 Ctrl+C 退出。');
}

main().catch(console.error);
