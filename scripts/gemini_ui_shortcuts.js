(function initGeminiOps(){
  const S = {
    promptInput: [
      'div.ql-editor[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"][aria-label*="Gemini"]',
      '[contenteditable="true"][data-placeholder*="Gemini"]',
      'div[contenteditable="true"][role="textbox"]'
    ],
    actionBtn: [
      '.send-button-container button.send-button',
      '.send-button-container button'
    ],
    newChatBtn: [
      '[data-test-id="new-chat-button"] a',
      '[data-test-id="new-chat-button"]',
      'a[aria-label="发起新对话"]',
      'a[aria-label*="new chat" i]'
    ],
    modelBtn: [
      'button:has-text("Gemini")',
      '[role="button"][aria-haspopup="menu"]'
    ]
  };

  function visible(el){
    if(!el) return false;
    const r=el.getBoundingClientRect();
    const st=getComputedStyle(el);
    return r.width>0 && r.height>0 && st.display!=='none' && st.visibility!=='hidden';
  }

  function q(sel){
    try{
      if(sel.includes(':has-text(')){
        const m=sel.match(/^(.*):has-text\("(.*)"\)$/);
        if(!m) return null;
        const nodes=[...document.querySelectorAll(m[1]||'*')];
        return nodes.find(n=>visible(n)&&n.textContent?.includes(m[2]))||null;
      }
      return [...document.querySelectorAll(sel)].find(visible)||null;
    }catch{return null;}
  }

  function find(key){
    for(const s of (S[key]||[])){
      const el=q(s);
      if(el) return el;
    }
    return null;
  }

  function click(key){
    const el=find(key);
    if(!el) return {ok:false,key,error:'not_found'};
    el.click();
    return {ok:true,key};
  }

  function fillPrompt(text){
    const el=find('promptInput');
    if(!el) return {ok:false,error:'prompt_not_found'};
    el.focus();
    if(el.tagName==='TEXTAREA'){
      el.value=text;
      el.dispatchEvent(new Event('input',{bubbles:true}));
    }else{
      document.execCommand('selectAll',false,null);
      document.execCommand('insertText',false,text);
      el.dispatchEvent(new Event('input',{bubbles:true}));
    }
    return {ok:true};
  }

  function getStatus(){
    const btn=find('actionBtn');
    if(!btn) return {status:'unknown',error:'btn_not_found'};
    const label=(btn.getAttribute('aria-label')||'').trim();
    const disabled=btn.getAttribute('aria-disabled')==='true';
    if(/停止|Stop/i.test(label)) return {status:'loading',label};
    if(/发送|Send|Submit/i.test(label)) return {status:'ready',label,disabled};
    return {status:'idle',label,disabled};
  }

  /* ── 保活式轮询 ──
   * 不在页面内做长 Promise 等待（会导致 CDP 连接因长时间无消息被网关判定空闲断开）。
   * 改为：调用端每 8-10s evaluate 一次 GeminiOps.pollStatus()，立即拿到结果。
   * 调用端自行累计耗时并判断超时。
   */
  function pollStatus(){
    var s=getStatus();
    // 顺便返回页面可见性，帮助调用端判断 tab 是否还活着
    return {status:s.status, label:s.label, pageVisible:!document.hidden, ts:Date.now()};
  }

  function probe(){
    var s=getStatus();
    return {
      promptInput: !!find('promptInput'),
      actionBtn: !!find('actionBtn'),
      newChatBtn: !!find('newChatBtn'),
      modelBtn: !!find('modelBtn'),
      status: s.status
    };
  }

  window.GeminiOps = {probe, click, fillPrompt, getStatus, pollStatus, selectors:S, version:'0.4.0'};
})();
