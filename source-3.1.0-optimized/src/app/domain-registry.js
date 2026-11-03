(() => {
  'use strict';

  /**
   * Domain module registry for the renderer shell.
   * First-cut split map (grow this as more of app.js is extracted):
   *
   *   media/image-editors.js      → FutureAIImageEditors
   *   support/support-ui.js        → FutureAISupportUI
   *   licensing/license-ui.js      → FutureAILicenseUI
   *   runtime/performance-mode.js  → FutureAIPerformanceMode
   *   media/short-workbench.js     → FutureAIShortWorkbench
   *   providers/provider-api.js    → FutureAIProviderApi
   *   providers/provider-ui.js     → FutureAIProviderUI
   *   generation/generation-queue.js → FutureAIGenerationQueue
   *   canvas/runtime.js            → FutureAICanvasRuntime
   *   canvas/layout.js             → FutureAICanvasLayout
   *   runtime/e2e-smoke.js         → FutureAIE2ESmoke
   *   assistant/dialog-runtime.js  → FutureAIDialogRuntime
   *   assistant/chrome.js          → FutureAIAssistantChrome
   *   media/workbench.js           → FutureAIMediaWorkbench
   *   project/store.js             → FutureAIProjectStore
   *   runtime/vendor-loader.js     → FutureAIVendors
   *
   * Still in app.js: shell orchestration, remaining drawers/modals.
   */
  function requireDomain(name, globalName) {
    const api = window[globalName];
    if (!api?.create) {
      console.error(`[domain] missing ${name} (${globalName})`);
      return null;
    }
    return api;
  }

  function createDomains(deps) {
    const imageEditors = requireDomain('image-editors', 'FutureAIImageEditors')?.create(deps.imageEditors || {});
    const supportUI = requireDomain('support-ui', 'FutureAISupportUI')?.create(deps.supportUI || {});
    const licenseUI = requireDomain('license-ui', 'FutureAILicenseUI')?.create(deps.licenseUI || {});
    const performanceMode = requireDomain('performance-mode', 'FutureAIPerformanceMode')?.create(deps.performanceMode || {});
    const providerApi = requireDomain('provider-api', 'FutureAIProviderApi')?.create(deps.providerApi || {});
    const providerUI = requireDomain('provider-ui', 'FutureAIProviderUI')?.create(deps.providerUI || {});
    const generationQueue = requireDomain('generation-queue', 'FutureAIGenerationQueue')?.create(deps.generationQueue || {});
    const canvasRuntime = requireDomain('canvas-runtime', 'FutureAICanvasRuntime')?.create(deps.canvasRuntime || {});
    const canvasLayout = requireDomain('canvas-layout', 'FutureAICanvasLayout')?.create(deps.canvasLayout || {});
    const canvasEvents = requireDomain('canvas-events', 'FutureAICanvasEvents')?.create(deps.canvasEvents || {});
    const shortWorkbench = window.FutureAIShortWorkbench?.create(deps.shortWorkbench || {}) || null;
    const e2eSmoke = requireDomain('e2e-smoke', 'FutureAIE2ESmoke')?.create(deps.e2eSmoke || {});
    const dialogRuntime = requireDomain('dialog-runtime', 'FutureAIDialogRuntime')?.create(deps.dialogRuntime || {});
    const assistantChrome = requireDomain('assistant-chrome', 'FutureAIAssistantChrome')?.create(deps.assistantChrome || {});
    const mediaWorkbench = window.FutureAIMediaWorkbench?.create(deps.mediaWorkbench || {}) || null;
    const projectStore = requireDomain('project-store', 'FutureAIProjectStore')?.create(deps.projectStore || {});
    return {
      imageEditors,
      supportUI,
      licenseUI,
      performanceMode,
      providerApi,
      providerUI,
      generationQueue,
      canvasRuntime,
      canvasLayout,
      canvasEvents,
      shortWorkbench,
      e2eSmoke,
      dialogRuntime,
      assistantChrome,
      mediaWorkbench,
      projectStore
    };
  }

  window.FutureAIDomainRegistry = {
    createDomains,
    map: Object.freeze({
      imageEditors: 'FutureAIImageEditors',
      supportUI: 'FutureAISupportUI',
      licenseUI: 'FutureAILicenseUI',
      performanceMode: 'FutureAIPerformanceMode',
      providerApi: 'FutureAIProviderApi',
      providerUI: 'FutureAIProviderUI',
      generationQueue: 'FutureAIGenerationQueue',
      canvasRuntime: 'FutureAICanvasRuntime',
      canvasLayout: 'FutureAICanvasLayout',
      canvasEvents: 'FutureAICanvasEvents',
      shortWorkbench: 'FutureAIShortWorkbench',
      e2eSmoke: 'FutureAIE2ESmoke',
      dialogRuntime: 'FutureAIDialogRuntime',
      assistantChrome: 'FutureAIAssistantChrome',
      mediaWorkbench: 'FutureAIMediaWorkbench',
      projectStore: 'FutureAIProjectStore',
      vendors: 'FutureAIVendors'
    })
  };
})();
