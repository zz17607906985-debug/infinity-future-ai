(() => {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function safeMediaUrl(value) {
    return window.FutureAIMediaUtils?.safeMediaUrl?.(value) || '';
  }

  function scopedHistoryItems(history, currentProjectId) {
    return (Array.isArray(history) ? history : [])
      .slice()
      .sort((a, b) => Number(b?.time || 0) - Number(a?.time || 0));
  }

  function historyRestoreUrls(item) {
    const list = [];
    const add = value => {
      const url = safeMediaUrl(value);
      if (url && !list.includes(url)) list.push(url);
    };
    add(item?.url);
    if (Array.isArray(item?.urls)) item.urls.forEach(add);
    return list;
  }

  function historyCardViewModel(item) {
    const urls = historyRestoreUrls(item);
    return {
      id: String(item?.id || ''),
      type: String(item?.type || 'image'),
      model: String(item?.model || item?.type || 'image'),
      prompt: String(item?.prompt || ''),
      url: safeMediaUrl(urls[0] || ''),
      restoreUrls: urls
    };
  }

  function emptyHistoryHtml() {
    return '<div class="history-empty"><strong>还没有历史素材</strong><span>图片或视频生成完成后会自动出现在这里。</span><button type="button" class="ghost-btn" data-history-empty-action="image"><i class="fa-regular fa-image" aria-hidden="true"></i>先创建图片节点</button></div>';
  }

  function historyCardsHtml(history) {
    const items = (Array.isArray(history) ? history : []).map(historyCardViewModel);
    if (!items.length) return emptyHistoryHtml();
    return items.map(item => `
      <div class="history-card">
        ${item.url ? (item.type === 'video' ? `<video src="${escapeHtml(item.url)}" controls></video>` : `<button class="history-preview-button" data-history-preview type="button" aria-label="查看完整图片"><img src="${escapeHtml(item.url)}" alt=""></button>`) : ''}
        <strong>${escapeHtml(item.model)}</strong>
        <p>${escapeHtml(item.prompt)}</p>
        <button data-restore="${escapeHtml(item.id)}" class="ghost-btn" style="width:100%;margin-top:8px">恢复到画布</button>
      </div>`).join('');
  }

  window.FutureAICanvasHistory = {
    scopedHistoryItems,
    historyRestoreUrls,
    historyCardViewModel,
    historyCardsHtml,
    emptyHistoryHtml
  };
})();
