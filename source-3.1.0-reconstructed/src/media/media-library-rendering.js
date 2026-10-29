(() => {
  'use strict';

  function defaultEsc(value) {
    return String(value ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function formatBytes(bytes = 0) {
    const size = Number(bytes) || 0;
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / 1024 / 1024).toFixed(2)} MB`;
  }

  function mediaLibraryReportHtml({index = {}, esc = defaultEsc} = {}) {
    const summary = index?.summary || {};
    const duplicate = (index?.duplicateGroups || [])[0];
    const missing = (index?.missingReferences || [])[0];
    return `
      <strong data-media-library-report="mediaLibraryReport">本地素材库</strong>
      <ul>
        <li>媒体文件：${summary.files || 0} 个，${formatBytes(summary.bytes || 0)}</li>
        <li>重复素材：${summary.duplicateGroups || 0} 组${duplicate ? `，示例 ${esc(duplicate.files?.[0]?.name || '')}` : ''}</li>
        <li>未引用素材：${summary.unreferenced || 0} 个</li>
        <li>失效引用：${summary.missingReferences || 0} 个${missing ? `，示例 ${esc(missing.path || '')}` : ''}</li>
      </ul>`;
  }

  window.FutureAIMediaLibraryRendering = {
    formatBytes,
    mediaLibraryReportHtml
  };
})();
