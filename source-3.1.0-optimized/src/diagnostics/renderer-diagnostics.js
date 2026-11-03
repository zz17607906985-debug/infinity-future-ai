(() => {
  'use strict';

  function valueOf(read, id) {
    try {
      return read(id) || '';
    } catch {
      return '';
    }
  }

  function buildSettingsSummary({readValue = () => '', storageDir = ''} = {}) {
    return {
      imageModel: valueOf(readValue, 'imageModel'),
      videoModel: valueOf(readValue, 'videoModel'),
      chatModel: valueOf(readValue, 'chatModel'),
      comfyWorkflowName: valueOf(readValue, 'comfyWorkflowName'),
      apiConfigured: Boolean(valueOf(readValue, 'apiUrl')),
      comfyConfigured: Boolean(valueOf(readValue, 'comfyUrl')),
      storageConfigured: Boolean(storageDir)
    };
  }

  function rendererErrorPayload(event = {}) {
    return {
      type: 'error',
      message: event.message || '',
      source: event.filename || '',
      line: event.lineno || 0,
      column: event.colno || 0,
      stack: event.error?.stack || ''
    };
  }

  function rendererRejectionPayload(event = {}) {
    return {
      type: 'unhandledrejection',
      message: event.reason?.message || String(event.reason || ''),
      stack: event.reason?.stack || ''
    };
  }

  const api = {
    buildSettingsSummary,
    rendererErrorPayload,
    rendererRejectionPayload
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FutureAIRendererDiagnostics = api;
})();
