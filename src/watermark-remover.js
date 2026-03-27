/**
 * watermark-remover.js — Gemini 图片水印移除
 *
 * 基于反向 Alpha 混合算法，精确还原被 Gemini 添加水印的图片。
 *
 * 算法移植自 gemini-watermark-remover（by journey-ad / Jad）
 * 原始仓库：https://github.com/journey-ad/gemini-watermark-remover
 * 许可证：MIT - Copyright (c) 2025 Jad
 *
 * 原理：
 *   Gemini 水印叠加公式: watermarked = α × 255 + (1 - α) × original
 *   反向求解:            original = (watermarked - α × 255) / (1 - α)
 */
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 常量 ──
const ALPHA_THRESHOLD = 0.002; // 忽略极小的 alpha 值（噪声）
const MAX_ALPHA = 0.99;        // 避免除以接近零的值
const LOGO_VALUE = 255;        // 白色水印的颜色值

// ── Alpha Map 缓存 ──
const alphaMapCache = {};

/**
 * 从水印背景捕获图中计算 Alpha Map
 * @param {Buffer} pngBuffer - 水印背景捕获图的 PNG 数据
 * @param {number} size - 水印尺寸（48 或 96）
 * @returns {Promise<Float32Array>} alpha 值数组（0.0 ~ 1.0）
 */
async function calculateAlphaMap(pngBuffer, size) {
  const { data, info } = await sharp(pngBuffer)
    .resize(size, size)
    .raw()
    .ensureAlpha()
    .toBuffer({ resolveWithObject: true });

  const pixelCount = info.width * info.height;
  const alphaMap = new Float32Array(pixelCount);
  const channels = info.channels; // 4 (RGBA)

  for (let i = 0; i < pixelCount; i++) {
    const idx = i * channels;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    // 取 RGB 三通道最大值归一化
    alphaMap[i] = Math.max(r, g, b) / 255.0;
  }

  return alphaMap;
}

/**
 * 获取指定尺寸的 Alpha Map（带缓存）
 * @param {number} size - 48 或 96
 * @returns {Promise<Float32Array>}
 */
async function getAlphaMap(size) {
  if (alphaMapCache[size]) return alphaMapCache[size];

  const bgFile = size === 48 ? 'bg_48.png' : 'bg_96.png';
  const bgPath = join(__dirname, 'assets', bgFile);
  const bgBuffer = readFileSync(bgPath);

  const alphaMap = await calculateAlphaMap(bgBuffer, size);
  alphaMapCache[size] = alphaMap;
  return alphaMap;
}

/**
 * 根据图片尺寸检测水印配置
 * @param {number} width - 图片宽度
 * @param {number} height - 图片高度
 * @returns {{ logoSize: number, marginRight: number, marginBottom: number }}
 */
function detectWatermarkConfig(width, height) {
  // Gemini 规则：宽高都 > 1024 用 96×96，否则用 48×48
  if (width > 1024 && height > 1024) {
    return { logoSize: 96, marginRight: 64, marginBottom: 64 };
  }
  return { logoSize: 48, marginRight: 16, marginBottom: 16 };
}

/**
 * 计算水印在图片中的位置（固定右下角）
 * @param {number} imgWidth
 * @param {number} imgHeight
 * @param {{ logoSize: number, marginRight: number, marginBottom: number }} config
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
function calculateWatermarkPosition(imgWidth, imgHeight, config) {
  const { logoSize, marginRight, marginBottom } = config;
  return {
    x: imgWidth - marginRight - logoSize,
    y: imgHeight - marginBottom - logoSize,
    width: logoSize,
    height: logoSize,
  };
}

/**
 * 对原始像素数据执行反向 Alpha 混合，移除水印
 *
 * @param {Buffer} pixels - RGBA 原始像素 Buffer（会被原地修改）
 * @param {number} imgWidth - 图片宽度
 * @param {Float32Array} alphaMap - Alpha 通道数据
 * @param {{ x: number, y: number, width: number, height: number }} position - 水印位置
 */
function removeWatermarkPixels(pixels, imgWidth, alphaMap, position) {
  const { x, y, width, height } = position;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const imgIdx = ((y + row) * imgWidth + (x + col)) * 4;
      const alphaIdx = row * width + col;

      let alpha = alphaMap[alphaIdx];

      // 跳过噪声
      if (alpha < ALPHA_THRESHOLD) continue;

      // 限制 alpha 避免除零
      alpha = Math.min(alpha, MAX_ALPHA);
      const oneMinusAlpha = 1.0 - alpha;

      // 对 R / G / B 三通道分别反向混合
      for (let c = 0; c < 3; c++) {
        const watermarked = pixels[imgIdx + c];
        const original = (watermarked - alpha * LOGO_VALUE) / oneMinusAlpha;
        pixels[imgIdx + c] = Math.max(0, Math.min(255, Math.round(original)));
      }
      // Alpha 通道不动
    }
  }
}

/**
 * 移除图片文件中的 Gemini 水印并覆盖保存
 *
 * @param {string} filePath - 图片文件路径（会被原地覆盖）
 * @returns {Promise<{ ok: boolean, width?: number, height?: number, logoSize?: number, error?: string }>}
 */
export async function removeWatermarkFromFile(filePath) {
  try {
    console.log(`[watermark-remover] 开始处理: ${filePath}`);

    // 1. 读取图片原始像素
    const image = sharp(filePath);
    const metadata = await image.metadata();
    const { width, height } = metadata;

    if (!width || !height) {
      return { ok: false, error: 'invalid_image_metadata' };
    }

    // 2. 检测水印配置
    const config = detectWatermarkConfig(width, height);
    const position = calculateWatermarkPosition(width, height, config);

    // 校验水印位置合法性
    if (position.x < 0 || position.y < 0) {
      console.log(`[watermark-remover] 图片太小（${width}×${height}），跳过去水印`);
      return { ok: true, width, height, skipped: true, reason: 'image_too_small' };
    }

    // 3. 获取 Alpha Map
    const alphaMap = await getAlphaMap(config.logoSize);

    // 4. 提取原始像素、执行反向混合
    const { data: pixels, info } = await sharp(filePath)
      .raw()
      .ensureAlpha()
      .toBuffer({ resolveWithObject: true });

    removeWatermarkPixels(pixels, info.width, alphaMap, position);

    // 5. 写回文件（保持原格式）
    const ext = (filePath.match(/\.(\w+)$/)?.[1] || 'png').toLowerCase();
    let outputPipeline = sharp(pixels, {
      raw: { width: info.width, height: info.height, channels: info.channels },
    });

    switch (ext) {
      case 'jpg':
      case 'jpeg':
        outputPipeline = outputPipeline.jpeg({ quality: 95 });
        break;
      case 'webp':
        outputPipeline = outputPipeline.webp({ quality: 95 });
        break;
      default:
        outputPipeline = outputPipeline.png();
        break;
    }

    await outputPipeline.toFile(filePath);

    console.log(`[watermark-remover] ✅ 去水印完成: ${width}×${height}, logo=${config.logoSize}px`);
    return { ok: true, width, height, logoSize: config.logoSize };
  } catch (err) {
    console.error(`[watermark-remover] ❌ 去水印失败: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

/**
 * 移除 base64 图片数据中的 Gemini 水印
 *
 * @param {string} dataUrl - data:image/xxx;base64,... 格式的图片
 * @returns {Promise<{ ok: boolean, dataUrl?: string, width?: number, height?: number, logoSize?: number, error?: string }>}
 */
export async function removeWatermarkFromDataUrl(dataUrl) {
  try {
    console.log('[watermark-remover] 开始处理 base64 图片');

    // 1. 解析 dataUrl
    const mimeMatch = dataUrl.match(/^data:(image\/\w+);base64,/);
    if (!mimeMatch) {
      return { ok: false, error: 'invalid_data_url' };
    }
    const mime = mimeMatch[1];
    const base64Data = dataUrl.slice(mimeMatch[0].length);
    const inputBuffer = Buffer.from(base64Data, 'base64');

    // 2. 读取图片信息
    const metadata = await sharp(inputBuffer).metadata();
    const { width, height } = metadata;

    if (!width || !height) {
      return { ok: false, error: 'invalid_image_metadata' };
    }

    // 3. 检测水印配置
    const config = detectWatermarkConfig(width, height);
    const position = calculateWatermarkPosition(width, height, config);

    if (position.x < 0 || position.y < 0) {
      console.log(`[watermark-remover] 图片太小（${width}×${height}），跳过去水印`);
      return { ok: true, dataUrl, width, height, skipped: true, reason: 'image_too_small' };
    }

    // 4. 获取 Alpha Map
    const alphaMap = await getAlphaMap(config.logoSize);

    // 5. 提取像素、反向混合
    const { data: pixels, info } = await sharp(inputBuffer)
      .raw()
      .ensureAlpha()
      .toBuffer({ resolveWithObject: true });

    removeWatermarkPixels(pixels, info.width, alphaMap, position);

    // 6. 编码回原格式
    const ext = mime.split('/')[1];
    let outputPipeline = sharp(pixels, {
      raw: { width: info.width, height: info.height, channels: info.channels },
    });

    switch (ext) {
      case 'jpeg':
      case 'jpg':
        outputPipeline = outputPipeline.jpeg({ quality: 95 });
        break;
      case 'webp':
        outputPipeline = outputPipeline.webp({ quality: 95 });
        break;
      default:
        outputPipeline = outputPipeline.png();
        break;
    }

    const outputBuffer = await outputPipeline.toBuffer();
    const outputBase64 = outputBuffer.toString('base64');
    const outputDataUrl = `data:${mime};base64,${outputBase64}`;

    console.log(`[watermark-remover] ✅ base64 去水印完成: ${width}×${height}, logo=${config.logoSize}px`);
    return { ok: true, dataUrl: outputDataUrl, width, height, logoSize: config.logoSize };
  } catch (err) {
    console.error(`[watermark-remover] ❌ base64 去水印失败: ${err.message}`);
    return { ok: false, error: err.message };
  }
}
