(() => {
  'use strict';

  function create(deps = {}) {
    const Core = () => deps.Core || window.FutureAISharePackage;
    const $ = deps.$ || (id => document.getElementById(id));
    const toast = deps.toast || (() => {});
    const getNodes = deps.getNodes || (() => new Map());
    const getSelectedIds = deps.getSelectedIds || (() => []);
    const getProjectName = deps.getProjectName || (() => '未命名项目');
    const getStorageDir = deps.getStorageDir || (() => '');
    const exportSnapshot = deps.exportSnapshot || null;

    let scope = 'selection';
    let format = 'share-zip';

    function modal() { return $('exportShareModal'); }
    function summaryEl() { return $('exportShareSummary'); }
    function statusEl() { return $('exportShareStatus'); }

    function resolveNodeList() {
      const map = getNodes();
      const selected = [...(getSelectedIds() || [])].map(id => map.get(id)).filter(Boolean);
      if (scope === 'selection' && selected.length) return selected;
      return [...map.values()];
    }

    function refreshSummary() {
      const core = Core();
      if (!core || !summaryEl()) return null;
      const effectiveScope = scope === 'selection' && !(getSelectedIds() || []).length ? 'canvas' : scope;
      const collection = core.collectShareItems(resolveNodeList(), {scope: effectiveScope});
      const summary = core.summarizeForUi(collection);
      const scopeText = effectiveScope === 'selection' ? '当前选中' : '整板';
      summaryEl().textContent = summary.count
        ? `${scopeText}：${summary.count} 个可导出（图 ${summary.images} / 视频 ${summary.videos}，含提示词 ${summary.withPrompt}）`
        : `${scopeText}里还没有可导出的图片或视频`;
      return collection;
    }

    function setStatus(text) {
      if (statusEl()) statusEl().textContent = text || '';
    }

    function open(opts = {}) {
      if (opts.scope === 'selection' || opts.scope === 'canvas') scope = opts.scope;
      if (opts.format) format = opts.format;
      const el = modal();
      if (!el) return;
      el.classList.remove('hidden');
      el.setAttribute('aria-hidden', 'false');
      el.querySelectorAll('[data-export-scope]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.exportScope === scope);
      });
      el.querySelectorAll('[data-export-format]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.exportFormat === format);
      });
      refreshSummary();
      setStatus('分享包会带上图片/视频、提示词和说明；不含密钥。');
    }

    function close() {
      const el = modal();
      if (!el) return;
      el.classList.add('hidden');
      el.setAttribute('aria-hidden', 'true');
    }

    async function runExport() {
      const core = Core();
      if (!core) return toast('分享导出组件未加载', 'error');
      if (format === 'snapshot') {
        close();
        if (!exportSnapshot) return toast('当前环境不支持画布快照', 'warn');
        try {
          const result = await exportSnapshot({scope: scope === 'selection' ? 'selection' : 'canvas'});
          if (result) toast(`画布快照已保存（${result.nodeCount} 个节点）`, 'success');
        } catch (err) {
          toast(err?.message || String(err), 'error');
        }
        return;
      }

      const collection = refreshSummary();
      if (!collection?.count) return toast('没有可导出的图片或视频', 'warn');

      if (format === 'media-zip' || format === 'media-folder') {
        if (!window.exportBridge?.exportMedia) return toast('当前环境不支持导出媒体', 'warn');
        try {
          setStatus('正在导出…');
          const result = await window.exportBridge.exportMedia({
            storageDir: getStorageDir(),
            format: format === 'media-zip' ? 'zip' : 'folder',
            items: collection.items.map(item => ({
              title: item.title,
              mediaType: item.mediaType,
              sourceUrl: item.sourceUrl
            }))
          });
          close();
          if (!result) return;
          toast(`已导出 ${result.count} 个文件${result.failed ? `，${result.failed} 个失败` : ''}`, result.failed ? 'warn' : 'success');
        } catch (err) {
          setStatus('');
          toast(err?.message || String(err), 'error');
        }
        return;
      }

      if (!window.exportBridge?.exportSharePackage) return toast('当前环境不支持分享包', 'warn');
      try {
        setStatus('正在打包分享包…');
        const result = await window.exportBridge.exportSharePackage({
          storageDir: getStorageDir(),
          projectName: getProjectName(),
          scope: collection.scope,
          items: collection.items
        });
        close();
        if (!result) return;
        toast(`分享包已导出：${result.mediaCount || 0} 个素材`, 'success');
      } catch (err) {
        setStatus('');
        toast(err?.message || String(err), 'error');
      }
    }

    function bind() {
      $('openExportShare')?.addEventListener('click', () => open({scope: (getSelectedIds() || []).length ? 'selection' : 'canvas'}));
      $('openExportShareSettings')?.addEventListener('click', () => open({scope: 'canvas', format: 'share-zip'}));
      $('exportShareSelection')?.addEventListener('click', () => open({scope: 'selection', format: 'share-zip'}));
      $('closeExportShare')?.addEventListener('click', close);
      modal()?.addEventListener('click', e => {
        if (e.target === modal()) close();
        const scopeBtn = e.target.closest('[data-export-scope]');
        if (scopeBtn) {
          scope = scopeBtn.dataset.exportScope;
          modal().querySelectorAll('[data-export-scope]').forEach(btn => btn.classList.toggle('active', btn === scopeBtn));
          refreshSummary();
        }
        const formatBtn = e.target.closest('[data-export-format]');
        if (formatBtn) {
          format = formatBtn.dataset.exportFormat;
          modal().querySelectorAll('[data-export-format]').forEach(btn => btn.classList.toggle('active', btn === formatBtn));
        }
      });
      $('exportShareConfirm')?.addEventListener('click', () => { runExport(); });
    }

    return {open, close, bind, refreshSummary, runExport};
  }

  window.FutureAIShareExportUi = {create};
})();
