(() => {
  'use strict';

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function sanitizeFileBase(value, index = 0) {
    const raw = String(value || '').replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    const base = (raw || ('素材' + String(index + 1))).slice(0, 48);
    return String(index + 1).padStart(3, '0') + '-' + base;
  }

  function nodePrompt(node = {}) {
    const data = node.data || {};
    return String(data.prompt || data.text || data.caption || data.title || '').trim();
  }

  function nodeTitle(node = {}, index = 0) {
    const data = node.data || {};
    const title = String(data.name || data.title || data.model || node.type || '').trim();
    return title || ('节点' + String(index + 1));
  }

  function mediaTypeOf(node = {}) {
    const data = node.data || {};
    const url = String(data.url || '');
    if (node.type === 'video' || /video/i.test(data.mime || '') || /\.(mp4|webm|mov)(?:$|[?#])/i.test(url)) return 'video';
    return 'image';
  }

  function collectShareItems(nodeList = [], {scope = 'selection'} = {}) {
    const list = Array.isArray(nodeList) ? nodeList.filter(Boolean) : [];
    const items = [];
    list.forEach((node, index) => {
      const data = node.data || {};
      const url = String(data.url || '').trim();
      if (!url) return;
      if (!['image', 'video', 'upload', 'media-tool'].includes(node.type) && !data.url) return;
      items.push({
        id: node.id || ('n' + index),
        type: node.type || 'image',
        mediaType: mediaTypeOf(node),
        title: nodeTitle(node, index),
        prompt: nodePrompt(node),
        model: String(data.model || ''),
        size: String(data.size || ''),
        sourceUrl: url,
        fileBase: sanitizeFileBase(nodeTitle(node, index), items.length)
      });
    });
    return {
      scope,
      count: items.length,
      items,
      withPrompt: items.filter(item => item.prompt).length
    };
  }

  function buildPromptsMarkdown(items = [], projectName = '') {
    const lines = [
      '# 提示词清单',
      '',
      projectName ? ('项目：' + projectName) : '',
      '共 ' + items.length + ' 个素材',
      ''
    ].filter(Boolean);
    items.forEach((item, index) => {
      lines.push('## ' + (index + 1) + '. ' + item.title);
      lines.push('- 类型：' + (item.mediaType === 'video' ? '视频' : '图片'));
      if (item.model) lines.push('- 模型：' + item.model);
      if (item.size) lines.push('- 尺寸：' + item.size);
      lines.push('- 文件：media/' + item.fileBase + (item.ext || ''));
      lines.push('');
      lines.push(item.prompt || '（无提示词）');
      lines.push('');
    });
    return lines.join('\n');
  }

  function buildShareReadme({projectName = '', items = [], exportedAt = '', scopeLabel = '选中节点'} = {}) {
    return [
      '# ∞未来 AI 分享包',
      '',
      '这是用 ∞未来 AI 导出的分享包，可直接发给同事或客户。',
      '',
      '- 导出时间：' + (exportedAt || ''),
      '- 项目：' + (projectName || '未命名项目'),
      '- 范围：' + scopeLabel,
      '- 素材数：' + items.length,
      '',
      '## 文件夹说明',
      '- `media/`：图片和视频文件',
      '- `prompts.md`：每张图对应的提示词',
      '- `manifest.json`：机器可读清单',
      '',
      '## 使用建议',
      '- 直接打开 `media` 查看成品。',
      '- 需要复用提示词时，看 `prompts.md`。',
      '- 本包不含 API 密钥，也不含完整项目备份。',
      '',
      '## 素材列表',
      ...items.map((item, index) => (index + 1) + '. ' + item.title + '（' + (item.mediaType === 'video' ? '视频' : '图片') + '）'),
      ''
    ].join('\n');
  }

  function summarizeForUi(collection = {}) {
    const items = collection.items || [];
    return {
      count: items.length,
      withPrompt: items.filter(item => item.prompt).length,
      images: items.filter(item => item.mediaType === 'image').length,
      videos: items.filter(item => item.mediaType === 'video').length
    };
  }

  const api = {
    sanitizeFileBase,
    nodePrompt,
    nodeTitle,
    mediaTypeOf,
    collectShareItems,
    buildPromptsMarkdown,
    buildShareReadme,
    summarizeForUi,
    clone
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FutureAISharePackage = api;
})();
