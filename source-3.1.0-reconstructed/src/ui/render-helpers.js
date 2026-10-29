(() => {
  'use strict';

  function defaultEsc(value) {
    return String(value ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
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

  // One labeled toolbar above the selected node; each node type lists only the actions it already supports.
  // A tool is [attribute, icon, label, title]; `quick:<action>` routes through the node context actions.
  const FLOAT_TOOLS = {
    image: [
      ['quick:camera', 'fa-solid fa-cube', '多角度', '3D 机位：换角度生成（已有图时放到右侧新节点，原图保留）'],
      ['quick:region-edit', 'fa-solid fa-wand-magic-sparkles', '局部', '局部编辑（重绘 / 扩图 / 抠图 / 放大）'],
      ['quick:batch-variants', 'fa-solid fa-layer-group', '批量', '批量与变体：一次出多张 / 风格 / 比例'],
      ['quick:prompt-assist', 'fa-solid fa-lightbulb', '辅助', '提示词辅助：结构补全 / 片段 / AI 优化'],
      ['quick:pick-continue', 'fa-solid fa-check-double', '选用', '选用这张继续（其他结果仍保留）'],
      ['quick:fabric-edit', 'fa-solid fa-pen-ruler', '编辑', '编辑图片（画笔 / 涂抹 / 文字），保存为右侧新节点，原图保留'],
      ['quick:crop-image', 'fa-solid fa-crop-simple', '裁剪', '按比例快速裁剪，保存为右侧新节点，原图保留'],
      ['quick:edit', 'fa-regular fa-comments', '对话', '对话改图'],
      ['quick:describe', 'fa-regular fa-eye', '描述', '生成图片描述提示节点'],
      ['quick:grid', 'fa-solid fa-table-cells', '分镜', '创建分镜格子节点'],
      ['quick:image-to-video', 'fa-solid fa-film', '转视频', '用这张图创建图生视频节点']
    ],
    video: [['quick:cover', 'fa-regular fa-image', '尾帧', '截取尾帧作为参考图']],
    comfyui: [
      ['data-comfy-test', 'fa-solid fa-vial', '测试连接', '测试 ComfyUI 连接'],
      ['data-comfy-import', 'fa-solid fa-file-import', '导入', '导入 workflow JSON'],
      ['data-comfy-save-global', 'fa-solid fa-floppy-disk', '存为全局', '保存为全局默认 workflow'],
      ['data-comfy-export', 'fa-solid fa-file-export', '导出', '导出 workflow JSON'],
      ['data-comfy-refresh', 'fa-solid fa-rotate', '刷新结构', '重新解析 workflow 结构']
    ],
    upload: [['data-upload-btn', 'fa-solid fa-folder-open', '选文件', '选择图片或视频（已有素材时放到右侧新节点，原素材保留）']],
    'media-tool': [],
    prompt: [
      ['data-run="prompt"', 'fa-solid fa-list-check', '整理', '整理提示词'],
      ['quick:prompt-assist', 'fa-solid fa-lightbulb', '辅助', '提示词辅助：结构补全 / 片段 / AI 优化'],
      ['data-optimize-prompt', 'fa-solid fa-wand-magic-sparkles', '优化', '优化提示词'],
      ['data-clear', 'fa-solid fa-eraser', '清空', '清空提示词']
    ]
  };
  FLOAT_TOOLS.character = FLOAT_TOOLS.prompt;
  const FLOAT_ICONS = {
    copy: ['quick:copy', 'fa-regular fa-copy', '复制节点'],
    download: ['quick:download', 'fa-solid fa-download', '下载'],
    'download-media': ['data-download-media', 'fa-solid fa-download', '下载'],
    favorite: ['quick:favorite', 'fa-regular fa-heart', '加入资产库'],
    fullscreen: ['quick:fullscreen', 'fa-solid fa-expand', '放大观看']
  };
  const FLOAT_ICON_SETS = {
    image: ['copy', 'download', 'favorite', 'fullscreen'],
    video: ['copy', 'download', 'favorite', 'fullscreen'],
    comfyui: ['copy', 'download', 'favorite', 'fullscreen'],
    upload: ['copy', 'download-media', 'favorite', 'fullscreen'],
    'media-tool': ['copy', 'download-media', 'fullscreen'],
    prompt: ['copy'],
    character: ['copy']
  };
  function floatToolAttr(attr) {
    return attr.startsWith('quick:') ? `data-quick="${attr.slice(6)}"` : attr;
  }
  function nodeFloatToolbar(kind) {
    const tools = (FLOAT_TOOLS[kind] || []).map(([attr, icon, label, title]) =>
      `<button type="button" class="float-tool" ${floatToolAttr(attr)} title="${title}"><i class="${icon}"></i><span>${label}</span></button>`);
    const icons = (FLOAT_ICON_SETS[kind] || ['copy']).map(name => {
      const [attr, icon, title] = FLOAT_ICONS[name];
      return `<button type="button" class="float-tool float-tool-icon" ${floatToolAttr(attr)} title="${title}" aria-label="${title}"><i class="${icon}"></i></button>`;
    });
    return `<div class="node-float-toolbar" data-float-toolbar="${kind}">${tools.join('')}${tools.length ? '<span class="float-tool-sep"></span>' : ''}${icons.join('')}</div>`;
  }

  // Run buttons in the composer are round icon buttons; busy state swaps the icon for a spinner.
  function setRunButtonBusy(btn, busy, icon = 'fa-arrow-up') {
    if (!btn) return;
    btn.disabled = !!busy;
    btn.innerHTML = `<i class="fa-solid ${busy ? 'fa-spinner fa-spin' : icon}"></i>`;
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
    return `<div class="generation-status ${esc(type)}">${type === 'running' ? `<video class="waiting-animation-video" autoplay muted loop playsinline src="${esc(waitingAnimationSrc)}"></video>` : ''}<i class="fa-solid ${icon}"></i><strong>${esc(title)}</strong><span>${esc(message)}</span>${type === 'error' && node?.data?.statusSafety ? safetyRewriteButtonHtml() : ''}</div>`;
  }

  // Shown only when a generation was rejected by content-safety review.
  function safetyRewriteButtonHtml() {
    return '<button type="button" class="status-safe-btn" data-safe title="把提示词改写为更安全的表达"><i class="fa-solid fa-shield-heart"></i>安全改写</button>';
  }

  function referencePreviewHtml({item, label, index = 0, esc = defaultEsc, isVideo = isVideoMedia, roleOptions = '', timeControl = '', strengthControl = '', sheetButton = '', overLimit = false} = {}) {
    const url = safeMediaUrl(item?.url);
    if (!url) return '';
    const title = label || (index === 0 ? '主体图' : '参考图');
    const key = esc(item.key || String(index));
    const media = isVideo('', url)
      ? `<video src="${url}"></video>`
      : `<img src="${url}" alt="${esc(title)}">`;
    const thumbTitle = overLimit ? `${title}：超出当前模型可接收的数量，请移除` : `${title}：双击查看完整参考，可拖动调整顺序`;
    return `<div class="ref-item${overLimit ? ' over-limit' : ''}" data-ref-item data-ref-key="${key}"><button type="button" class="ref-thumb" data-open-ref data-ref-index="${index}" data-ref-key="${key}" title="${esc(thumbTitle)}">${media}<span>${esc(title)}</span></button><button type="button" class="ref-remove" data-remove-ref data-ref-key="${key}" title="移除这张参考" aria-label="移除${esc(title)}"><i class="fa-solid fa-xmark"></i></button>${sheetButton}${roleOptions ? `<select class="ref-role-select" data-reference-role data-ref-key="${key}" title="设置这份参考素材的用途" aria-label="${esc(title)}用途">${roleOptions}</select>` : ''}${strengthControl}${timeControl}</div>`;
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
    nodeFloatToolbar,
    setRunButtonBusy,
    imageStatusMessage,
    imageStatusHtml,
    safetyRewriteButtonHtml,
    referencePreviewHtml,
    uniqueRefItems
  };
})();




