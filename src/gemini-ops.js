/**
 * gemini-ops.js — Gemini 操作高层 API
 *
 * 职责：
 *   基于 operator.js 的底层原子操作，编排 Gemini 特定的业务流程。
 *   全部通过 CDP 实现，不往页面注入任何对象。
 */
import { createOperator } from './operator.js';
import { sleep } from './util.js';
import config from './config.js';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve as pathResolve, normalize as pathNormalize } from 'node:path';
import { removeWatermarkFromFile, removeWatermarkFromDataUrl } from './watermark-remover.js';

// ── Gemini 页面元素选择器 ──
const SELECTORS = {
  promptInput: [
    'div.ql-editor[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][aria-label*="Gemini"]',
    '[contenteditable="true"][data-placeholder*="Gemini"]',
    'div[contenteditable="true"][role="textbox"]',
  ],
  /** 输入区底部按钮的父容器（包裹麦克风 + 发送按钮） */
  actionBtnWrapper: [
    'div.input-buttons-wrapper-bottom',
  ],
  /** 麦克风容器 — class 带 hidden 时隐藏（表示输入框有文字） */
  micContainer: [
    'div.mic-button-container',
  ],
  /** 发送按钮容器 — class 带 visible 时可见（输入框有文字），否则隐藏 */
  sendBtnContainer: [
    'div.send-button-container',
  ],
  /** 发送按钮本身 — class 末尾 submit（可发送）或 stop（加载中） */
  sendBtn: [
    '.send-button-container button.send-button',
    '.send-button-container button',
  ],
  newChatBtn: [
    '[data-test-id="new-chat-button"] a',
    '[data-test-id="new-chat-button"]',
    'a[aria-label="发起新对话"]',
    'a[aria-label*="new chat" i]',
  ],
  modelBtn: [
    '[data-test-id="bard-mode-menu-button"]',      // 测试专属属性
    'button[aria-label="打开模式选择器"]',            // 中文 aria-label
    'button[aria-label*="mode selector" i]',        // 英文 aria-label 兜底
    'button.mat-mdc-menu-trigger.input-area-switch',// class 组合兜底
  ],
  /** 模型标签文本容器（读取当前选中的模型名，如 "Pro"） */
  modelLabel: [
    '[data-test-id="logo-pill-label-container"] span',  // 最内层 span 包含模型名
    'div.logo-pill-label-container span',               // class 兜底
  ],
  /** 模型选项：Pro */
  modelOptionPro: [
    '[data-test-id="bard-mode-option-pro"]',        // 中英文统一
  ],
  /** 模型选项：快速 / Quick */
  modelOptionQuick: [
    '[data-test-id="bard-mode-option-快速"]',        // 中文
    '[data-test-id="bard-mode-option-quick"]',       // 英文
  ],
  /** 模型选项：思考 / Think */
  modelOptionThink: [
    '[data-test-id="bard-mode-option-思考"]',        // 中文
    '[data-test-id="bard-mode-option-think"]',       // 英文
    '[data-test-id="bard-mode-option-thinking"]',    // 英文变体
  ],
  tempChatBtn: [
    '[data-test-id="temp-chat-button"]',          // 最稳定：测试专属属性
    'button[aria-label="临时对话"]',                // 中文 aria-label
    'button[aria-label*="temporary" i]',           // 英文 aria-label 兜底
    'button.temp-chat-button',                     // class 名兜底
    'button[mattooltip="临时对话"]',                // Angular Material tooltip 属性
  ],
  sidebarContainer: [
    '[data-test-id="overflow-container"]',         // 测试专属属性
    'div.overflow-container',                      // class 兜底
  ],
  /** 加号面板按钮（点击后弹出上传菜单） */
  uploadPanelBtn: [
    'button.upload-card-button[aria-haspopup="menu"]', // class + aria 组合
    'button[aria-controls="upload-file-u"]',           // aria-controls 兜底
    'button.upload-card-button',                       // class 兜底
  ],
  /** 上传文件选项（加号面板展开后的"上传文件"按钮） */
  uploadFileBtn: [
    '[data-test-id="uploader-images-files-button-advanced"]', // 测试专属属性
    'images-files-uploader',                                  // 标签名兜底
  ],
  /** 图片分享按钮（hover 图片后出现） */
  shareImageBtn: [
    'button[data-test-id="share-button"]',
    'button[aria-label*="Share image" i]',
    'button[aria-label*="分享图片" i]',
  ],
  /** 分享弹窗容器 */
  shareDialog: [
    'mat-dialog-container',
    '[role="dialog"]',
    '.cdk-dialog-container',
    '.mat-mdc-dialog-container',
  ],
  /** 分享弹窗中的公开链接 */
  shareDialogLink: [
    'a[data-test-id="created-share-link"]',
    'a.link-url',
  ],
  /** 分享弹窗中的复制按钮 */
  shareDialogCopyBtn: [
    'button[data-test-id="copy-link"]',
    'button[aria-label*="Copy public link" i]',
    'button[aria-label*="Link copied" i]',
    'button[aria-label*="复制公开链接" i]',
    'button[aria-label*="已复制链接" i]',
  ],
  /** 分享弹窗关闭按钮 */
  shareDialogCloseBtn: [
    'button[data-test-id="close-dialog"]',
    'button[aria-label="Close"]',
    'button[aria-label="关闭"]',
  ],
};

/**
 * 创建 GeminiOps 操控实例
 * @param {import('puppeteer-core').Page} page
 */
export function createOps(page) {
  const op = createOperator(page);

  return {
    /** 暴露底层 operator，供高级用户直接使用 */
    operator: op,

    /** 暴露选择器定义，方便调试和外部扩展 */
    selectors: SELECTORS,

    /**
     * 探测页面各元素是否就位
     * @returns {Promise<{promptInput: boolean, actionBtnWrapper: boolean, newChatBtn: boolean, modelBtn: boolean, modelLabel: boolean, tempChatBtn: boolean, currentModel: string, status: object}>}
     */
    async probe() {
      const [promptInput, actionBtnWrapper, newChatBtn, modelBtn, modelLabel, tempChatBtn, status, currentModelResult] = await Promise.all([
        op.locate(SELECTORS.promptInput),
        op.locate(SELECTORS.actionBtnWrapper),
        op.locate(SELECTORS.newChatBtn),
        op.locate(SELECTORS.modelBtn),
        op.locate(SELECTORS.modelLabel),
        op.locate(SELECTORS.tempChatBtn),
        this.getStatus(),
        this.getCurrentModel(),
      ]);
      return {
        promptInput: promptInput.found,
        actionBtnWrapper: actionBtnWrapper.found,
        newChatBtn: newChatBtn.found,
        modelBtn: modelBtn.found,
        modelLabel: modelLabel.found,
        tempChatBtn: tempChatBtn.found,
        currentModel: currentModelResult.ok ? currentModelResult.raw : '',
        status,
      };
    },

    /**
     * 点击指定按钮
     * @param {'sendBtn'|'newChatBtn'|'modelBtn'|'tempChatBtn'|'modelOptionPro'|'modelOptionQuick'|'modelOptionThink'} key
     */
    async click(key) {
      const sels = SELECTORS[key];
      if (!sels) {
        return { ok: false, error: `unknown_key: ${key}` };
      }
      return op.click(sels);
    },

    /**
     * 进入临时会话模式
     *
     * 点击页面上的"临时会话"按钮（data-test-id="temp-chat-button"），
     * 然后等待页面完成导航 / 刷新，确保后续操作在临时会话中进行。
     *
     * @param {object} [opts]
     * @param {number} [opts.timeout=15000] - 等待页面导航完成的超时时间（ms）
     * @returns {Promise<{ok: boolean, error?: string}>}
     */
    async clickTempChat(opts = {}) {
      const { timeout = 15_000 } = opts;

      const clickResult = await this.click('tempChatBtn');
      if (!clickResult.ok) {
        return { ok: false, error: 'temp_chat_btn_not_found' };
      }
      //  给一点时间让 UI 稳定
      await sleep(500);

      console.log('[ops] entered temp chat mode');
      return { ok: true };
    },

    /**
     * 获取当前选中的模型名称
     *
     * 读取模型选择按钮中 logo-pill-label-container 内的 span 文本，
     * 返回去除空白后的小写文本（如 "pro"、"快速"、"思考"）。
     *
     * @returns {Promise<{ok: boolean, model: string, raw: string, error?: string}>}
     */
    async getCurrentModel() {
      return op.query((sels) => {
        let el = null;
        for (const sel of sels) {
          try { el = document.querySelector(sel); } catch { /* skip */ }
          if (el) break;
        }
        if (!el) {
          return { ok: false, model: '', raw: '', error: 'model_label_not_found' };
        }
        const raw = (el.textContent || '').trim();
        return { ok: true, model: raw.toLowerCase(), raw };
      }, SELECTORS.modelLabel);
    },

    /**
     * 判断当前模型是否为 Pro
     *
     * @returns {Promise<boolean>}
     */
    async isModelPro() {
      const result = await this.getCurrentModel();
      if (!result.ok) return false;
      return result.model === 'pro';
    },

    /**
     * 切换到指定模型
     *
     * 流程：
     *   1. 点击模型选择按钮，打开模型下拉菜单
     *   2. 等待菜单出现
     *   3. 点击目标模型选项
     *   4. 等待 UI 稳定
     *
     * @param {'pro'|'quick'|'think'} model - 目标模型
     * @returns {Promise<{ok: boolean, error?: string, previousModel?: string}>}
     */
    async switchToModel(model) {
      const selectorMap = {
        pro: SELECTORS.modelOptionPro,
        quick: SELECTORS.modelOptionQuick,
        think: SELECTORS.modelOptionThink,
      };

      const targetSels = selectorMap[model];
      if (!targetSels) {
        return { ok: false, error: `unknown_model: ${model}` };
      }

      // 记录切换前的模型
      const before = await this.getCurrentModel();
      const previousModel = before.ok ? before.raw : undefined;

      // 1. 点击模型选择按钮，打开下拉菜单
      const openResult = await this.click('modelBtn');
      if (!openResult.ok) {
        return { ok: false, error: 'model_menu_open_failed', previousModel };
      }

      // 2. 等待菜单动画展开
      await sleep(250);

      // 3. 点击目标模型选项
      const selectResult = await op.click(targetSels);
      if (!selectResult.ok) {
        return { ok: false, error: `model_option_${model}_not_found`, previousModel };
      }

      // 4. 等待 UI 稳定
      await sleep(800);

      console.log(`[ops] switched model: ${previousModel || '?'} → ${model}`);
      return { ok: true, previousModel };
    },

    /**
     * 确保当前模型为 Pro，如果不是则自动切换
     *
     * @returns {Promise<{ok: boolean, switched: boolean, previousModel?: string, error?: string}>}
     */
    async ensureModelPro() {
      const isPro = await this.isModelPro();
      if (isPro) {
        console.log('[ops] model is already Pro');
        return { ok: true, switched: false };
      }

      console.log('[ops] model is not Pro, switching...');
      const result = await this.switchToModel('pro');
      if (!result.ok) {
        return { ok: false, switched: false, error: result.error, previousModel: result.previousModel };
      }

      return { ok: true, switched: true, previousModel: result.previousModel };
    },

    /**
     * 填写提示词（快速填充，非逐字输入）
     * @param {string} text
     */
    async fillPrompt(text) {
      return op.fill(SELECTORS.promptInput, text);
    },

    /**
     * 获取输入区 action 按钮的详细状态
     *
     * 状态模型（基于 DOM class 判断）：
     *
     * ┌──────────────────────────────────────────────────────────────────┐
     * │  input-buttons-wrapper-bottom（父容器）                          │
     * │  ┌─────────────────────┐  ┌────────────────────────────────┐   │
     * │  │ mic-button-container│  │ send-button-container          │   │
     * │  │  class 带 hidden    │  │  class 带 visible / 无         │   │
     * │  │  → 输入框有文字     │  │  ┌──────────────────────────┐  │   │
     * │  │  class 无 hidden    │  │  │ button.send-button       │  │   │
     * │  │  → 输入框为空(待命) │  │  │  class 尾 submit → 可发送│  │   │
     * │  └─────────────────────┘  │  │  class 尾 stop   → 加载中│  │   │
     * │                           │  └──────────────────────────┘  │   │
     * │                           └────────────────────────────────┘   │
     * └──────────────────────────────────────────────────────────────────┘
     *
     * 返回值：
     *   - status: 'mic'     — 麦克风态（输入框为空，Gemini 待命）
     *   - status: 'submit'  — 发送态（输入框有文字，可点击发送）
     *   - status: 'stop'    — 加载态（Gemini 正在回答，按钮变为停止）
     *   - status: 'unknown' — 无法识别
     *
     * @returns {Promise<{status: 'mic'|'submit'|'stop'|'unknown', micHidden: boolean, sendVisible: boolean, btnClass: string, error?: string}>}
     */
    async getStatus() {
      return op.query((selectors) => {
        const { micContainer: micSels, sendBtnContainer: sendSels, sendBtn: btnSels } = selectors;

        // ── 查找麦克风容器 ──
        let micEl = null;
        for (const sel of micSels) {
          try { micEl = document.querySelector(sel); } catch { /* skip */ }
          if (micEl) break;
        }

        // ── 查找发送按钮容器 ──
        let sendContainerEl = null;
        for (const sel of sendSels) {
          try { sendContainerEl = document.querySelector(sel); } catch { /* skip */ }
          if (sendContainerEl) break;
        }

        // ── 查找发送按钮本身 ──
        let btnEl = null;
        for (const sel of btnSels) {
          try { btnEl = document.querySelector(sel); } catch { /* skip */ }
          if (btnEl) break;
        }

        // 都找不到则 unknown
        if (!micEl && !sendContainerEl) {
          return { status: 'unknown', micHidden: false, sendVisible: false, btnClass: '', error: 'containers_not_found' };
        }

        const micClass = micEl ? micEl.className : '';
        const sendClass = sendContainerEl ? sendContainerEl.className : '';
        const btnClass = btnEl ? btnEl.className : '';

        const micHidden = /\bhidden\b/.test(micClass);
        const sendVisible = /\bvisible\b/.test(sendClass);

        // ── 判断状态 ──
        // 1. 发送容器可见 → 看按钮 class 是 submit 还是 stop
        if (sendVisible) {
          if (/\bstop\b/.test(btnClass)) {
            return { status: 'stop', micHidden, sendVisible, btnClass };
          }
          if (/\bsubmit\b/.test(btnClass)) {
            return { status: 'submit', micHidden, sendVisible, btnClass };
          }
          // 发送容器可见但按钮 class 无法识别，降级为 submit
          return { status: 'submit', micHidden, sendVisible, btnClass };
        }

        // 2. 麦克风未隐藏 → 待命态（输入框为空）
        if (!micHidden) {
          return { status: 'mic', micHidden, sendVisible, btnClass };
        }

        // 3. 麦克风隐藏但发送容器不可见 → 可能的中间状态，用按钮 class 兜底
        if (/\bstop\b/.test(btnClass)) {
          return { status: 'stop', micHidden, sendVisible, btnClass };
        }

        return { status: 'unknown', micHidden, sendVisible, btnClass, error: 'ambiguous_state' };
      }, { micContainer: SELECTORS.micContainer, sendBtnContainer: SELECTORS.sendBtnContainer, sendBtn: SELECTORS.sendBtn });
    },

    /**
     * 判断 Gemini 当前的回答状态
     *
     * 基于 actionBtn 状态推导：
     *   - 'idle'       — 待命（麦克风态 或 发送态，Gemini 没在回答）
     *   - 'answering'  — 回答中（按钮为 stop 态，Gemini 正在生成）
     *
     * @returns {Promise<{answering: boolean, status: 'idle'|'answering', detail: object}>}
     */
    async getAnswerState() {
      const detail = await this.getActionBtnStatus();
      const answering = detail.status === 'stop';
      return {
        answering,
        status: answering ? 'answering' : 'idle',
        detail,
      };
    },

    /**
     * 单次轮询状态（保活式，不阻塞）
     */
    async pollStatus() {
      const status = await this.getStatus();
      const pageVisible = await op.query(() => !document.hidden);
      return { ...status, pageVisible, ts: Date.now() };
    },

    /**
     * 检查生成的图片是否加载完成
     *
     * 通过检测页面中 div.loader.animate 元素判断：
     *   存在 → 图片还在加载中
     *   不存在 → 加载完毕
     *
     * @returns {Promise<{loaded: boolean}>}
     */
    async checkImageLoaded() {
      return isImageLoaded(op);
    },

    /**
     * 获取当前会话中所有 Gemini 的文字回复
     *
     * 选择器：div.response-content
     * 直接使用 innerText 提取渲染后的文本，浏览器排版引擎会自动处理换行和格式
     *
     * @returns {Promise<{ok: boolean, responses: Array<{index: number, text: string}>, total: number, error?: string}>}
     */
    async getAllTextResponses() {
      return op.query(() => {
        const divs = [...document.querySelectorAll('div.response-content')];
        if (!divs.length) {
          return { ok: false, responses: [], total: 0, error: 'no_responses' };
        }

        const responses = divs.map((div, i) => ({
          index: i,
          text: (div.innerText || '').trim(),
        }));

        return { ok: true, responses, total: responses.length };
      });
    },

    /**
     * 获取最新一条 Gemini 文字回复
     *
     * 取最后一个 div.response-content，使用 innerText 提取渲染后的文本
     *
     * @returns {Promise<{ok: boolean, text?: string, index?: number, error?: string}>}
     */
    async getLatestTextResponse() {
      return op.query(() => {
        const divs = [...document.querySelectorAll('div.response-content')];
        if (!divs.length) {
          return { ok: false, error: 'no_responses' };
        }

        const last = divs[divs.length - 1];
        return { ok: true, text: (last.innerText || '').trim(), index: divs.length - 1 };
      });
    },

    /**
     * 获取本次会话中所有已加载的图片
     *
     * 选择器逻辑：
     *   - img.image.loaded — 历史已加载图片（不带 animate）
     *   - img.image.animate.loaded — 最新生成的图片（带入场动画）
     *   两者都匹配 img.image.loaded，所以用它拿全部。
     *
     * @returns {Promise<{ok: boolean, images: Array<{src: string, alt: string, width: number, height: number, isNew: boolean, index: number}>, total: number, newCount: number, error?: string}>}
     */
    async getAllImages() {
      return op.query(() => {
        const imgs = [...document.querySelectorAll('img.image.loaded')];
        if (!imgs.length) {
          return { ok: false, images: [], total: 0, newCount: 0, error: 'no_loaded_images' };
        }

        const images = imgs.map((img, i) => ({
          src: img.src || '',
          alt: img.alt || '',
          width: img.naturalWidth || 0,
          height: img.naturalHeight || 0,
          isNew: img.classList.contains('animate'),
          index: i,
        }));

        const newCount = images.filter(i => i.isNew).length;
        return { ok: true, images, total: images.length, newCount };
      });
    },

    /**
     * 获取最新生成的图片信息
     *
     * 优先查找带 animate class 的图片（刚生成的），
     * 如果没有则回退到最后一张已加载图片。
     *
     * @returns {Promise<{ok: boolean, src?: string, alt?: string, width?: number, height?: number, isNew?: boolean, hasDownloadBtn?: boolean, error?: string}>}
     */
    async getLatestImage() {
      return op.query(() => {
        // 优先：最新生成的图片（带 animate）
        const newImgs = [...document.querySelectorAll('img.image.animate.loaded')];
        // 回退：所有已加载图片
        const allImgs = [...document.querySelectorAll('img.image.loaded')];

        if (!allImgs.length) {
          return { ok: false, error: 'no_loaded_images' };
        }

        // 取最新生成的最后一张，没有则取全部的最后一张
        const img = newImgs.length > 0
          ? newImgs[newImgs.length - 1]
          : allImgs[allImgs.length - 1];
        const isNew = newImgs.length > 0 && newImgs[newImgs.length - 1] === img;

        // 查找下载按钮
        let container = img;
        while (container && container !== document.body) {
          if (container.classList?.contains('image-container')) break;
          container = container.parentElement;
        }
        const dlBtn = container
          ? (container.querySelector('mat-icon[fonticon="download"]')
            || container.querySelector('mat-icon[data-mat-icon-name="download"]'))
          : null;

        return {
          ok: true,
          src: img.src || '',
          alt: img.alt || '',
          width: img.naturalWidth || 0,
          height: img.naturalHeight || 0,
          isNew,
          hasDownloadBtn: !!dlBtn,
        };
      });
    },

    /**
    * 提取指定图片的 Base64 数据
    *
    * 策略（根据 URL 类型自动选择）：
    *   A. blob: URL →
    *      A1. Canvas drawImage（最可靠：只要 img 还在 DOM 上就能画，不受 blob revoke 影响）
    *      A2. 页面内 fetch + FileReader（Canvas 被 taint 时兜底）
    *   B. 非 blob URL → CDP loadNetworkResource（通过 CDP 协议绕过 CORS）
    *
    * @param {string} url - 目标图片的 src URL
    * @returns {Promise<{ok: boolean, dataUrl?: string, method?: 'canvas'|'fetch'|'cdp', error?: string}>}
     */
   async extractImageBase64(url) {
     if (!url) {
       console.warn('[extractImageBase64] ❌ 未提供 url 参数');
       return { ok: false, error: 'missing_url' };
     }
     console.log(`[extractImageBase64] 🔍 开始提取, url=${url.slice(0, 120)}...`);

     const isBlob = url.startsWith('blob:');

     // ── 策略 A: blob: URL → Canvas 绘制优先，fetch 兜底 ──
     // blob: URL 是页面自己创建的，img 已渲染在 DOM 上，Canvas drawImage 不会被 taint。
     // 如果 blob 已被 revoke，fetch 会失败，但 Canvas 只要 img 还在 DOM 上就能画。
     if (isBlob) {
       // ── A1: Canvas 提取（最可靠：只要图片还显示在页面上就能提取） ──
       console.log('[extractImageBase64] 🎨 检测到 blob: URL，尝试 Canvas 提取...');
       const canvasResult = await op.query((targetUrl) => {
         const imgs = [...document.querySelectorAll('img.image.loaded')];
         const img = imgs.find(i => i.src === targetUrl);
         if (!img) {
           // 如果精确匹配失败，回退到最后一张
           const fallback = imgs[imgs.length - 1];
           if (!fallback) return { ok: false, error: 'no_loaded_images', searched: 0 };
           // 用最后一张图片
           const w = fallback.naturalWidth || fallback.width;
           const h = fallback.naturalHeight || fallback.height;
           try {
             const canvas = document.createElement('canvas');
             canvas.width = w;
             canvas.height = h;
             canvas.getContext('2d').drawImage(fallback, 0, 0);
             const dataUrl = canvas.toDataURL('image/png');
             return { ok: true, dataUrl, width: w, height: h, method: 'canvas', note: 'fallback_to_last' };
           } catch (e) {
             return { ok: false, error: 'canvas_tainted', detail: e.message || String(e), width: w, height: h };
           }
         }
         const w = img.naturalWidth || img.width;
         const h = img.naturalHeight || img.height;
         try {
           const canvas = document.createElement('canvas');
           canvas.width = w;
           canvas.height = h;
           canvas.getContext('2d').drawImage(img, 0, 0);
           const dataUrl = canvas.toDataURL('image/png');
           return { ok: true, dataUrl, width: w, height: h, method: 'canvas' };
         } catch (e) {
           return { ok: false, error: 'canvas_tainted', detail: e.message || String(e), width: w, height: h, needFetch: true };
         }
       }, url);

       if (canvasResult.ok) {
         console.log(`[extractImageBase64] ✅ Canvas 提取成功 (${canvasResult.width}x${canvasResult.height}${canvasResult.note ? ', ' + canvasResult.note : ''})`);

         // 去水印处理
         const wmResult = await removeWatermarkFromDataUrl(canvasResult.dataUrl);
         if (wmResult.ok && !wmResult.skipped) {
           console.log(`[extractImageBase64] 🍌 水印已移除 (${wmResult.width}×${wmResult.height}, logo=${wmResult.logoSize}px)`);
           return { ok: true, dataUrl: wmResult.dataUrl, method: 'canvas' };
         } else if (wmResult.skipped) {
           console.log(`[extractImageBase64] 跳过去水印: ${wmResult.reason}`);
         } else {
           console.warn(`[extractImageBase64] 去水印失败（不影响提取结果）: ${wmResult.error}`);
         }

         return { ok: true, dataUrl: canvasResult.dataUrl, method: 'canvas' };
       }

       console.warn(`[extractImageBase64] ⚠ Canvas 提取失败: ${canvasResult.error}${canvasResult.detail ? ' — ' + canvasResult.detail : ''}`);

       // ── A2: 页面 fetch 兜底（blob 未被 revoke 时有效） ──
       if (canvasResult.needFetch || canvasResult.error === 'canvas_tainted') {
         console.log('[extractImageBase64] 📦 Canvas 被污染，尝试页面内 fetch 兜底...');
         try {
           const fetchResult = await op.query(async (src) => {
             try {
               const r = await fetch(src);
               if (!r.ok) return { ok: false, error: `fetch_status_${r.status}` };
               const blob = await r.blob();
               const mime = blob.type || 'image/png';
               return await new Promise((resolve) => {
                 const reader = new FileReader();
                 reader.onloadend = () => resolve({ ok: true, dataUrl: reader.result, mime, method: 'fetch' });
                 reader.onerror = () => resolve({ ok: false, error: 'filereader_error' });
                 reader.readAsDataURL(blob);
               });
             } catch (err) {
               return { ok: false, error: 'fetch_failed', detail: err.message || String(err) };
             }
           }, url);

           if (fetchResult.ok) {
             console.log(`[extractImageBase64] ✅ 页面 fetch 提取成功 (mime=${fetchResult.mime})`);

             // 去水印处理
             const wmResult = await removeWatermarkFromDataUrl(fetchResult.dataUrl);
             if (wmResult.ok && !wmResult.skipped) {
               console.log(`[extractImageBase64] 🍌 水印已移除 (${wmResult.width}×${wmResult.height}, logo=${wmResult.logoSize}px)`);
               return { ok: true, dataUrl: wmResult.dataUrl, method: 'fetch' };
             } else if (wmResult.skipped) {
               console.log(`[extractImageBase64] 跳过去水印: ${wmResult.reason}`);
             } else {
               console.warn(`[extractImageBase64] 去水印失败（不影响提取结果）: ${wmResult.error}`);
             }

             return { ok: true, dataUrl: fetchResult.dataUrl, method: 'fetch' };
           }
           console.warn(`[extractImageBase64] ⚠ 页面 fetch 也失败: ${fetchResult.error}`);
         } catch (err) {
           console.warn(`[extractImageBase64] ❌ 页面 fetch 异常: ${err.message || String(err)}`);
         }
       }

       return { ok: false, error: canvasResult.error || 'blob_extract_failed', detail: canvasResult.detail };
     }

     // ── 策略 B: 非 blob URL → CDP Network.loadNetworkResource（绕过 CORS） ──
     try {
        const client = page._client();
        const frameId = page.mainFrame()._id;

        console.log(`[extractImageBase64] 📡 CDP 请求中... frameId=${frameId}`);
        const { resource } = await client.send('Network.loadNetworkResource', {
          frameId,
          url,
          options: { disableCache: false, includeCredentials: true },
        });

        if (!resource.success) {
          const errMsg = `CDP 请求失败: httpStatusCode=${resource.httpStatusCode || 'N/A'}`;
          console.warn(`[extractImageBase64] ❌ ${errMsg}`);
          return { ok: false, error: 'cdp_request_failed', detail: errMsg };
        }

        // 通过 IO.read 读取 stream 数据
        const streamHandle = resource.stream;
        if (!streamHandle) {
          console.warn('[extractImageBase64] ❌ CDP 返回无 stream handle');
          return { ok: false, error: 'cdp_no_stream' };
        }

        // 【关键修复】：CDP IO.read 分块返回的 base64 不能直接拼接字符串！
        // 每个 chunk 是独立编码的 base64，末尾可能有 '=' 填充符，
        // 直接 join 会导致中间插入非法字符 → 解码后数据损坏。
        // 正确做法：先把每个 chunk 解码为 Buffer，拼接 Buffer，最后统一编码。
        const bufferChunks = [];
        let eof = false;
        while (!eof) {
          const { data, base64Encoded, eof: done } = await client.send('IO.read', {
            handle: streamHandle,
            size: 1024 * 1024, // 每次读 1MB
          });
          if (data) {
            bufferChunks.push(base64Encoded ? Buffer.from(data, 'base64') : Buffer.from(data));
          }
          eof = done;
        }
        await client.send('IO.close', { handle: streamHandle });

        const fullBuffer = Buffer.concat(bufferChunks);
        const base64Full = fullBuffer.toString('base64');
        // 从 response headers 推断 MIME；CDP 有时不提供，默认用 image/png
        const mime = (resource.headers?.['content-type'] || resource.headers?.['Content-Type'] || 'image/png').split(';')[0].trim();
        const dataUrl = `data:${mime};base64,${base64Full}`;

        console.log(`[extractImageBase64] ✅ CDP 提取成功 (mime=${mime}, size=${(base64Full.length * 0.75 / 1024).toFixed(1)}KB)`);

        // 去水印处理
        const wmResult = await removeWatermarkFromDataUrl(dataUrl);
        if (wmResult.ok && !wmResult.skipped) {
          console.log(`[extractImageBase64] 🍌 水印已移除 (${wmResult.width}×${wmResult.height}, logo=${wmResult.logoSize}px)`);
          return { ok: true, dataUrl: wmResult.dataUrl, method: 'cdp' };
        } else if (wmResult.skipped) {
          console.log(`[extractImageBase64] 跳过去水印: ${wmResult.reason}`);
        } else {
          console.warn(`[extractImageBase64] 去水印失败（不影响提取结果）: ${wmResult.error}`);
        }

        return { ok: true, dataUrl, method: 'cdp' };
      } catch (err) {
        const errMsg = err.message || String(err);
        console.warn(`[extractImageBase64] ❌ CDP 提取异常: ${errMsg}`);
        return { ok: false, error: 'cdp_error', detail: errMsg };
      }
    },

    /**
     * 点击最新图片的下载按钮
     */
    async downloadLatestImage() {
      return op.query(() => {
        const imgs = [...document.querySelectorAll('img.image.loaded')];
        if (!imgs.length) return { ok: false, error: 'no_loaded_images' };

        const img = imgs[imgs.length - 1];
        let container = img;
        while (container && container !== document.body) {
          if (container.classList?.contains('image-container')) break;
          container = container.parentElement;
        }
        const dlBtn = container
          ? (container.querySelector('mat-icon[fonticon="download"]')
            || container.querySelector('mat-icon[data-mat-icon-name="download"]'))
          : null;

        if (!dlBtn) return { ok: false, error: 'download_btn_not_found' };

        const clickable = dlBtn.closest('button,[role="button"],.button-icon-wrapper') || dlBtn;
        clickable.click();
        return { ok: true, src: img.src || '' };
      });
    },

    /**
     * 下载完整尺寸的图片
     *
     * 流程：
     *   1. 定位目标图片，获取坐标用于 hover
     *   2. 通过 CDP Browser.setDownloadBehavior 将下载目录重定向到 config.outputDir
     *   3. hover 触发工具栏 → 点击"下载完整尺寸"按钮
     *   4. 监听 CDP Browser.downloadWillBegin / Browser.downloadProgress 等待下载完成
     *   5. 返回实际保存的文件路径
     *
     * 按钮选择器：button[data-test-id="download-enhanced-image-button"]
     *
     * @param {object} [options]
     * @param {number} [options.index] - 图片索引（从0开始，从旧到新），不传则取最新一张
     * @param {number} [options.timeout=30000] - 下载超时时间（ms）
     * @returns {Promise<{ok: boolean, filePath?: string, suggestedFilename?: string, src?: string, index?: number, total?: number, error?: string}>}
     */
    async downloadFullSizeImage({ index, timeout = 30_000 } = {}) {
      // 1a. 先将目标图片滚动到屏幕正中间，避免视口外的元素无法交互
      const scrollResult = await op.query((targetIndex) => {
        const imgs = [...document.querySelectorAll('img.image.loaded')];
        if (!imgs.length) return { ok: false, error: 'no_loaded_images', total: 0 };

        const i = targetIndex == null ? imgs.length - 1 : targetIndex;
        if (i < 0 || i >= imgs.length) {
          return { ok: false, error: 'index_out_of_range', total: imgs.length, requestedIndex: i };
        }

        const img = imgs[i];
        // 【关键修复】：强行把图片滚到屏幕正中间，避免视口外的元素无法交互
        img.scrollIntoView({ behavior: 'instant', block: 'center' });
        return { ok: true, index: i, total: imgs.length };
      }, index);

      if (!scrollResult.ok) return scrollResult;

      // 1b. 等待滚动和重排完成后，再获取准确的坐标
      await sleep(500);

      const imgInfo = await op.query((targetIndex) => {
        const imgs = [...document.querySelectorAll('img.image.loaded')];
        const i = targetIndex == null ? imgs.length - 1 : targetIndex;
        const img = imgs[i];
        const rect = img.getBoundingClientRect();
        return {
          ok: true,
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          src: img.src || '',
          index: i,
          total: imgs.length,
        };
      }, scrollResult.index);

      console.log('[downloadFullSizeImage] imgInfo', imgInfo);

      if (!imgInfo.ok) return imgInfo;

      // 2. 通过 CDP 设置下载路径到 config.outputDir
      //    用 resolve() 规范化路径，确保 Windows Server 上是标准反斜杠路径
      const { resolve: pathResolve } = await import('node:path');
      const downloadDir = pathResolve(config.outputDir);
      mkdirSync(downloadDir, { recursive: true });

      const client = page._client();
      await client.send('Browser.setDownloadBehavior', {
        behavior: 'allow',       // 不用 allowAndName，避免 GUID 临时文件被 Windows Server 安全策略拦截
        downloadPath: downloadDir,
        eventsEnabled: true,
      });

      // 3. 设置下载监听（在点击前注册，避免遗漏事件）
      const downloadPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          client.off('Browser.downloadWillBegin', onBegin);
          client.off('Browser.downloadProgress', onProgress);
          reject(new Error('download_timeout'));
        }, timeout);

        let suggestedFilename = null;

        function onBegin(evt) {
          suggestedFilename = evt.suggestedFilename || null;
        }

        function onProgress(evt) {
          if (evt.state === 'completed') {
            clearTimeout(timer);
            client.off('Browser.downloadWillBegin', onBegin);
            client.off('Browser.downloadProgress', onProgress);
            resolve({ suggestedFilename });
          } else if (evt.state === 'canceled') {
            clearTimeout(timer);
            client.off('Browser.downloadWillBegin', onBegin);
            client.off('Browser.downloadProgress', onProgress);
            reject(new Error('download_canceled'));
          }
        }

        client.on('Browser.downloadWillBegin', onBegin);
        client.on('Browser.downloadProgress', onProgress);
      });

      // 4. hover 到图片上，触发工具栏显示
      console.log(`[downloadFullSizeImage] hover 到 (${imgInfo.x}, ${imgInfo.y})...`);
      await page.mouse.move(imgInfo.x, imgInfo.y);
      await sleep(800);

      // 5. 点击"下载完整尺寸"按钮（带重试：hover 可能需要更长时间触发工具栏）
      const btnSelector = 'button[data-test-id="download-generated-image-button"]';

      let clickResult;
      for (let attempt = 1; attempt <= 3; attempt++) {
        clickResult = await op.click(btnSelector);
        if (clickResult.ok) break;
        // 按钮还没出来，可能工具栏动画还没完成，再 hover 一次并多等一会儿
        console.log(`[downloadFullSizeImage] 第${attempt}次点击下载按钮失败，重试 hover...`);
        await page.mouse.move(imgInfo.x, imgInfo.y);
        await sleep(500);
      }

      if (!clickResult.ok) {
        return { ok: false, error: 'full_size_download_btn_not_found', src: imgInfo.src, index: imgInfo.index, total: imgInfo.total };
      }

      // 6. 等待下载完成
      //    allow 模式下，Chrome 直接用 suggestedFilename 保存到 downloadDir，无需重命名。
      try {
        const { suggestedFilename } = await downloadPromise;
        const { join } = await import('node:path');
        const { existsSync } = await import('node:fs');

        const targetName = suggestedFilename || `gemini_fullsize_${Date.now()}.png`;
        const filePath = join(downloadDir, targetName);

        if (!existsSync(filePath)) {
          console.warn(`[ops] 下载文件未找到: ${filePath}`);
          return { ok: false, error: 'downloaded_file_not_found', filePath, src: imgInfo.src, index: imgInfo.index, total: imgInfo.total };
        }

        // 去水印处理
        const wmResult = await removeWatermarkFromFile(filePath);
        if (wmResult.ok && !wmResult.skipped) {
          console.log(`[ops] 水印已移除 (${wmResult.width}×${wmResult.height}, logo=${wmResult.logoSize}px)`);
        } else if (wmResult.skipped) {
          console.log(`[ops] 跳过去水印: ${wmResult.reason}`);
        } else {
          console.warn(`[ops] 去水印失败（不影响下载结果）: ${wmResult.error}`);
        }

        return {
          ok: true,
          filePath,
          suggestedFilename: targetName,
          src: imgInfo.src,
          index: imgInfo.index,
          total: imgInfo.total,
        };
      } catch (err) {
        return {
          ok: false,
          error: err.message,
          src: imgInfo.src,
          index: imgInfo.index,
          total: imgInfo.total,
        };
      }
    },

    /**
     * 为当前会话中的图片创建 Gemini 公开分享链接
     *
     * 流程：
     *   1. 关闭可能残留的旧分享弹窗
     *   2. 将目标图片滚动到视口中央并 hover，触发图片工具栏
     *   3. 点击 Share image
     *   4. 等待 Gemini 生成 share 链接
     *   5. 读取链接；若复制按钮可用则顺手点击复制
     *   6. 按需关闭弹窗
     *
     * @param {object} [options]
     * @param {number} [options.index] - 图片索引（从0开始，从旧到新），不传则分享最新一张
     * @param {number} [options.timeout=30000] - 等待 share 链接生成的超时时间（ms）
     * @param {boolean} [options.copyToClipboard=true] - 是否点击“Copy link”
     * @param {boolean} [options.closeDialog=true] - 完成后是否关闭分享弹窗
     * @returns {Promise<{ok: boolean, link?: string, copiedToClipboard?: boolean, dialogClosed?: boolean, index?: number, total?: number, src?: string, error?: string, detail?: string}>}
     */
    async shareLatestImage({ index, timeout = 30_000, copyToClipboard = true, closeDialog = true } = {}) {
      const staleDialog = await this.closeShareDialog({ timeout: 2_000 });
      if (!staleDialog.ok) return staleDialog;

      const imgInfo = await op.query((targetIndex) => {
        const imgs = [...document.querySelectorAll('img.image.loaded')];
        if (!imgs.length) return { ok: false, error: 'no_loaded_images', total: 0 };

        const i = targetIndex == null ? imgs.length - 1 : targetIndex;
        if (i < 0 || i >= imgs.length) {
          return { ok: false, error: 'index_out_of_range', total: imgs.length, requestedIndex: i };
        }

        const img = imgs[i];
        img.scrollIntoView({ behavior: 'instant', block: 'center' });
        const rect = img.getBoundingClientRect();
        return {
          ok: true,
          index: i,
          total: imgs.length,
          src: img.src || '',
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      }, index);

      if (!imgInfo.ok) return imgInfo;

      await sleep(500);

      let shareBtnInfo = null;
      for (let attempt = 1; attempt <= 5; attempt++) {
        await page.mouse.move(imgInfo.x, imgInfo.y);
        await sleep(400);

        shareBtnInfo = await op.query((targetIndex, selectors) => {
          const imgs = [...document.querySelectorAll('img.image.loaded')];
          const i = targetIndex == null ? imgs.length - 1 : targetIndex;
          const img = imgs[i];
          if (!img) return { ok: false, error: 'image_not_found' };

          const container = img.closest('.image-container') || img.parentElement?.closest('.image-container');
          if (!container) return { ok: false, error: 'image_container_not_found' };

          let btn = null;
          for (const sel of selectors) {
            try {
              const candidates = [...container.querySelectorAll(sel)];
              btn = candidates.find((el) => {
                const rect = el.getBoundingClientRect();
                const style = getComputedStyle(el);
                return rect.width > 0 && rect.height > 0
                  && style.display !== 'none'
                  && style.visibility !== 'hidden'
                  && style.opacity !== '0';
              }) || null;
            } catch { /* skip bad selector */ }
            if (btn) break;
          }

          if (!btn) return { ok: false, error: 'share_btn_not_found' };

          const rect = btn.getBoundingClientRect();
          return {
            ok: true,
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };
        }, imgInfo.index, SELECTORS.shareImageBtn);

        if (shareBtnInfo.ok) break;
        await sleep(400);
      }

      if (!shareBtnInfo?.ok) {
        return {
          ok: false,
          error: 'share_btn_not_found',
          src: imgInfo.src,
          index: imgInfo.index,
          total: imgInfo.total,
        };
      }

      await page.mouse.move(shareBtnInfo.x, shareBtnInfo.y);
      await sleep(120);
      await page.mouse.down();
      await sleep(80);
      await page.mouse.up();

      const dialogReady = await op.waitFor((selectors) => {
        const dialogs = [];
        const seen = new Set();

        for (const sel of selectors) {
          try {
            for (const el of document.querySelectorAll(sel)) {
              if (seen.has(el)) continue;
              seen.add(el);
              dialogs.push(el);
            }
          } catch { /* skip */ }
        }

        return dialogs.some((el) => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 0
            && rect.height > 0
            && style.display !== 'none'
            && style.visibility !== 'hidden'
            && style.opacity !== '0'
            && (!el.classList.contains('mdc-dialog') || el.classList.contains('mdc-dialog--open'));
        });
      }, { timeout: Math.min(timeout, 10_000), interval: 250, args: [SELECTORS.shareDialog] });

      if (!dialogReady.ok) {
        return {
          ok: false,
          error: 'share_dialog_not_found',
          src: imgInfo.src,
          index: imgInfo.index,
          total: imgInfo.total,
        };
      }

      const deadline = Date.now() + timeout;
      let shareState = null;

      while (Date.now() < deadline) {
        shareState = await op.query((dialogSelectors, linkSelectors, copySelectors, closeSelectors) => {
          const dialogs = [];
          const seen = new Set();

          for (const sel of dialogSelectors) {
            try {
              for (const el of document.querySelectorAll(sel)) {
                if (seen.has(el)) continue;
                seen.add(el);
                const rect = el.getBoundingClientRect();
                const style = getComputedStyle(el);
                const visible = rect.width > 0
                  && rect.height > 0
                  && style.display !== 'none'
                  && style.visibility !== 'hidden'
                  && style.opacity !== '0'
                  && (!el.classList.contains('mdc-dialog') || el.classList.contains('mdc-dialog--open'));
                if (visible) dialogs.push(el);
              }
            } catch { /* skip */ }
          }

          const dialog = dialogs.at(-1) || null;
          if (!dialog) return { ok: false, error: 'share_dialog_not_found' };

          const findFirst = (selectors) => {
            for (const sel of selectors) {
              try {
                const el = dialog.querySelector(sel);
                if (el) return el;
              } catch { /* skip */ }
            }
            return null;
          };

          const linkEl = findFirst(linkSelectors);
          const copyBtn = findFirst(copySelectors);
          const closeBtn = findFirst(closeSelectors);
          const text = (dialog.innerText || '').trim();

          const copyRect = copyBtn ? copyBtn.getBoundingClientRect() : null;
          const closeRect = closeBtn ? closeBtn.getBoundingClientRect() : null;

          return {
            ok: true,
            href: linkEl?.href || '',
            text,
            copyButton: copyBtn ? {
              disabled: !!copyBtn.disabled || copyBtn.classList.contains('disabled'),
              ariaLabel: copyBtn.getAttribute('aria-label') || '',
              text: (copyBtn.innerText || copyBtn.textContent || '').trim(),
              x: copyRect.left + copyRect.width / 2,
              y: copyRect.top + copyRect.height / 2,
            } : null,
            closeButton: closeBtn ? {
              x: closeRect.left + closeRect.width / 2,
              y: closeRect.top + closeRect.height / 2,
            } : null,
          };
        }, SELECTORS.shareDialog, SELECTORS.shareDialogLink, SELECTORS.shareDialogCopyBtn, SELECTORS.shareDialogCloseBtn);

        if (!shareState.ok) {
          await sleep(300);
          continue;
        }

        const shareLink = normalizeShareLink(shareState.href) || extractShareLinkFromText(shareState.text);
        if (shareLink) {
          let copiedToClipboard = false;

          if (copyToClipboard && shareState.copyButton) {
            const btnState = `${shareState.copyButton.ariaLabel} ${shareState.copyButton.text}`.toLowerCase();
            if (shareState.copyButton.disabled || btnState.includes('link copied') || btnState.includes('已复制链接')) {
              copiedToClipboard = true;
            } else {
              await page.mouse.move(shareState.copyButton.x, shareState.copyButton.y);
              await sleep(100);
              await page.mouse.down();
              await sleep(60);
              await page.mouse.up();
              copiedToClipboard = true;
              await sleep(250);
            }
          }

          let dialogClosed = false;
          if (closeDialog) {
            const closeResult = await this.closeShareDialog({ timeout: 5_000 });
            if (!closeResult.ok) return closeResult;
            dialogClosed = closeResult.closed;
          }

          return {
            ok: true,
            link: shareLink,
            copiedToClipboard,
            dialogClosed,
            src: imgInfo.src,
            index: imgInfo.index,
            total: imgInfo.total,
          };
        }

        await sleep(500);
      }

      return {
        ok: false,
        error: 'share_link_timeout',
        detail: shareState?.text?.slice(0, 200) || '',
        src: imgInfo.src,
        index: imgInfo.index,
        total: imgInfo.total,
      };
    },

    /**
     * 关闭分享弹窗（如果存在）
     *
     * @param {object} [options]
     * @param {number} [options.timeout=5000] - 等待弹窗消失的超时时间（ms）
     * @returns {Promise<{ok: boolean, hadDialog?: boolean, closed?: boolean, error?: string}>}
     */
    async closeShareDialog({ timeout = 5_000 } = {}) {
      let closedAny = false;

      for (let attempt = 1; attempt <= 5; attempt++) {
        const closeInfo = await op.query((dialogSelectors, closeSelectors) => {
          const dialogs = [];
          const seen = new Set();

          for (const sel of dialogSelectors) {
            try {
              for (const el of document.querySelectorAll(sel)) {
                if (seen.has(el)) continue;
                seen.add(el);
                const rect = el.getBoundingClientRect();
                const style = getComputedStyle(el);
                const visible = rect.width > 0
                  && rect.height > 0
                  && style.display !== 'none'
                  && style.visibility !== 'hidden'
                  && style.opacity !== '0'
                  && (!el.classList.contains('mdc-dialog') || el.classList.contains('mdc-dialog--open'));
                if (visible) dialogs.push(el);
              }
            } catch { /* skip */ }
          }

          const dialog = dialogs.at(-1) || null;
          if (!dialog) {
            return { ok: true, hadDialog: false, closed: false, openCount: 0 };
          }

          let btn = null;
          for (const sel of closeSelectors) {
            try {
              const el = dialog.querySelector(sel);
              if (el) {
                btn = el;
                break;
              }
            } catch { /* skip */ }
          }

          if (!btn) return { ok: false, error: 'share_dialog_close_btn_not_found' };

          const rect = btn.getBoundingClientRect();
          return {
            ok: true,
            hadDialog: true,
            openCount: dialogs.length,
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };
        }, SELECTORS.shareDialog, SELECTORS.shareDialogCloseBtn);

        if (!closeInfo.ok) return closeInfo;
        if (!closeInfo.hadDialog) {
          return { ok: true, hadDialog: closedAny, closed: closedAny };
        }

        await page.mouse.move(closeInfo.x, closeInfo.y);
        await sleep(100);
        await page.mouse.down();
        await sleep(60);
        await page.mouse.up();

        const waitClose = await op.waitFor((selectors, previousCount) => {
          const dialogs = [];
          const seen = new Set();

          for (const sel of selectors) {
            try {
              for (const el of document.querySelectorAll(sel)) {
                if (seen.has(el)) continue;
                seen.add(el);
                const rect = el.getBoundingClientRect();
                const style = getComputedStyle(el);
                const visible = rect.width > 0
                  && rect.height > 0
                  && style.display !== 'none'
                  && style.visibility !== 'hidden'
                  && style.opacity !== '0'
                  && (!el.classList.contains('mdc-dialog') || el.classList.contains('mdc-dialog--open'));
                if (visible) dialogs.push(el);
              }
            } catch { /* skip */ }
          }

          return dialogs.length < previousCount;
        }, { timeout, interval: 200, args: [SELECTORS.shareDialog, closeInfo.openCount] });

        if (!waitClose.ok) {
          return { ok: false, error: 'share_dialog_close_timeout' };
        }

        closedAny = true;
      }

      return { ok: false, error: 'share_dialog_close_timeout' };
    },

    // ─── 高层组合操作 ───

    /**
     * 刷新当前页面
     *
     * 适用于页面卡住、状态异常等场景。
     * 刷新后会等待页面重新加载完成（waitUntil: networkidle2）。
     *
     * @param {object} [options]
     * @param {number} [options.timeout=30000] - 等待页面加载的超时时间（ms）
     * @returns {Promise<{ok: boolean, elapsed?: number, error?: string, detail?: string}>}
     */
    async reloadPage({ timeout = 30_000 } = {}) {
      try {
        const start = Date.now();
        await page.reload({ waitUntil: 'networkidle2', timeout });
        const elapsed = Date.now() - start;
        console.log(`[ops] 页面刷新完成 (${elapsed}ms)`);
        return { ok: true, elapsed };
      } catch (e) {
        return { ok: false, error: 'reload_failed', detail: e.message };
      }
    },

    /**
     * 导航到指定的 Gemini 页面 URL
     *
     * 仅允许 gemini.google.com 域名下的地址（如指定会话 URL），
     * 其他域名会直接拒绝，防止浏览器被劫持到不安全页面。
     *
     * @param {string} url - 目标 URL，必须是 gemini.google.com 域名
     * @param {object} [options]
     * @param {number} [options.timeout=30000] - 等待页面加载的超时时间（ms）
     * @returns {Promise<{ok: boolean, url?: string, elapsed?: number, error?: string, detail?: string}>}
     */
    async navigateTo(url, { timeout = 30_000 } = {}) {
      try {
        // 域名白名单校验
        const parsed = new URL(url);
        if (parsed.hostname !== 'gemini.google.com') {
          return {
            ok: false,
            error: 'invalid_domain',
            detail: `仅允许 gemini.google.com 域名，收到: ${parsed.hostname}`,
          };
        }

        const start = Date.now();
        await page.goto(url, { waitUntil: 'networkidle2', timeout });
        const elapsed = Date.now() - start;
        const finalUrl = page.url();
        console.log(`[ops] 页面导航完成 → ${finalUrl} (${elapsed}ms)`);
        return { ok: true, url: finalUrl, elapsed };
      } catch (e) {
        return { ok: false, error: 'navigate_failed', detail: e.message };
      }
    },

    /**
     * 上传图片到 Gemini 输入框
     *
     * 流程：
     *   1. 点击加号面板按钮，展开上传菜单
     *   2. 等待 300ms 让菜单动画稳定
     *   3. 拦截文件选择器 + 点击"上传文件"按钮（Promise.all 并发）
     *   4. 向文件选择器塞入指定图片路径
     *   5. 轮询等待图片加载完成（.image-preview.loading 消失）
     *
     * @param {string} filePath - 本地图片的绝对路径
     * @returns {Promise<{ok: boolean, elapsed?: number, warning?: string, error?: string, detail?: string}>}
     */
    async uploadImage(filePath) {
      try {
        // 路径规范化（兼容 Windows 反斜杠、混合斜杠等）
        filePath = pathResolve(pathNormalize(filePath));

        if (!existsSync(filePath)) {
          return { ok: false, error: 'file_not_found', detail: `文件不存在: ${filePath}` };
        }

        // 1. 点击加号面板按钮，展开上传菜单
        const panelClick = await this.click('uploadPanelBtn');
        if (!panelClick.ok) {
          return { ok: false, error: 'upload_panel_click_failed', detail: panelClick.error };
        }

        // 2. 等待菜单动画稳定
        await sleep(250);

        // 3. Promise.all 是精髓：一边开始监听文件选择器弹窗，一边点击"上传文件"按钮
        const [fileChooser] = await Promise.all([
          page.waitForFileChooser({ timeout: 5_000 }),
          this.click('uploadFileBtn'),
        ]);

        // 4. 弹窗被拦截，塞入文件
        await fileChooser.accept([filePath]);
        console.log(`[ops] 文件已塞入，等待 Gemini 加载图片...`);

        // 5. 等待图片加载完成（.image-preview.loading 消失）
        const loadTimeout = 15_000;
        const loadInterval = 500;
        const loadStart = Date.now();
        await sleep(500); //  短暂等待 UI 响应
        while (Date.now() - loadStart < loadTimeout) {
          const loading = await op.query(() => {
            const el = document.querySelector('.image-preview.loading');
            return !!el;
          });
          if (!loading) {
            console.log(`[ops] 图片上传成功 (${Date.now() - loadStart}ms): ${filePath}`);
            return { ok: true, elapsed: Date.now() - loadStart };
          }
          await sleep(loadInterval);
        }

        // 超时了但文件已经塞进去了，不算完全失败
        console.warn(`[ops] 图片加载超时 (${loadTimeout}ms)，但文件已提交`);
        return { ok: true, warning: 'load_timeout', elapsed: Date.now() - loadStart };
      } catch (e) {
        return { ok: false, error: 'upload_image_failed', detail: e.message };
      }
    },

    /**
     * 发送提示词并等待生成完成
     * @param {string} prompt
     * @param {object} [opts]
     * @param {number} [opts.timeout=120000]
     * @param {number} [opts.interval=8000]
     * @param {(status: object) => void} [opts.onPoll]
     * @returns {Promise<{ok: boolean, elapsed: number, finalStatus?: object, error?: string}>}
     */
    async sendAndWait(prompt, opts = {}) {
      const { timeout = 120_000, interval = 1_000, onPoll } = opts;

      // 1. 填写
      const fillResult = await this.fillPrompt(prompt);
      if (!fillResult.ok) {
        return { ok: false, error: 'fill_failed', detail: fillResult, elapsed: 0 };
      }

      // 短暂等待 UI 响应
      await sleep(300);

      // 2. 点击发送
      const clickResult = await this.click('sendBtn');
      if (!clickResult.ok) {
        return { ok: false, error: 'send_click_failed', detail: clickResult, elapsed: 0 };
      }

      // 3. 轮询等待（回到麦克风态 = Gemini 回答完毕）
      const start = Date.now();
      let lastStatus = null;

      while (Date.now() - start < timeout) {
        await sleep(interval);

        const poll = await this.pollStatus();
        lastStatus = poll;
        onPoll?.(poll);

        if (poll.status === 'mic') {
          // 回复完成，自动提取最新文字回复
          const textResp = await this.getLatestTextResponse();
          return {
            ok: true,
            elapsed: Date.now() - start,
            finalStatus: poll,
            text: textResp.ok ? textResp.text : null,
            textIndex: textResp.ok ? textResp.index : null,
          };
        }
        if (poll.status === 'unknown') {
          console.warn('[ops] unknown status, may need screenshot to debug');
        }
      }

      return { ok: false, error: 'timeout', elapsed: Date.now() - start, finalStatus: lastStatus };
    },

    /**
     * 完整生图流程：发送提示词 → 等待 → 提取图片
     * 注意：新建会话、上传参考图等前置操作由调用方负责
     * @param {string} prompt
     * @param {object} [opts]
     * @param {number} [opts.timeout=120000]
     * @param {boolean} [opts.fullSize=false] - true 时通过 CDP 拦截下载完整尺寸原图到 outputDir；false 时提取页面预览图 base64
     * @param {(status: object) => void} [opts.onPoll]
     */
    async generateImage(prompt, opts = {}) {
      const { timeout = 120_000, fullSize = false, onPoll } = opts;

      // 1. 发送并等待
      const waitResult = await this.sendAndWait(prompt, { timeout, onPoll });
      if (!waitResult.ok) {
        return { ...waitResult, step: 'sendAndWait' };
      }

      // 3. 等图片渲染完成
      await sleep(2000);

      // 4. 获取图片
      let imgInfo = await this.getLatestImage();
      if (!imgInfo.ok) {
        await sleep(3000);
        imgInfo = await this.getLatestImage();
        if (!imgInfo.ok) {
          return { ok: false, error: 'no_image_found', elapsed: waitResult.elapsed, imgInfo };
        }
      }

      // 5. 提取 / 下载
      if (fullSize) {
        // 完整尺寸下载：通过 CDP 拦截，文件保存到 config.outputDir
        const dlResult = await this.downloadFullSizeImage();
        return { ok: dlResult.ok, method: 'fullSize', elapsed: waitResult.elapsed, ...dlResult };
      } else {
        // 低分辨率：提取页面预览图的 base64
        const b64Result = await this.extractImageBase64(imgInfo.src);
        return { ok: b64Result.ok, method: b64Result.method, elapsed: waitResult.elapsed, ...b64Result };
      }
    },

    /** 底层 page 引用 */
    get page() {
      return page;
    },

    /**
     * 检查是否已登录 Google 账号
     *
     * @returns {Promise<{ok: boolean, loggedIn: boolean, barText?: string, error?: string}>}
     */
    async checkLogin() {
      return isLoggedIn(op);
    },
  };
}

/**
 * 判断侧边栏是否处于展开状态（内部工具函数，不对外暴露）
 *
 * 通过 overflow-container 元素的实际渲染宽度判断：
 *   - width >= 100px → 展开
 *   - width <  100px → 折叠
 *
 * @param {ReturnType<typeof createOperator>} op
 * @returns {Promise<{ok: boolean, expanded: boolean, width: number, error?: string}>}
 */
function isSidebarExpanded(op) {
  return op.query((sels) => {
    let el = null;
    for (const sel of sels) {
      try { el = document.querySelector(sel); } catch { /* skip */ }
      if (el) break;
    }
    if (!el) {
      return { ok: false, expanded: false, width: 0, error: 'sidebar_container_not_found' };
    }
    const width = el.getBoundingClientRect().width;
    return { ok: true, expanded: width >= 100, width };
  }, SELECTORS.sidebarContainer);
}

/**
 * 检查生成的图片是否加载完成
 *
 * 判断依据：页面中是否存在 div.loader.animate 元素。
 * 存在 → 图片还在加载；不存在 → 加载完毕。
 *
 * @param {ReturnType<typeof createOperator>} op
 * @returns {Promise<{loaded: boolean}>}
 */
function isImageLoaded(op) {
  return op.query(() => {
    const loader = document.querySelector('div.loader.animate');
    return { loaded: !loader };
  });
}

/**
 * 检查是否已登录 Google 账号
 *
 * 判断依据：顶部导航栏 div.boqOnegoogleliteOgbOneGoogleBar 的 innerText
 * 包含"登录"或"sign in"（不区分大小写）则视为未登录
 *
 * @param {ReturnType<typeof createOperator>} op
 * @returns {Promise<{ok: boolean, loggedIn: boolean, barText?: string, error?: string}>}
 */
function isLoggedIn(op) {
  return op.query(() => {
    const bar = document.querySelector('div.boqOnegoogleliteOgbOneGoogleBar');
    if (!bar) {
      return { ok: false, loggedIn: false, error: 'login_bar_not_found' };
    }

    const text = (bar.innerText || '').trim();
    const lower = text.toLowerCase();
    const notLoggedIn = lower.includes('登录') || lower.includes('sign in');

    return { ok: true, loggedIn: !notLoggedIn, barText: text };
  });
}

/**
 * 规范化 Gemini 分享链接
 *
 * @param {string} raw
 * @returns {string}
 */
function normalizeShareLink(raw) {
  if (!raw) return '';

  const trimmed = raw.trim();
  if (!trimmed) return '';

  if (/^https:\/\/gemini\.google\.com\/share\/[A-Za-z0-9_-]+$/i.test(trimmed)) {
    return trimmed;
  }

  if (/^gemini\.google\.com\/share\/[A-Za-z0-9_-]+$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return '';
}

/**
 * 从文本中提取 Gemini 分享链接
 *
 * @param {string} text
 * @returns {string}
 */
function extractShareLinkFromText(text) {
  if (!text) return '';

  const match = text.match(/(?:https?:\/\/)?gemini\.google\.com\/share\/[A-Za-z0-9_-]+/i);
  if (!match) return '';

  return normalizeShareLink(match[0]);
}
