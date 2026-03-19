/**
 * operator.js — 纯 CDP 底层操作封装
 *
 * 职责：
 *   封装最基础的浏览器交互原语（点击、输入、查询、等待等），
 *   全部通过 CDP 协议实现，不往页面注入任何对象。
 *
 * 设计原则：
 *   - 所有 DOM 操作通过 page.evaluate() 一次性执行，执行完即走，不留痕迹
 *   - 鼠标 / 键盘事件通过 CDP Input 域发送，生成 isTrusted=true 的原生事件
 *   - 每个方法都是独立的原子操作，上层 gemini-ops.js 负责编排组合
 */

/**
 * 创建 operator 实例
 * @param {import('puppeteer-core').Page} page
 */
export function createOperator(page) {

  // ─── 内部工具 ───

  /**
   * 通过 CSS 选择器列表查找第一个可见元素，返回其中心坐标和边界信息
   * 在页面上下文中执行，执行完即走
   * @param {string[]} selectors - 候选选择器，按优先级排列
   * @returns {Promise<{found: boolean, x?: number, y?: number, width?: number, height?: number, selector?: string, tagName?: string}>}
   */
  async function locate(selectors) {
    return page.evaluate((sels) => {
      for (const sel of sels) {
        let el = null;
        try {
          // 支持 :has-text("xxx") 伪选择器
          if (sel.includes(':has-text(')) {
            const m = sel.match(/^(.*):has-text\("(.*)"\)$/);
            if (m) {
              const candidates = [...document.querySelectorAll(m[1] || '*')];
              el = candidates.find(n => {
                const r = n.getBoundingClientRect();
                const st = getComputedStyle(n);
                return r.width > 0 && r.height > 0
                  && st.display !== 'none' && st.visibility !== 'hidden'
                  && n.textContent?.includes(m[2]);
              }) || null;
            }
          } else {
            const all = [...document.querySelectorAll(sel)];
            el = all.find(n => {
              const r = n.getBoundingClientRect();
              const st = getComputedStyle(n);
              return r.width > 0 && r.height > 0
                && st.display !== 'none' && st.visibility !== 'hidden';
            }) || null;
          }
        } catch { /* 选择器语法错误，跳过 */ }

        if (el) {
          const rect = el.getBoundingClientRect();
          return {
            found: true,
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
            width: rect.width,
            height: rect.height,
            selector: sel,
            tagName: el.tagName.toLowerCase(),
          };
        }
      }
      return { found: false };
    }, selectors);
  }

  /**
   * 给坐标加一点随机偏移，模拟人类鼠标不精确的特征
   * @param {number} x
   * @param {number} y
   * @param {number} [jitter=3] - 最大偏移像素
   * @returns {{x: number, y: number}}
   */
  function humanize(x, y, jitter = 3) {
    return {
      x: x + (Math.random() * 2 - 1) * jitter,
      y: y + (Math.random() * 2 - 1) * jitter,
    };
  }

  /**
   * 随机延迟（毫秒），模拟人类反应时间
   * @param {number} min
   * @param {number} max
   */
  function randomDelay(min, max) {
    const ms = min + Math.random() * (max - min);
    return new Promise(r => setTimeout(r, ms));
  }

  // ─── 公开 API ───

  return {

    /**
     * 定位元素 — 通过选择器列表查找第一个可见元素
     * @param {string|string[]} selectors - 单个选择器或候选列表
     * @returns {Promise<{found: boolean, x?: number, y?: number, width?: number, height?: number, selector?: string, tagName?: string}>}
     */
    async locate(selectors) {
      const sels = Array.isArray(selectors) ? selectors : [selectors];
      return locate(sels);
    },

    /**
     * 点击元素 — 通过 CDP Input.dispatchMouseEvent 发送真实鼠标事件
     *
     * 生成 isTrusted=true 的原生事件，比 element.click() 更真实
     *
     * @param {string|string[]} selectors - 候选选择器
     * @param {object} [opts]
     * @param {number} [opts.jitter=3] - 坐标随机偏移像素
     * @param {number} [opts.delayBeforeClick=50] - 移动到元素后、点击前的等待（ms）
     * @param {number} [opts.clickDuration=80] - mousedown 到 mouseup 的间隔（ms）
     * @returns {Promise<{ok: boolean, selector?: string, x?: number, y?: number, error?: string}>}
     */
    async click(selectors, opts = {}) {
      const { jitter = 10, delayBeforeClick = 50, clickDuration = 80 } = opts;

      const sels = Array.isArray(selectors) ? selectors : [selectors];
      const loc = await locate(sels);
      if (!loc.found) {
        return { ok: false, error: 'element_not_found', triedSelectors: sels };
      }

      const { x, y } = humanize(loc.x, loc.y, jitter);

      // 先移动鼠标到目标位置
      await page.mouse.move(x, y);
      await randomDelay(delayBeforeClick * 0.5, delayBeforeClick * 1.5);

      // mousedown → 短暂停留 → mouseup（模拟真实点击节奏）
      await page.mouse.down();
      await randomDelay(clickDuration * 0.5, clickDuration * 1.5);
      await page.mouse.up();

      return { ok: true, selector: loc.selector, x, y };
    },

    /**
     * 输入文本 — 支持两种模式
     *
     * - `'paste'`（默认）：通过剪贴板粘贴，整段文本一次性输入，人类也经常这样操作
     * - `'typeChar'`：逐字符键盘输入，每个字符间有随机延迟，模拟打字节奏
     *
     * @param {string} text - 要输入的文本
     * @param {object} [opts]
     * @param {'paste'|'typeChar'} [opts.mode='paste'] - 输入模式
     * @param {number} [opts.minDelay=30] - typeChar 模式下字符间最小间隔（ms）
     * @param {number} [opts.maxDelay=80] - typeChar 模式下字符间最大间隔（ms）
     * @returns {Promise<{ok: boolean, length: number, mode: string}>}
     */
    async type(text, opts = {}) {
      const { mode = 'paste', minDelay = 30, maxDelay = 80 } = opts;

      if (mode === 'typeChar') {
        // 逐字符输入，模拟真实打字
        for (const char of text) {
          await page.keyboard.type(char);
          await randomDelay(minDelay, maxDelay);
        }
      } else {
        // 粘贴模式：通过 CDP Input.insertText 一次性输入整段文本
        // 等价于用户从剪贴板粘贴，但不依赖 clipboard API 权限
        const client = page._client();
        await client.send('Input.insertText', { text });
      }

      return { ok: true, length: text.length, mode };
    },

    /**
     * 快速设置文本 — 对 contenteditable 元素，用 Ctrl+A → 粘贴的方式填充
     *
     * 比逐字输入快得多，适合长文本（如 prompt）
     * 同样不注入任何对象，通过 evaluate 执行一次性 DOM 操作
     *
     * @param {string|string[]} selectors - 目标输入框选择器
     * @param {string} text - 要填入的文本
     * @returns {Promise<{ok: boolean, selector?: string, error?: string}>}
     */
    async fill(selectors, text) {
      const sels = Array.isArray(selectors) ? selectors : [selectors];
      const loc = await locate(sels);
      if (!loc.found) {
        return { ok: false, error: 'element_not_found', triedSelectors: sels };
      }

      // 先点击聚焦目标元素
      const { x, y } = humanize(loc.x, loc.y, 2);
      await page.mouse.click(x, y);
      await randomDelay(100, 200);

      // 在页面上下文中执行文本填充（一次性，不留痕迹）
      const result = await page.evaluate((selsInner, textInner) => {
        // 重新查找元素（因为 click 后 DOM 可能有变化）
        let el = null;
        for (const sel of selsInner) {
          try {
            const all = [...document.querySelectorAll(sel)];
            el = all.find(n => {
              const r = n.getBoundingClientRect();
              return r.width > 0 && r.height > 0;
            }) || null;
          } catch { /* skip */ }
          if (el) break;
        }

        if (!el) return { ok: false, error: 'element_lost_after_click' };

        el.focus();

        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
          // 原生表单元素
          el.value = textInner;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          // contenteditable 元素（如 Gemini 的富文本输入框）
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, textInner);
        }
        return { ok: true };
      }, sels, text);

      return { ...result, selector: loc.selector };
    },

    /**
     * 在页面上下文中执行一次性查询（不注入任何对象）
     *
     * @param {((...args: any[]) => any)} fn - 要在页面中执行的函数
     * @param {...any} args - 传入函数的参数
     * @returns {Promise<any>}
     */
    async query(fn, ...args) {
      return page.evaluate(fn, ...args);
    },

    /**
     * 等待某个条件满足（轮询式）
     *
     * @param {((...args: any[]) => any)} conditionFn - 在页面中执行的判断函数，返回 truthy 值表示满足
     * @param {object} [opts]
     * @param {number} [opts.timeout=30000] - 最大等待时间（ms）
     * @param {number} [opts.interval=500] - 轮询间隔（ms）
     * @param {any[]} [opts.args=[]] - 传入 conditionFn 的参数
     * @returns {Promise<{ok: boolean, result?: any, elapsed: number, error?: string}>}
     */
    async waitFor(conditionFn, opts = {}) {
      const { timeout = 30_000, interval = 500, args = [] } = opts;
      const start = Date.now();

      while (Date.now() - start < timeout) {
        try {
          const result = await page.evaluate(conditionFn, ...args);
          if (result) {
            return { ok: true, result, elapsed: Date.now() - start };
          }
        } catch { /* 页面可能还在加载 */ }
        await new Promise(r => setTimeout(r, interval));
      }

      return { ok: false, error: 'timeout', elapsed: Date.now() - start };
    },

    /**
     * 等待导航完成
     *
     * @param {object} [opts]
     * @param {string} [opts.waitUntil='networkidle2']
     * @param {number} [opts.timeout=30000]
     * @returns {Promise<void>}
     */
    async waitForNavigation(opts = {}) {
      const { waitUntil = 'networkidle2', timeout = 30_000 } = opts;
      await page.waitForNavigation({ waitUntil, timeout });
    },

    /**
     * 按下键盘快捷键
     *
     * @param {string} key - 键名（如 'Enter'、'Tab'、'Escape'）
     * @param {object} [opts]
     * @param {number} [opts.delay=50] - keydown 到 keyup 的间隔
     * @returns {Promise<{ok: boolean, key: string}>}
     */
    async press(key, opts = {}) {
      const { delay = 50 } = opts;
      await page.keyboard.press(key, { delay });
      return { ok: true, key };
    },

    /**
     * 页面截图（用于调试或状态验证）
     *
     * @param {object} [opts]
     * @param {boolean} [opts.fullPage=false]
     * @param {'png'|'jpeg'|'webp'} [opts.type='png']
     * @param {string} [opts.path] - 保存路径（不传则返回 Buffer）
     * @returns {Promise<Buffer>}
     */
    async screenshot(opts = {}) {
      return page.screenshot(opts);
    },

    /**
     * 获取页面当前 URL
     * @returns {string}
     */
    url() {
      return page.url();
    },

    /** 底层 page 对象引用 */
    get page() {
      return page;
    },
  };
}
