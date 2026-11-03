(() => {
  'use strict';

  function defaultEsc(value) {
    return String(value ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function modelVendorRank(model = '') {
    const s = String(model).toLowerCase();
    if (/^(gpt|o\d|dall|sora)|openai/.test(s)) return 10;
    if (/qwen|tongyi/.test(s)) return 20;
    if (/kling/.test(s)) return 30;
    if (/grok|xai/.test(s)) return 40;
    if (/flux|black-forest|bfl/.test(s)) return 50;
    if (/veo|gemini|google/.test(s)) return 60;
    if (/claude|anthropic/.test(s)) return 70;
    if (/deepseek/.test(s)) return 80;
    if (/kimi|moonshot/.test(s)) return 90;
    if (/wan|hailuo|runway|luma|pika|omni/.test(s)) return 100;
    return 999;
  }

  function modelVersionScore(model = '') {
    const s = String(model).toLowerCase();
    const date = s.match(/(20\d{2})[-_]?(\d{2})[-_]?(\d{2})/);
    if (date) return Number(`${date[1]}${date[2]}${date[3]}`);
    const nums = [...s.matchAll(/\d+(?:[._-]\d+)*/g)]
      .map(match => match[0].split(/[._-]/).map(part => part.padStart(3, '0')).join(''))
      .map(Number)
      .filter(Number.isFinite);
    return nums.length ? Math.max(...nums) : 0;
  }

  function sortedModels(models = []) {
    return unique(models).sort((a, b) => {
      const vendor = modelVendorRank(a) - modelVendorRank(b);
      if (vendor) return vendor;
      const version = modelVersionScore(b) - modelVersionScore(a);
      if (version) return version;
      return String(a).localeCompare(String(b), 'en', {numeric: true, sensitivity: 'base'});
    });
  }

  function modelBuckets({imageModel = '', videoModel = '', chatModel = '', importedModels = []} = {}) {
    const imported = importedModels.filter(Boolean);
    const imagePattern = /image|img|dall|gpt-image|flux|sdxl|stable|kolors|seedream|wanx|black-forest|midjourney|mj-|ideogram|recraft|文生图|生图|edit/i;
    const videoPattern = /video|sora|kling|wan\d|wan-|wan_|hailuo|runway|veo|luma|pika|seedance|t2v|i2v|vidu|pixverse|可灵|即梦|omni/i;
    const chatPattern = /gpt|chat|claude|gemini|qwen|deepseek|kimi|doubao|glm|llama|mistral|yi-|ernie|baichuan|moonshot|instruct|turbo|plus|pro/i;
    return {
      image: sortedModels(unique([imageModel, ...imported.filter(m => imagePattern.test(m))])),
      video: sortedModels(unique([videoModel, 'omni-flash', 'sora-2', 'veo3.1-components', 'veo_3_1-fast', ...imported.filter(m => videoPattern.test(m))])),
      chat: sortedModels(unique([chatModel, ...imported.filter(m => chatPattern.test(m))]))
    };
  }

  function selectOptionsHtml({models = [], esc = defaultEsc} = {}) {
    return models.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  }

  function modelGroupHtml({title = '', models = [], kind = 'chat', active = '', esc = defaultEsc} = {}) {
    const uniqueModels = unique(models).slice(0, 10);
    const attr = kind === 'image' ? 'data-use-image-model' : kind === 'video' ? 'data-use-video-model' : 'data-use-chat-model';
    return `<section class="model-group">
      <header>${esc(title)}<span>${uniqueModels.length}</span></header>
      ${uniqueModels.map(m => `<button class="model-row ${m === active ? 'active' : ''}" ${attr}="${esc(m)}"><span>${esc(m)}</span><i class="fa-solid fa-check"></i></button>`).join('')}
    </section>`;
  }

  function modelStoreHtml({buckets = {}, active = {}, esc = defaultEsc} = {}) {
    return modelGroupHtml({title: '图像模型', models: buckets.image || [], kind: 'image', active: active.image || '', esc})
      + modelGroupHtml({title: '视频模型', models: buckets.video || [], kind: 'video', active: active.video || '', esc})
      + modelGroupHtml({title: '聊天模型', models: buckets.chat || [], kind: 'chat', active: active.chat || '', esc});
  }

  function cleanModelStoreHtml({buckets = {}, active = {}, esc = defaultEsc} = {}) {
    return modelGroupHtml({title: '图片模型', models: buckets.image || [], kind: 'image', active: active.image || '', esc})
      + modelGroupHtml({title: '视频模型', models: buckets.video || [], kind: 'video', active: active.video || '', esc})
      + modelGroupHtml({title: '聊天模型', models: buckets.chat || [], kind: 'chat', active: active.chat || '', esc});
  }

  window.FutureAIModelRendering = {
    modelBuckets,
    sortedModels,
    modelVendorRank,
    modelVersionScore,
    selectOptionsHtml,
    modelGroupHtml,
    modelStoreHtml: cleanModelStoreHtml
  };
})();
