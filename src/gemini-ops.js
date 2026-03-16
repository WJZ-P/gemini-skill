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
  actionBtn: [
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
    'button:has-text("Gemini")',
    '[role="button"][aria-haspopup="menu"]',
  ],
  tempChatBtn: [
    '[data-test-id="temp-chat-button"]',          // 最稳定：测试专属属性
    'button[aria-label="临时对话"]',                // 中文 aria-label
    'button[aria-label*="temporary" i]',           // 英文 aria-label 兜底
    'button.temp-chat-button',                     // class 名兜底
    'button[mattooltip="临时对话"]',                // Angular Material tooltip 属性
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
     * @returns {Promise<{promptInput: boolean, actionBtn: boolean, newChatBtn: boolean, modelBtn: boolean, tempChatBtn: boolean, status: object}>}
     */
    async probe() {
      const [promptInput, actionBtn, newChatBtn, modelBtn, tempChatBtn] = await Promise.all([
        op.locate(SELECTORS.promptInput),
        op.locate(SELECTORS.actionBtn),
        op.locate(SELECTORS.newChatBtn),
        op.locate(SELECTORS.modelBtn),
        op.locate(SELECTORS.tempChatBtn),
      ]);
      const status = await this.getStatus();
      return {
        promptInput: promptInput.found,
        actionBtn: actionBtn.found,
        newChatBtn: newChatBtn.found,
        modelBtn: modelBtn.found,
        tempChatBtn: tempChatBtn.found,
        status,
      };
    },

    /**
     * 点击指定按钮
     * @param {'actionBtn'|'newChatBtn'|'modelBtn'|'tempChatBtn'} key
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

      // 等待页面导航 / 内容刷新完成
      try {
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout });
      } catch {
        // 部分场景下按钮不触发 navigation 而是 SPA 内部路由，静默跳过
        console.log('[ops] temp chat: navigation wait timed out, continuing (may be SPA routing)');
      }

      // 再给一点时间让 UI 稳定
      await sleep(1000);

      console.log('[ops] entered temp chat mode');
      return { ok: true };
    },

    /**
     * 填写提示词（快速填充，非逐字输入）
     * @param {string} text
     */
    async fillPrompt(text) {
      return op.fill(SELECTORS.promptInput, text);
    },

    /**
     * 获取当前按钮状态（通过一次性 evaluate 读取，不注入任何东西）
     */
    async getStatus() {
      return op.query((sels) => {
        // 在页面上下文中查找 actionBtn
        let btn = null;
        for (const sel of sels) {
          try {
            const all = [...document.querySelectorAll(sel)];
            btn = all.find(n => {
              const r = n.getBoundingClientRect();
              const st = getComputedStyle(n);
              return r.width > 0 && r.height > 0
                && st.display !== 'none' && st.visibility !== 'hidden';
            }) || null;
          } catch { /* skip */ }
          if (btn) break;
        }

        if (!btn) return { status: 'unknown', error: 'btn_not_found' };

        const label = (btn.getAttribute('aria-label') || '').trim();
        const disabled = btn.getAttribute('aria-disabled') === 'true';

        if (/停止|Stop/i.test(label)) {
          return { status: 'loading', label };
        }
        if (/发送|Send|Submit/i.test(label)) {
          return { status: 'ready', label, disabled };
        }
        return { status: 'idle', label, disabled };
      }, SELECTORS.actionBtn);
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
     * 获取最新生成的图片信息
     */
    async getLatestImage() {
      return op.query(() => {
        const imgs = [...document.querySelectorAll('img.image.loaded')];
        if (!imgs.length) {
          return { ok: false, error: 'no_loaded_images' };
        }
        const img = imgs[imgs.length - 1];
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
          hasDownloadBtn: !!dlBtn,
        };
      });
    },

    /**
     * 提取最新图片的 Base64 数据（Canvas 优先，fetch 兜底）
     */
    async extractImageBase64() {
      return op.query(() => {
        const imgs = [...document.querySelectorAll('img.image.loaded')];
        if (!imgs.length) {
          return { ok: false, error: 'no_loaded_images' };
        }
        const img = imgs[imgs.length - 1];
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;

        // 尝试 Canvas 同步提取
        try {
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0);
          const dataUrl = canvas.toDataURL('image/png');
          return { ok: true, dataUrl, width: w, height: h, method: 'canvas' };
        } catch { /* canvas tainted, fallback */ }

        // 标记需要 fetch fallback
        return { ok: false, needFetch: true, src: img.src, width: w, height: h };
      }).then(async (result) => {
        if (result.ok || !result.needFetch) return result;

        // Fetch fallback: 在页面上下文中异步执行
        return page.evaluate(async (src, w, h) => {
          try {
            const r = await fetch(src);
            if (!r.ok) throw new Error(`fetch_status_${r.status}`);
            const blob = await r.blob();
            return await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve({
                ok: true, dataUrl: reader.result, width: w, height: h, method: 'fetch',
              });
              reader.readAsDataURL(blob);
            });
          } catch (err) {
            return { ok: false, error: 'extract_failed', detail: err.message || String(err) };
          }
        }, result.src, result.width, result.height);
      });
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
     * 发送提示词并等待生成完成
     * @param {string} prompt
     * @param {object} [opts]
     * @param {number} [opts.timeout=120000]
     * @param {number} [opts.interval=8000]
     * @param {(status: object) => void} [opts.onPoll]
     * @returns {Promise<{ok: boolean, elapsed: number, finalStatus?: object, error?: string}>}
     */
    async sendAndWait(prompt, opts = {}) {
      const { timeout = 120_000, interval = 8_000, onPoll } = opts;

      // 1. 填写
      const fillResult = await this.fillPrompt(prompt);
      if (!fillResult.ok) {
        return { ok: false, error: 'fill_failed', detail: fillResult, elapsed: 0 };
      }

      // 短暂等待 UI 响应
      await sleep(300);

      // 2. 点击发送
      const clickResult = await this.click('actionBtn');
      if (!clickResult.ok) {
        return { ok: false, error: 'send_click_failed', detail: clickResult, elapsed: 0 };
      }

      // 3. 轮询等待
      const start = Date.now();
      let lastStatus = null;

      while (Date.now() - start < timeout) {
        await sleep(interval);

        const poll = await this.pollStatus();
        lastStatus = poll;
        onPoll?.(poll);

        if (poll.status === 'idle') {
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
      const imgInfo = await this.getLatestImage();
      if (!imgInfo.ok) {
        await sleep(3000);
        const retry = await this.getLatestImage();
        if (!retry.ok) {
          return { ok: false, error: 'no_image_found', elapsed: waitResult.elapsed, imgInfo: retry };
        }
      }

      // 5. 提取 / 下载
      if (highRes) {
        const dlResult = await this.downloadLatestImage();
        return { ok: dlResult.ok, method: 'download', elapsed: waitResult.elapsed, ...dlResult };
      } else {
        const b64Result = await this.extractImageBase64();
        return { ok: b64Result.ok, method: b64Result.method, elapsed: waitResult.elapsed, ...b64Result };
      }
    },

    /** 底层 page 引用 */
    get page() {
      return page;
    },
  };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
