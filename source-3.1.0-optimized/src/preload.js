const { contextBridge, ipcRenderer, webUtils } = require('electron');

function createMeshoptBridge() {
  try {
    const resourcesPath = typeof process !== 'undefined' && typeof process.resourcesPath === 'string'
      ? process.resourcesPath
      : '';
    if (!resourcesPath) throw new Error('resourcesPath unavailable');
    const meshoptDecoder = require(resourcesPath + '/meshopt_decoder.cjs');
    return {
      supported: !!meshoptDecoder?.supported,
      waitUntilReady: () => Promise.resolve(meshoptDecoder?.ready).then(() => undefined),
      decodeGltfBufferAsync: (count, size, source, mode, filter) => (
        meshoptDecoder.decodeGltfBufferAsync(count, size, source, mode, filter)
      )
    };
  } catch {
    return {
      supported: false,
      waitUntilReady: () => Promise.resolve(),
      decodeGltfBufferAsync: () => Promise.reject(new Error('Meshopt decoder unavailable'))
    };
  }
}

contextBridge.exposeInMainWorld('localStorageBridge', {
  chooseDir: () => ipcRenderer.invoke('storage:chooseDir'),
  findProjectRoot: () => ipcRenderer.invoke('storage:findProjectRoot'),
  openDir: dir => ipcRenderer.invoke('storage:openDir', dir),
  readJson: (dir, name) => ipcRenderer.invoke('storage:readJson', dir, name),
  writeJson: (dir, name, data) => ipcRenderer.invoke('storage:writeJson', dir, name, data),
  onRecovery: handler => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('storage:recovery', listener);
    return () => ipcRenderer.removeListener('storage:recovery', listener);
  },
  listProjectBackups: dir => ipcRenderer.invoke('storage:listProjectBackups', dir),
  restoreProjectBackup: (dir, fileName) => ipcRenderer.invoke('storage:restoreProjectBackup', dir, fileName),
  saveMedia: (dir, payload) => ipcRenderer.invoke('storage:saveMedia', dir, payload),
  readMedia: target => ipcRenderer.invoke('storage:readMedia', target),
  canvasPreview: target => ipcRenderer.invoke('storage:canvasPreview', target),
  checkWritable: dir => ipcRenderer.invoke('storage:checkWritable', dir)
});

contextBridge.exposeInMainWorld('wallpaperBridge', {
  current: () => ipcRenderer.invoke('wallpaper:current'),
  importFile: file => ipcRenderer.invoke('wallpaper:import', {sourcePath: webUtils.getPathForFile(file)}),
  remove: () => ipcRenderer.invoke('wallpaper:delete')
});

const meshoptBridge = createMeshoptBridge();

contextBridge.exposeInMainWorld('secretBridge', {
  getApiKey: () => ipcRenderer.invoke('secret:getApiKey'),
  setApiKey: apiKey => ipcRenderer.invoke('secret:setApiKey', apiKey),
  clearApiKey: () => ipcRenderer.invoke('secret:clearApiKey'),
  getProviderApiKey: providerId => ipcRenderer.invoke('secret:getProviderApiKey', providerId),
  getProviderApiKeyForKey: (providerId, keyId) => ipcRenderer.invoke('secret:getProviderApiKeyForKey', providerId, keyId),
  listProviderApiKeys: providerId => ipcRenderer.invoke('secret:listProviderApiKeys', providerId),
  setProviderApiKey: (providerId, apiKey, keyId, label, scope) => ipcRenderer.invoke('secret:setProviderApiKey', providerId, apiKey, keyId, label, scope),
  updateProviderApiKeyMetadata: (providerId, keyId, metadata) => ipcRenderer.invoke('secret:updateProviderApiKeyMetadata', providerId, keyId, metadata),
  removeProviderApiKey: (providerId, keyId) => ipcRenderer.invoke('secret:removeProviderApiKey', providerId, keyId),
  clearProviderApiKey: providerId => ipcRenderer.invoke('secret:clearProviderApiKey', providerId),
  getProviderBalance: request => ipcRenderer.invoke('provider:balance', request)
});

contextBridge.exposeInMainWorld('e2eBridge', {
  getConfig: () => ipcRenderer.invoke('e2e:getConfig'),
  focusWindow: () => ipcRenderer.invoke('e2e:focusWindow'),
  writeReport: report => ipcRenderer.invoke('e2e:writeReport', report),
  quit: code => ipcRenderer.invoke('e2e:quit', code)
});

contextBridge.exposeInMainWorld('diagnosticsBridge', {
  exportDiagnostics: payload => ipcRenderer.invoke('diagnostics:export', payload),
  logRendererError: payload => ipcRenderer.invoke('diagnostics:logRendererError', payload)
});

contextBridge.exposeInMainWorld('meshoptBridge', meshoptBridge);

contextBridge.exposeInMainWorld('supportBridge', {
  getInfo: () => ipcRenderer.invoke('support:getInfo'),
  readDocument: id => ipcRenderer.invoke('support:readDocument', id)
});

contextBridge.exposeInMainWorld('exportBridge', {
  exportProjectPackage: payload => ipcRenderer.invoke('export:projectPackage', payload),
  exportManjuVideo: payload => ipcRenderer.invoke('manju:exportVideo', payload),
  synthesizeManjuVoice: payload => ipcRenderer.invoke('manju:synthesizeVoice', payload),
  onManjuExportProgress: handler => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('manju:export-progress', listener);
    return () => ipcRenderer.removeListener('manju:export-progress', listener);
  }
});

contextBridge.exposeInMainWorld('reviewBridge', {
  exportPackage: payload => ipcRenderer.invoke('review:export', payload || {})
});

contextBridge.exposeInMainWorld('providerConformanceBridge', {
  exportEvidence: payload => ipcRenderer.invoke('provider:exportConformanceEvidence', payload || {})
});

contextBridge.exposeInMainWorld('backupBridge', {
  exportWorkspace: payload => ipcRenderer.invoke('backup:exportWorkspace', payload || {}),
  restoreWorkspace: payload => ipcRenderer.invoke('backup:restoreWorkspace', payload || {})
});

contextBridge.exposeInMainWorld('mediaLibraryBridge', {
  scanMediaLibrary: payload => ipcRenderer.invoke('media:index', payload)
});

contextBridge.exposeInMainWorld('mediaDownloadBridge', {
  downloadRemoteImage: payload => ipcRenderer.invoke('media:downloadRemoteImage', payload || {})
});

contextBridge.exposeInMainWorld('cleanupBridge', {
  scanCleanup: payload => ipcRenderer.invoke('cleanup:scan', payload),
  executeCleanup: payload => ipcRenderer.invoke('cleanup:execute', payload)
});

contextBridge.exposeInMainWorld('updateBridge', {
  capabilities: () => ipcRenderer.invoke('update:capabilities'),
  checkUpdates: payload => ipcRenderer.invoke('update:check', payload),
  applyUpdatePackage: payload => ipcRenderer.invoke('update:apply', payload),
  rollbackUpdate: payload => ipcRenderer.invoke('update:rollback', payload || {}),
  reportHealthy: () => ipcRenderer.invoke('update:healthReady'),
  getOutcome: () => ipcRenderer.invoke('update:getOutcome'),
  acknowledgeOutcome: payload => ipcRenderer.invoke('update:acknowledgeOutcome', payload || {})
});

contextBridge.exposeInMainWorld('licenseBridge', {
  getStatus: () => ipcRenderer.invoke('license:getStatus'),
  redeem: redemptionCode => ipcRenderer.invoke('license:redeem', redemptionCode),
  release: () => ipcRenderer.invoke('license:release'),
  createActivationRequest: payload => ipcRenderer.invoke('license:createActivationRequest', payload || {}),
  importActivation: activationCode => ipcRenderer.invoke('license:importActivation', activationCode),
  deactivate: () => ipcRenderer.invoke('license:deactivate')
});

contextBridge.exposeInMainWorld('codexBridge', {
  check: payload => ipcRenderer.invoke('codex:check', payload || {}),
  chooseCommand: () => ipcRenderer.invoke('codex:chooseCommand'),
  extensions: () => ipcRenderer.invoke('codex:extensions'),
  chooseExtension: kind => ipcRenderer.invoke('codex:chooseExtension', kind),
  importExtension: payload => ipcRenderer.invoke('codex:importExtension', payload || {}),
  saveAttachment: (file, payload = {}) => {
    const sourcePath = webUtils.getPathForFile(file);
    return ipcRenderer.invoke('codex:saveAttachment', {
      storageDir: payload.storageDir,
      name: payload.name,
      mime: payload.mime,
      sourcePath,
      bytes: sourcePath ? undefined : payload.bytes
    });
  },
  readTextAttachment: payload => ipcRenderer.invoke('codex:readTextAttachment', payload || {}),
  readScriptImport: payload => ipcRenderer.invoke('short:readScriptImport', payload || {}),
  importSkillPackage: payload => ipcRenderer.invoke('short:importSkillPackage', payload || {}),
  readSkillPackage: payload => ipcRenderer.invoke('short:readSkillPackage', payload || {}),
  videoFrames: payload => ipcRenderer.invoke('codex:videoFrames', payload || {}),
  run: payload => ipcRenderer.invoke('codex:run', payload || {}),
  update: payload => ipcRenderer.invoke('codex:update', payload || {}),
  cancel: sessionId => ipcRenderer.invoke('codex:cancel', sessionId),
  onOutput: handler => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('codex:output', listener);
    return () => ipcRenderer.removeListener('codex:output', listener);
  }
});

contextBridge.exposeInMainWorld('skillMarketBridge', {
  search: payload => ipcRenderer.invoke('skillMarket:search', payload || {})
});

contextBridge.exposeInMainWorld('musicBridge', {
  search: payload => ipcRenderer.invoke('music:search', payload || {}),
  plugins: () => ipcRenderer.invoke('music:plugins'),
  registry: () => ipcRenderer.invoke('music:pluginRegistry'),
  resolveTrack: payload => ipcRenderer.invoke('music:resolveTrack', payload || {})
});

contextBridge.exposeInMainWorld('mediaBridge', {
  searchVideo: payload => ipcRenderer.invoke('media:searchVideo', payload || {}),
  searchRadio: payload => ipcRenderer.invoke('media:searchRadio', payload || {}),
  process: payload => ipcRenderer.invoke('media:process', payload || {})
});
