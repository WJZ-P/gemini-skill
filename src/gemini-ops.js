/**
 * gemini-ops.js — Gemini 操作高层 API
 *
 * 职责：
 *   基于 operator.js 的底层原子操作，编排 Gemini 特定的业务流程。
 *   全部通过 CDP 实现，不往页面注入任何对象。
 */
import { createOperator } from './operator.js';

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
};

/**
 * 创建 GeminiOps 操控实例
 * @param {import('puppeteer-core').Page} page
 */
export function createOps(page) {
  const op = createOperator(page);

  // ── 图片请求缓存 map：URL → { requestId, ts } ──
  // 监听 Network.responseReceived，收集图片请求的 requestId，
  // 供 extractImageBase64 的 getResponseBody 缓存阶段使用。
  // 每条缓存 TTL 5 分钟，过期后 getResponseBody 大概率也失效。
  const IMAGE_CACHE_TTL = 5 * 60 * 1000; // 5 min
  const imageRequestMap = new Map();

  function setImageRequest(url, requestId) {
    //  先处理url已存在的情况，这个时候取消掉url的定时器
    if(imageRequestMap.has(url)) {
      const entry = imageRequestMap.get(url);
      clearTimeout(entry.timer);
    }
    const timer = setTimeout(() => {
      imageRequestMap.delete(url);
    }, IMAGE_CACHE_TTL);
    timer.unref();//  这个方法可以防止定时器影响进程退出
    imageRequestMap.set(url, {
      requestId,
      timer: timer,
    });
  }

  function getImageRequestId(url) {
    const entry = imageRequestMap.get(url);
    return entry ? entry.requestId : null;
  }

  (async () => {
    try {
      const client = page._client();
      await client.send('Network.enable');
      client.on('Network.responseReceived', (params) => {
        const { requestId, response } = params;
        const mime = response.mimeType || '';
        if (mime.startsWith('image/')) {
          setImageRequest(response.url, requestId);
        }
      });
    } catch (e) {
      console.warn('[ops] Network 监听初始化失败（不影响核心功能）:', e.message);
    }
  })();

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
      await sleep(800);

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
     * 四级降级策略：
     *   1. Canvas — 同步提取，最快（但跨域图片会被 taint）
     *   2. 页面 fetch — 异步读取 blob（受 CORS 限制，Google 图片通常不可用）
     *   3. CDP getResponseBody — 从浏览器内存缓存读取，零网络开销（需要 requestId 命中）
     *   4. CDP loadNetworkResource — 通过 CDP 协议用浏览器网络栈重新下载，绕过 CORS，终极兜底
     *
     * @param {string} url - 目标图片的 src URL
     * @returns {Promise<{ok: boolean, dataUrl?: string, width?: number, height?: number, method?: 'canvas'|'fetch'|'cdp-cache'|'cdp', error?: string}>}
     */
    async extractImageBase64(url) {
      if (!url) {
        console.warn('[extractImageBase64] ❌ 未提供 url 参数');
        return { ok: false, error: 'missing_url' };
      }
      console.log(`[extractImageBase64] 🔍 开始提取, url=${url.slice(0, 120)}...`);

      // ── 阶段 1: Canvas 提取 ──
      const canvasResult = await op.query((targetUrl) => {
        const imgs = [...document.querySelectorAll('img.image.loaded')];
        const img = imgs.find(i => i.src === targetUrl);
        if (!img) {
          return { ok: false, error: 'img_not_found_by_url', searched: imgs.length };
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
          return { ok: false, needFallback: true, src: img.src, width: w, height: h, canvasError: e.message || String(e) };
        }
      }, url);

      if (canvasResult.ok) {
        console.log(`[extractImageBase64] ✅ Canvas 提取成功 (${canvasResult.width}x${canvasResult.height})`);
        return canvasResult;
      }

      if (!canvasResult.needFallback) {
        console.warn(`[extractImageBase64] ❌ 页面中未找到匹配的 img 元素 (已扫描 ${canvasResult.searched || 0} 张)`);
        return canvasResult;
      }

      console.log(`[extractImageBase64] ⚠ Canvas 被污染 (${canvasResult.canvasError})，尝试页面 fetch...`);

      // ── 阶段 2: 页面 fetch（可能被 CORS 拦截） ──
      const fetchResult = await page.evaluate(async (src) => {
        try {
          const r = await fetch(src);
          if (!r.ok) return { ok: false, error: `fetch_status_${r.status}` };
          const blob = await r.blob();
          const mime = blob.type || 'image/png';
          return await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve({ ok: true, dataUrl: reader.result, mime });
            reader.onerror = () => resolve({ ok: false, error: 'filereader_error' });
            reader.readAsDataURL(blob);
          });
        } catch (err) {
          return { ok: false, error: 'fetch_failed', detail: err.message || String(err) };
        }
      }, canvasResult.src);

      if (fetchResult.ok) {
        console.log(`[extractImageBase64] ✅ 页面 fetch 提取成功 (${canvasResult.width}x${canvasResult.height})`);
        return { ...fetchResult, width: canvasResult.width, height: canvasResult.height, method: 'fetch' };
      }

      console.log(`[extractImageBase64] ⚠ 页面 fetch 失败 (${fetchResult.error}${fetchResult.detail ? ' — ' + fetchResult.detail : ''})，尝试 CDP 缓存读取...`);

      // ── 阶段 3: CDP Network.getResponseBody（从浏览器内存缓存读取，零网络开销） ──
      const requestId = getImageRequestId(canvasResult.src);
      if (requestId) {
        try {
          const client = page._client();
          const { body, base64Encoded } = await client.send('Network.getResponseBody', { requestId });
          const base64Data = base64Encoded ? body : Buffer.from(body, 'utf8').toString('base64');
          const mime = 'image/png'; // 缓存中无法直接拿 MIME，用 png 兜底
          const dataUrl = `data:${mime};base64,${base64Data}`;

          console.log(`[extractImageBase64] ✅ CDP 缓存命中 (${canvasResult.width}x${canvasResult.height}, size=${(base64Data.length * 0.75 / 1024).toFixed(1)}KB)`);
          return { ok: true, dataUrl, width: canvasResult.width, height: canvasResult.height, method: 'cdp-cache' };
        } catch (e) {
          console.log(`[extractImageBase64] ⚠ CDP 缓存读取失败 (${e.message})，降级为 CDP 网络请求...`);
        }
      } else {
        console.log('[extractImageBase64] ⚠ 缓存中无该 URL 的 requestId，降级为 CDP 网络请求...');
      }

      // ── 阶段 4: CDP Network.loadNetworkResource（终极兜底，重新发请求，绕过 CORS） ──
      try {
        const client = page._client();
        const frameId = page.mainFrame()._id;

        console.log(`[extractImageBase64] 📡 CDP 请求中... frameId=${frameId}`);
        const { resource } = await client.send('Network.loadNetworkResource', {
          frameId,
          url: canvasResult.src,
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

        const chunks = [];
        let eof = false;
        while (!eof) {
          const { data, base64Encoded, eof: done } = await client.send('IO.read', {
            handle: streamHandle,
            size: 1024 * 1024, // 每次读 1MB
          });
          if (data) {
            chunks.push(base64Encoded ? data : Buffer.from(data).toString('base64'));
          }
          eof = done;
        }
        await client.send('IO.close', { handle: streamHandle });

        const base64Full = chunks.join('');
        // 从 response headers 推断 MIME；CDP 有时不提供，默认用 image/png
        const mime = (resource.headers?.['content-type'] || resource.headers?.['Content-Type'] || 'image/png').split(';')[0].trim();
        const dataUrl = `data:${mime};base64,${base64Full}`;

        console.log(`[extractImageBase64] ✅ CDP 提取成功 (${canvasResult.width}x${canvasResult.height}, mime=${mime}, size=${(base64Full.length * 0.75 / 1024).toFixed(1)}KB)`);
        return { ok: true, dataUrl, width: canvasResult.width, height: canvasResult.height, method: 'cdp' };
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

    // ─── 高层组合操作 ───

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
        // 1. 点击加号面板按钮，展开上传菜单
        const panelClick = await this.click('uploadPanelBtn');
        if (!panelClick.ok) {
          return { ok: false, error: 'upload_panel_click_failed', detail: panelClick.error };
        }

        // 2. 等待菜单动画稳定
        await sleep(250);

        // 3. Promise.all 是精髓：一边开始监听文件选择器弹窗，一边点击"上传文件"按钮
        const [fileChooser] = await Promise.all([
          page.waitForFileChooser({ timeout: 3_000 }),
          this.click('uploadFileBtn'),
        ]);

        // 4. 弹窗被拦截，塞入文件
        await fileChooser.accept([filePath]);
        console.log(`[ops] 文件已塞入，等待 Gemini 加载图片...`);

        // 5. 等待图片加载完成（.image-preview.loading 消失）
        const loadTimeout = 10_000;
        const loadInterval = 250;
        const loadStart = Date.now();
        await sleep(500); //  短暂等待 UI 响应
        while (Date.now() - loadStart < loadTimeout) {
          const loading = await op.query(() => {
            const el = document.querySelector('.image-preview.loading');
            return !!el;
          });
          if (!loading) {
            console.log(`[ops] 图片加载完成 (${Date.now() - loadStart}ms): ${filePath}`);
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
          return { ok: true, elapsed: Date.now() - start, finalStatus: poll };
        }
        if (poll.status === 'unknown') {
          console.warn('[ops] unknown status, may need screenshot to debug');
        }
      }

      return { ok: false, error: 'timeout', elapsed: Date.now() - start, finalStatus: lastStatus };
    },

    /**
     * 完整生图流程：新建会话 → 发送提示词 → 等待 → 提取图片
     * @param {string} prompt
     * @param {object} [opts]
     * @param {number} [opts.timeout=120000]
     * @param {boolean} [opts.newChat=true]
     * @param {boolean} [opts.highRes=false]
     * @param {(status: object) => void} [opts.onPoll]
     */
    async generateImage(prompt, opts = {}) {
      const { timeout = 120_000, newChat = true, highRes = false, onPoll } = opts;

      // 1. 可选：新建会话
      if (newChat) {
        const newChatResult = await this.click('newChatBtn');
        if (!newChatResult.ok) {
          console.warn('[ops] newChatBtn click failed, continuing anyway');
        }
        await sleep(1500);
      }

      // 2. 发送并等待
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
      if (highRes) {
        const dlResult = await this.downloadLatestImage();
        return { ok: dlResult.ok, method: 'download', elapsed: waitResult.elapsed, ...dlResult };
      } else {
        const b64Result = await this.extractImageBase64(imgInfo.src);
        return { ok: b64Result.ok, method: b64Result.method, elapsed: waitResult.elapsed, ...b64Result };
      }
    },

    /** 底层 page 引用 */
    get page() {
      return page;
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

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
