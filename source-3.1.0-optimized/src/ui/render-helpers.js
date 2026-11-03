(() => {
  'use strict';

  function defaultEsc(value) {
    return String(value ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function unique(values) {
    return [...new Set(values)];
  }

  function isVideoMedia(mime = '', url = '') {
    return /^video\//i.test(mime || '') || /^data:video\//i.test(url || '') || /\.(mp4|webm|mov|m4v|avi)$/i.test(url || '');
  }

  function safeMediaUrl(value) {
    return window.FutureAIMediaUtils?.safeMediaUrl?.(value) || '';
  }

  function renderNodeMetadata(node, {normalizeTags = value => Array.isArray(value) ? value : [], esc = defaultEsc} = {}) {
    const tags = normalizeTags(node?.data?.tags);
    const favorite = node?.data?.favorite ? '<span class="node-favorite-dot" title="已收藏"><i class="fa-solid fa-heart"></i></span>' : '';
    return `<div class="node-tags" data-node-metadata>${favorite}${tags.map(tag => `<span class="node-tag" title="${esc(tag)}">${esc(tag)}</span>`).join('')}</div>`;
  }

  function nodeQuickToolbar(kind) {
    const common = `
      <button data-quick="copy" title="复制节点"><i class="fa-regular fa-copy"></i></button>
      <button data-quick="download" title="下载"><i class="fa-solid fa-download"></i></button>
      <button data-quick="favorite" title="收藏"><i class="fa-regular fa-heart"></i></button>
      <button data-quick="fullscreen" title="放大观看"><i class="fa-solid fa-expand"></i></button>`;
    const image = `
      <button data-quick="undo" title="撤销"><i class="fa-solid fa-rotate-left"></i></button>
      <button data-quick="edit" title="编辑"><i class="fa-regular fa-pen-to-square"></i></button>
      <button data-quick="describe" title="图片描述"><i class="fa-regular fa-eye"></i></button>
      <button data-quick="grid" title="分镜"><i class="fa-solid fa-table-cells"></i></button>
      <button data-quick="camera" title="镜头"><i class="fa-solid fa-camera"></i></button>`;
    const video = `
      <button data-quick="cover" title="截取尾帧"><i class="fa-regular fa-image"></i></button>`;
    return `<div class="node-quick-toolbar">${kind === 'image' ? image : video}${common}</div>`;
  }

  function getModelOptions({kind, current = '', defaultValue = '', importedModels = []} = {}) {
    const fallback = kind === 'video'
      ? ['omni-flash', 'sora-2', 'veo3.1-components', 'veo_3_1-fast']
      : ['gpt-image2', 'gpt-image-2', 'gpt-image-1'];
    const pattern = kind === 'video'
      ? /video|sora|kling|wan|hailuo|runway|veo|luma|pika|omni/i
      : /image|img|dall|flux|gpt-image|edit/i;
    return unique([current, defaultValue, ...fallback, ...importedModels.filter(m => pattern.test(m)), ...importedModels].filter(Boolean));
  }

  function modelOptionsHtml({kind, current = '', defaultValue = '', importedModels = [], esc = defaultEsc} = {}) {
    return getModelOptions({kind, current, defaultValue, importedModels}).map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  }

  function imageStatusMessage(status, title = '') {
    const lines = String(status || '').split('\n').map(line => line.trim()).filter(Boolean);
    if (!lines.length) return '';
    const normalizedTitle = String(title || '').replace(/[：:]+$/, '');
    const first = lines[0].replace(/[：:]+$/, '');
    if (normalizedTitle && first === normalizedTitle && lines[1]) return lines.slice(1).join('\n');
    if (/^(生成失败|图生图失败|多参考图生图失败|API 内容审核拒绝)$/.test(first) && lines[1]) return lines.slice(1).join('\n');
    return lines.join('\n').replace(/^生成失败[：:]?/, '').trim();
  }

  function imageStatusHtml({node, waitingAnimationSrc = '', esc = defaultEsc} = {}) {
    const type = node?.data?.statusType || '';
    const title = node?.data?.statusTitle || (type === 'running' ? '生成中' : type === 'error' ? '生成失败' : '');
    const message = imageStatusMessage(node?.data?.status, title) || (type === 'running' ? '正在请求接口，请稍候' : '请检查接口返回信息');
    const icon = type === 'running' ? 'fa-spinner fa-spin' : 'fa-triangle-exclamation';
    return `<div class="generation-status ${esc(type)}">${type === 'running' ? `<video class="waiting-animation-video" autoplay muted loop playsinline src="${esc(waitingAnimationSrc)}"></video>` : ''}<i class="fa-solid ${icon}"></i><strong>${esc(title)}</strong><span>${esc(message)}</span></div>`;
  }

  function referencePreviewHtml({item, label, index = 0, esc = defaultEsc, isVideo = isVideoMedia, roleOptions = '', timeControl = ''} = {}) {
    const url = safeMediaUrl(item?.url);
    if (!url) return '';
    const title = label || (index === 0 ? '主体图' : '参考图');
    const key = esc(item.key || String(index));
    const media = isVideo('', url)
      ? `<video src="${url}"></video>`
      : `<img src="${url}" alt="${esc(title)}">`;
    return `<div class="ref-item" data-ref-item data-ref-key="${key}"><button type="button" class="ref-thumb" data-open-ref data-ref-index="${index}" data-ref-key="${key}" title="${esc(title)}：双击查看完整参考，可拖动调整顺序">${media}<span>${esc(title)}</span></button>${roleOptions ? `<select class="ref-role-select" data-reference-role data-ref-key="${key}" title="设置这份参考素材的用途" aria-label="${esc(title)}用途">${roleOptions}</select>` : ''}${timeControl}</div>`;
  }

  function uniqueRefItems(items) {
    const seen = new Set();
    return items.filter(item => {
      const marker = item.key + '|' + item.url;
      if (!item.url || seen.has(marker)) return false;
      seen.add(marker);
      return true;
    });
  }

  window.FutureAIUIRenderHelpers = {
    renderNodeMetadata,
    nodeQuickToolbar,
    getModelOptions,
    modelOptionsHtml,
    imageStatusMessage,
    imageStatusHtml,
    referencePreviewHtml,
    uniqueRefItems
  };
})();




