/**
 * demo.js — 使用示例
 *
 * 运行：
 *   node src/demo.js
 *
 * Daemon 未运行时会自动后台拉起，无需手动启动。
 * demo 只需通过 createGeminiSession() 获取会话即可。
 *
 * 所有配置项见 config.js / .env，也可通过命令行设环境变量：
 *   DAEMON_PORT=40225 DAEMON_TTL_MS=600000 node src/demo.js
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createGeminiSession, disconnect } from './index.js';

const prompt = 'Gemini你好！给我生成一张类似的图片';

/** 是否下载完整尺寸原图（true=CDP拦截下载高清大图，false=base64提取页面预览图） */
const FULL_SIZE = false;

/** 异步等待 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('=== Gemini Skill Demo ===\n');

  // 创建会话（自动连接 Daemon 托管的浏览器）
  const { ops } = await createGeminiSession();

  // ── Ctrl+C 时只断开连接，不杀浏览器进程（浏览器由 Daemon 守护） ──
  process.on('SIGINT', () => {
    console.log('\n[demo] Ctrl+C 收到，断开浏览器连接（浏览器仍由 Daemon 守护）...');
    disconnect();
    process.exit(0);
  });

  try {
    // 1. 进入临时会话（不留聊天记录，保持账号干净）
    // console.log('[1] 进入临时会话...');
    // const tempResult = await ops.clickTempChat();
    // if (!tempResult.ok) {
    //   console.warn('[1] 临时会话按钮未找到，跳过（可能已在临时模式或页面结构变化）');
    // } else {
    //   console.log('[1] 已进入临时会话');
    // }

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

    const uploadResult = await ops.uploadImage('./gemini-image/test.png');
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

      // 7. 获取图片
      console.log(`\n[7] 获取图片（模式: ${FULL_SIZE ? '完整尺寸原图' : 'base64 预览图'}）...`);

      if (FULL_SIZE) {
        // ── 完整尺寸原图：通过 CDP 拦截下载到 outputDir ──
        const dlResult = await ops.downloadFullSizeImage();
        if (dlResult.ok) {
          console.log(`[7] ✅ 完整尺寸图片已保存: ${dlResult.filePath} (原始文件名: ${dlResult.suggestedFilename})`);
        } else {
          console.warn(`[7] ⚠ 完整尺寸下载失败: ${dlResult.error}`);
        }
      } else {
        // ── base64 提取页面预览图 ──
        const imgInfo = await ops.getLatestImage();
        if (imgInfo.ok && imgInfo.src) {
          console.log(`[7] 找到图片 (${imgInfo.width}x${imgInfo.height}, isNew=${imgInfo.isNew})`);
          const b64Result = await ops.extractImageBase64(imgInfo.src);

          if (b64Result.ok && b64Result.dataUrl) {
            const matches = b64Result.dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
            if (matches) {
              const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
              const base64Data = matches[2];
              const buffer = Buffer.from(base64Data, 'base64');

              const outputDir = './gemini-image';
              if (!existsSync(outputDir)) {
                mkdirSync(outputDir, { recursive: true });
              }
              const filename = `gemini_${Date.now()}.${ext}`;
              const filepath = join(outputDir, filename);

              writeFileSync(filepath, buffer);
              console.log(`[7] ✅ 图片已保存(base64): ${filepath} (${(buffer.length / 1024).toFixed(1)} KB, method=${b64Result.method})`);
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
    }

  } catch (err) {
    console.error('Error:', err);
  }

  console.log('\n[done] 功能执行完毕，浏览器保持运行。按 Ctrl+C 退出。');
}

main().catch(console.error);
