(() => {
  'use strict';

  const STORE = {
    projects: 'future_clean_projects',
    current: 'future_clean_current',
    settings: 'future_clean_settings',
    models: 'future_clean_models',
    history: 'future_clean_history',
    assets: 'future_clean_assets',
    assetFolders: 'future_clean_asset_folders'
  };

  const FILE_STORE_BY_KEY = {
    [STORE.projects]: 'projects',
    [STORE.history]: 'history',
    [STORE.assets]: 'assets',
    [STORE.assetFolders]: 'asset-folders',
    [STORE.models]: 'models'
  };

  function compactHistoryItem(item, strict = false) {
    const keepUrl = url => strict && String(url || '').startsWith('data:') ? '' : (url || '');
    return {
      ...item,
      url: keepUrl(item.url),
      refUrl: '',
      urls: strict ? [] : (item.urls || []).filter(u => !String(u || '').startsWith('data:')).slice(0, 4)
    };
  }

  function compactBrowserStoreValue(key, value) {
    if (key === STORE.projects) return compactProjectsForBrowser(value);
    if (key === STORE.history) return (value || []).map(item => compactHistoryItem(item, true)).slice(0, 20);
    if (key === STORE.assets) return (value || []).map(item => compactHistoryItem(item, true)).slice(0, 40);
    return value;
  }

  function compactProjectsForBrowser(list) {
    if (!Array.isArray(list)) return [];
    return list.map(project => {
      const p = {...project};
      if (p.state?.nodes) {
        p.state = {
          ...p.state,
          nodes: p.state.nodes.map(item => ({
            ...item,
            data: compactNodeDataForBrowser(item.data || {})
          }))
        };
      }
      return p;
    });
  }

  function compactNodeDataForBrowser(data) {
    const compact = stripDataMedia(data);
    delete compact.status;
    delete compact.statusType;
    delete compact.statusTitle;
    return compact;
  }

  function stripDataMedia(value) {
    if (typeof value === 'string') return /^data:(image|video)\//i.test(value) ? '' : value;
    if (Array.isArray(value)) return value.map(stripDataMedia).filter(item => item !== '');
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stripDataMedia(item)]));
    }
    return value;
  }

  function shouldUseCompactBrowserStore(key, storageDir, localStorageBridge) {
    return key === STORE.projects && Boolean(storageDir && localStorageBridge);
  }

  function isQuotaError(err) {
    return /quota|exceeded|storage/i.test(err?.name || err?.message || String(err));
  }

  window.FutureAICanvasStorage = {
    STORE,
    FILE_STORE_BY_KEY,
    compactHistoryItem,
    compactBrowserStoreValue,
    compactProjectsForBrowser,
    compactNodeDataForBrowser,
    stripDataMedia,
    shouldUseCompactBrowserStore,
    isQuotaError
  };
})();
