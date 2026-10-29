(() => {
  'use strict';
  // Canvas image generation always asks for the provider's highest quality tier.
  const IMAGE_QUALITY = 'high';
  function qualityForModel(model) {
    return /^dall-e-3$/i.test(model) ? 'hd' : IMAGE_QUALITY;
  }
  // Final prompt = the user's own (or linked) prompt plus only the extras the user chose:
  // mark/style/mood tags, the node camera, and reference role instructions (composePrompt).
  function build({ownPrompt = '', linkedPrompt = '', model = '', size = '', data = {}, references = [], composePrompt}) {
    const sourcePrompt = String(ownPrompt).trim() ? String(ownPrompt) : String(linkedPrompt);
    if (!sourcePrompt.trim()) throw new Error('图片节点缺少提示词');
    if (!model) throw new Error('请先选择图片模型');
    if (!size) throw new Error('请先选择有效的输出尺寸');
    return {
      schemaVersion: 2,
      sourcePrompt,
      prompt: composePrompt(sourcePrompt, references),
      model: String(model).trim(),
      size,
      quality: qualityForModel(model),
      resolution: data.resolution || '1K',
      referenceCount: references.length,
      count: Math.max(1, Math.min(4, parseInt(data.count, 10) || 1)),
      allowModelFallback: false,
      allowReferenceFallback: false
    };
  }
  function describe(request) {
    return [
      '模型（锁定）：' + request.model,
      '适配器实际请求模型：' + (request.adapterModel || '尚未取得成功响应') + '；不代表供应商内部模型证明',
      '请求状态：' + ({submitted: '已提交', received: '已收到响应', saved: '已保存', failed: '失败'}[request.status] || '尚未提交'),
      '供应商：' + (request.provider || '当前选择') + '；协议：' + (request.protocol || '按供应商配置'),
      '密钥：' + (request.keyLabel || '服务 Key') + '（不显示密钥内容）',
      '接口尺寸字段：' + JSON.stringify(request.dimensionFields || {size: request.size}),
      'Seed：' + (request.seed ?? '未指定或当前模型不支持；每次生成可能不同'),
      '请求像素：' + request.size + '；不代表原生细节保证',
      '质量参数：' + request.quality + '（固定最高质量；需供应商支持，可能增加费用与耗时）',
      '提示词组成：你的提示词 + 你选择的标记/风格/情绪、机位和参考图用途说明；不附加画布上下文或通用规则',
      '张数：' + request.count + '；参考图：' + request.referenceCount,
      '不自动切换模型、不合成参考板、不扩图、不插值放大。',
      '生成有随机性，高质量参数不保证一定优于其他平台。',
      '', '完整提交提示词：', request.prompt
    ].join('\n');
  }
  function showPreview(request, title = '图片请求预览') {
    const dialog = document.createElement('dialog');
    dialog.className = 'image-request-dialog';
    const heading = document.createElement('h2');
    heading.id = 'image-request-dialog-title';
    heading.textContent = title;
    dialog.setAttribute('aria-labelledby', heading.id);
    const note = document.createElement('p');
    note.textContent = '只读预览，不调用接口、不生成上游素材。参数或参考图变化后，请重新预览。';
    const text = document.createElement('textarea');
    text.readOnly = true;
    text.setAttribute('aria-label', '完整图片请求');
    text.value = describe(request);
    const actions = document.createElement('div');
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = '复制完整请求';
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text.value); copy.textContent = '已复制'; }
      catch { text.focus(); text.select(); copy.textContent = '请按 Ctrl+C 复制'; }
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '关闭';
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => dialog.remove(), {once: true});
    actions.append(copy, close);
    dialog.append(heading, note, text, actions);
    document.body.append(dialog);
    dialog.showModal();
    close.focus();
  }
  window.FutureAIImageRequestPolicy = {qualityForModel, build, describe, showPreview};
})();
