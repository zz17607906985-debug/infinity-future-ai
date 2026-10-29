const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('localStorageBridge', {
  chooseDir: () => ipcRenderer.invoke('storage:chooseDir'),
  findProjectRoot: () => ipcRenderer.invoke('storage:findProjectRoot'),
  resolveMovedRoot: dir => ipcRenderer.invoke('storage:resolveMovedRoot', dir),
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
  saveRemoteMedia: (dir, payload) => ipcRenderer.invoke('storage:saveRemoteMedia', dir, payload),
  inspectDir: dir => ipcRenderer.invoke('storage:inspectDir', dir),
  defaultDir: options => ipcRenderer.invoke('storage:defaultDir', options),
  copyMedia: (fromDir, toDir) => ipcRenderer.invoke('storage:copyMedia', fromDir, toDir),
  readMedia: target => ipcRenderer.invoke('storage:readMedia', target),
  checkWritable: dir => ipcRenderer.invoke('storage:checkWritable', dir)
});


contextBridge.exposeInMainWorld('wallpaperBridge', {
  current: () => ipcRenderer.invoke('wallpaper:current'),
  importFile: file => ipcRenderer.invoke('wallpaper:import', {sourcePath: webUtils.getPathForFile(file)}),
  remove: () => ipcRenderer.invoke('wallpaper:delete')
});

contextBridge.exposeInMainWorld('templateBridge', {
  list: () => ipcRenderer.invoke('templates:list'),
  save: definition => ipcRenderer.invoke('templates:save', definition),
  remove: id => ipcRenderer.invoke('templates:delete', id)
});

contextBridge.exposeInMainWorld('promptSnippetBridge', {
  list: () => ipcRenderer.invoke('prompts:list'),
  save: definition => ipcRenderer.invoke('prompts:save', definition),
  remove: id => ipcRenderer.invoke('prompts:delete', id)
});

contextBridge.exposeInMainWorld('portableLibraryBridge', {
  list: () => ipcRenderer.invoke('library:list'),
  save: payload => ipcRenderer.invoke('library:save', payload),
  remove: id => ipcRenderer.invoke('library:delete', id)
});

contextBridge.exposeInMainWorld('secretBridge', {
  getApiKey: () => ipcRenderer.invoke('secret:getApiKey'),
  setApiKey: apiKey => ipcRenderer.invoke('secret:setApiKey', apiKey),
  clearApiKey: () => ipcRenderer.invoke('secret:clearApiKey'),
  getProviderApiKey: providerId => ipcRenderer.invoke('secret:getProviderApiKey', providerId),
  setProviderApiKey: (providerId, apiKey) => ipcRenderer.invoke('secret:setProviderApiKey', providerId, apiKey),
  clearProviderApiKey: providerId => ipcRenderer.invoke('secret:clearProviderApiKey', providerId),
  getProviderBalance: request => ipcRenderer.invoke('provider:balance', request)
});

contextBridge.exposeInMainWorld('agentEvalBridge', {
  config: () => ipcRenderer.invoke('agent-eval:config'),
  run: api => ipcRenderer.invoke('agent-eval:run', api)
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


contextBridge.exposeInMainWorld('supportBridge', {
  getInfo: () => ipcRenderer.invoke('support:getInfo'),
  readDocument: id => ipcRenderer.invoke('support:readDocument', id),
  consumeRecoveryNotice: () => ipcRenderer.invoke('support:consumeRecoveryNotice'),
  updateSourceDefault: () => ipcRenderer.invoke('support:updateSourceDefault'),
  checkUpdate: payload => ipcRenderer.invoke('support:checkUpdate', payload),
  openUpdateDownload: target => ipcRenderer.invoke('support:openUpdateDownload', target)
});

contextBridge.exposeInMainWorld('exportBridge', {
  exportProjectPackage: payload => ipcRenderer.invoke('export:projectPackage', payload),
  exportMedia: payload => ipcRenderer.invoke('export:canvasMedia', payload),
  exportSharePackage: payload => ipcRenderer.invoke('export:sharePackage', payload),
  exportSpendCsv: payload => ipcRenderer.invoke('export:spendCsv', payload),
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

contextBridge.exposeInMainWorld('agentBridge', {
  start: payload => ipcRenderer.invoke('agent:start', payload || {}),
  cancel: sessionId => ipcRenderer.invoke('agent:cancel', sessionId),
  restore: logPath => ipcRenderer.invoke('agent:restore', logPath),
  chooseWorkspace: () => ipcRenderer.invoke('agent:chooseWorkspace'),
  canvasResult: payload => ipcRenderer.invoke('agent:canvasResult', payload || {}),
  listTemplates: storageDir => ipcRenderer.invoke('agent:templates:list', storageDir),
  upsertTemplate: payload => ipcRenderer.invoke('agent:templates:upsert', payload || {}),
  deleteTemplate: payload => ipcRenderer.invoke('agent:templates:delete', payload || {}),
  renderTemplate: payload => ipcRenderer.invoke('agent:templates:render', payload || {}),
  listSchedules: storageDir => ipcRenderer.invoke('agent:schedules:list', storageDir),
  upsertSchedule: payload => ipcRenderer.invoke('agent:schedules:upsert', payload || {}),
  deleteSchedule: payload => ipcRenderer.invoke('agent:schedules:delete', payload || {}),
  scheduleHistory: payload => ipcRenderer.invoke('agent:schedules:history', payload || {}),
  auditMonths: storageDir => ipcRenderer.invoke('agent:audit:months', storageDir),
  readAudit: payload => ipcRenderer.invoke('agent:audit:read', payload || {}),
  emergencyStop: () => ipcRenderer.invoke('agent:emergencyStop'),
  emergencyHotkey: payload => ipcRenderer.invoke('agent:emergencyHotkey', payload || {}),
  listApprovals: payload => ipcRenderer.invoke('agent:approvals:list', payload || {}),
  resolveApproval: payload => ipcRenderer.invoke('agent:approvals:resolve', payload || {}),
  approvalCount: storageDir => ipcRenderer.invoke('agent:approvals:count', storageDir),
  listSessions: () => ipcRenderer.invoke('agent:sessions'),
  discardSession: sessionId => ipcRenderer.invoke('agent:discardSession', sessionId),
  listMemory: storageDir => ipcRenderer.invoke('agent:memory:list', storageDir),
  upsertMemory: payload => ipcRenderer.invoke('agent:memory:upsert', payload || {}),
  deleteMemory: payload => ipcRenderer.invoke('agent:memory:delete', payload || {}),
  onEvent: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('agent:event', listener);
    return () => ipcRenderer.removeListener('agent:event', listener);
  }
});

contextBridge.exposeInMainWorld('codexBridge', {
  status: payload => ipcRenderer.invoke('codex:status', payload || {}),
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

// Window close: the main process asks the page to write pending saves first.
contextBridge.exposeInMainWorld('lifecycleBridge', {
  onFlushRequest: handler => {
    ipcRenderer.on('app:flush-request', async (_event, id) => {
      try { await handler(); } catch {}
      ipcRenderer.send('app:flush-done', id);
    });
  }
});
