(() => {
  'use strict';

  /** Support center + diagnostics handlers (presentation / bridge glue). */
  function create(deps = {}) {
    const $ = deps.$;
    const toast = deps.toast;
    const getStore = deps.getStore;
    const setStore = deps.setStore;
    const STORE = deps.STORE;
    const RendererDiagnostics = deps.RendererDiagnostics;
    const getStorageDir = deps.getStorageDir;
    const getCurrentProjectId = deps.getCurrentProjectId;
    const getAppReleaseChannel = deps.getAppReleaseChannel;
    const setAppReleaseChannel = deps.setAppReleaseChannel;
    const getCodexPermission = deps.getCodexPermission;
    const setCodexPermission = deps.setCodexPermission;
    const setCodexCommand = deps.setCodexCommand;

    function installDiagnosticsHandlers() {
      if (!window.diagnosticsBridge?.logRendererError || window.__futureDiagnosticsInstalled) return;
      window.__futureDiagnosticsInstalled = true;
      window.addEventListener('error', event => {
        window.diagnosticsBridge.logRendererError(RendererDiagnostics.rendererErrorPayload(event));
      });
      window.addEventListener('unhandledrejection', event => {
        window.diagnosticsBridge.logRendererError(RendererDiagnostics.rendererRejectionPayload(event));
      });
    }

    function diagnosticsSettingsSummary() {
      return RendererDiagnostics.buildSettingsSummary({
        readValue: id => $(id)?.value || '',
        storageDir: getStorageDir()
      });
    }

    async function loadSupportCenter() {
      if (!window.supportBridge?.getInfo) return;
      try {
        const info = await window.supportBridge.getInfo();
        const channel = info.releaseChannel === 'stable' ? 'stable' : 'internal';
        setAppReleaseChannel(channel);
        if ($('homeVersionBadge')) {
          $('homeVersionBadge').textContent = `${channel === 'stable' ? '商业版' : '内部验证'} v${info.version}`;
        }
        if (channel === 'stable') {
          const nextPermission = getCodexPermission() === 'readonly' ? 'readonly' : 'project';
          setCodexPermission(nextPermission);
          setCodexCommand('');
          const settings = getStore(STORE.settings, {});
          setStore(STORE.settings, {...settings, codexPermission: nextPermission, codexCommand: ''});
        }
        if ($('supportVersion')) $('supportVersion').textContent = `v${info.version}`;
        if ($('supportChannel')) $('supportChannel').textContent = info.releaseChannel === 'stable' ? '正式版' : '内部测试';
        if ($('supportTrustStatus')) {
          const ready = info.signatureStatus === 'verified-at-build' && info.supportConfigured && info.legalStatus === 'approved';
          $('supportTrustStatus').textContent = ready ? '已验证' : '待完成商业配置';
          $('supportTrustStatus').dataset.status = ready ? 'ready' : 'pending';
        }
      } catch (_error) {
        if ($('homeVersionBadge')) $('homeVersionBadge').textContent = '版本信息不可用';
        if ($('supportTrustStatus')) $('supportTrustStatus').textContent = '支持信息不完整';
      }
    }

    function renderSupportMarkdown(content) {
      const host = $('supportDocumentContent');
      if (!host) return;
      host.replaceChildren();
      let list = null;
      for (const rawLine of String(content || '').replace(/\r/g, '').split('\n')) {
        const line = rawLine.trimEnd();
        const heading = line.match(/^(#{1,3})\s+(.+)$/);
        const item = line.match(/^[-*]\s+(.+)$/);
        if (heading) {
          list = null;
          const element = document.createElement(heading[1].length === 1 ? 'h2' : heading[1].length === 2 ? 'h3' : 'h4');
          element.textContent = heading[2];
          host.appendChild(element);
        } else if (item) {
          if (!list) {
            list = document.createElement('ul');
            host.appendChild(list);
          }
          const element = document.createElement('li');
          element.textContent = item[1];
          list.appendChild(element);
        } else if (line) {
          list = null;
          const element = document.createElement('p');
          element.textContent = line;
          host.appendChild(element);
        } else {
          list = null;
        }
      }
    }

    async function openSupportDocument(id) {
      if (!window.supportBridge?.readDocument) return toast('当前环境不支持读取帮助文档', 'warn');
      try {
        const documentInfo = await window.supportBridge.readDocument(id);
        if ($('supportDocumentTitle')) $('supportDocumentTitle').textContent = documentInfo.title;
        renderSupportMarkdown(documentInfo.content);
        $('supportDocumentModal')?.classList.remove('hidden');
      } catch (error) {
        toast('帮助文档打开失败：\n' + (error.message || error), 'error');
      }
    }

    function closeSupportDocument() {
      $('supportDocumentModal')?.classList.add('hidden');
    }

    async function exportDiagnosticsPackage() {
      if (!window.diagnosticsBridge?.exportDiagnostics) return toast('当前环境不支持导出诊断包', 'warn');
      try {
        const result = await window.diagnosticsBridge.exportDiagnostics({
          storageDir: getStorageDir(),
          currentProjectId: getCurrentProjectId(),
          settingsSummary: diagnosticsSettingsSummary()
        });
        toast(result?.reportFile ? '诊断包已导出' : '诊断包导出完成', 'success');
      } catch (err) {
        toast('诊断包导出失败：\n' + (err.message || err), 'error');
      }
    }

    return {
      installDiagnosticsHandlers,
      diagnosticsSettingsSummary,
      loadSupportCenter,
      renderSupportMarkdown,
      openSupportDocument,
      closeSupportDocument,
      exportDiagnosticsPackage
    };
  }

  window.FutureAISupportUI = { create };
})();
