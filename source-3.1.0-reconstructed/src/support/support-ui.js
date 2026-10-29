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
          $('homeVersionBadge').textContent = channel === 'stable' ? `商业版 v${info.version}` : `v${info.version}`;
        }
        if (channel === 'stable') {
          const nextPermission = getCodexPermission() === 'readonly' ? 'readonly' : 'project';
          setCodexPermission(nextPermission);
          const settings = getStore(STORE.settings, {});
          setStore(STORE.settings, {...settings, codexPermission: nextPermission});
        }
        if ($('supportVersion')) $('supportVersion').textContent = info.buildLabel ? `v${info.version}（${info.buildLabel}）` : `v${info.version}`;
        if ($('supportChannel')) $('supportChannel').textContent = info.releaseChannel === 'stable' ? '正式版' : '通用版';
        if ($('supportTrustStatus')) {
          const ready = info.signatureStatus === 'verified-at-build' && info.supportConfigured && info.legalStatus === 'approved';
          $('supportTrustStatus').textContent = ready ? '已验证' : '可用';
          $('supportTrustStatus').dataset.status = ready ? 'ready' : 'pending';
        }
      } catch (_error) {
        if ($('homeVersionBadge')) $('homeVersionBadge').textContent = '版本信息不可用';
        if ($('supportTrustStatus')) $('supportTrustStatus').textContent = '支持信息不完整';
      }
    }

    const UPDATE_STORE = 'futureai.updateCheck';
    let updateDownloadTarget = '';

    function updatePrefs() {
      const saved = getStore(UPDATE_STORE, {}) || {};
      return {source: String(saved.source || ''), auto: saved.auto !== false, lastAutoDay: String(saved.lastAutoDay || '')};
    }

    function saveUpdatePrefs(patch) {
      setStore(UPDATE_STORE, {...updatePrefs(), ...patch});
    }

    function todayKey() {
      const now = new Date();
      return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
    }

    function renderUpdateResult(result) {
      const host = $('updateResult');
      if (!host) return;
      host.replaceChildren();
      updateDownloadTarget = '';
      if (!result) {
        host.classList.add('hidden');
        return;
      }
      host.dataset.status = result.status;
      const title = document.createElement('strong');
      const latest = result.latest || {};
      const label = latest.version ? `v${latest.version}${latest.build ? `（${latest.build}）` : ''}` : '';
      title.textContent = result.status === 'update' ? `发现新版本 ${label}`
        : result.status === 'latest' ? `已经是最新版本（${label || '当前版本'}）`
        : result.status === 'unconfigured' ? '还没有填写更新地址'
        : '检查更新没有成功';
      host.appendChild(title);
      const detail = result.status === 'error' ? result.message
        : result.status === 'unconfigured' ? '填写售后提供的更新地址后再检查；不填写时软件不会联网检查更新。'
        : result.status === 'update' ? (latest.notes || '') + (latest.date ? `${latest.notes ? '\n' : ''}发布日期：${latest.date}` : '')
        : '';
      if (detail) {
        const text = document.createElement('p');
        text.textContent = detail;
        host.appendChild(text);
      }
      if (result.status === 'update') {
        const hint = document.createElement('p');
        hint.textContent = '更新方法：先关闭软件，下载新版压缩包，解压后覆盖到当前文件夹即可，项目和设置不会丢失。';
        host.appendChild(hint);
        if (latest.download) {
          updateDownloadTarget = latest.download;
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'ghost-btn';
          button.id = 'openUpdateDownload';
          button.innerHTML = '<i class="fa-solid fa-download"></i> 打开下载位置';
          button.addEventListener('click', openUpdateDownload);
          host.appendChild(button);
        }
      }
      host.classList.remove('hidden');
    }

    async function checkForUpdates({silent = false} = {}) {
      if (!window.supportBridge?.checkUpdate) {
        if (!silent) toast('当前环境不支持检查更新', 'warn');
        return null;
      }
      const source = String($('updateSource')?.value || '').trim();
      const button = $('checkUpdateNow');
      if (button && !silent) button.disabled = true;
      try {
        const result = await window.supportBridge.checkUpdate({source});
        if (!silent || result?.status === 'update') renderUpdateResult(result);
        if (silent && result?.status === 'update') {
          toast(`发现新版本 v${result.latest.version}，可在「设置 → 客户支持与版本」查看`, 'success');
        }
        return result;
      } catch (error) {
        const result = {status: 'error', message: error?.message || String(error)};
        if (!silent) renderUpdateResult(result);
        return result;
      } finally {
        if (button) button.disabled = false;
      }
    }

    async function openUpdateDownload() {
      if (!updateDownloadTarget || !window.supportBridge?.openUpdateDownload) return;
      const opened = await window.supportBridge.openUpdateDownload(updateDownloadTarget).catch(() => false);
      if (!opened) toast('下载位置打不开，请确认网络或共享文件夹可以访问', 'warn');
    }

    async function initUpdateCheck() {
      const prefs = updatePrefs();
      const input = $('updateSource');
      const auto = $('updateAutoCheck');
      const fallback = await window.supportBridge?.updateSourceDefault?.().catch(() => '') || '';
      if (input) {
        input.value = prefs.source;
        if (fallback) input.placeholder = `留空则使用：${fallback}`;
        input.addEventListener('change', () => {
          saveUpdatePrefs({source: input.value.trim()});
          renderUpdateResult(null);
        });
      }
      if (auto) {
        auto.checked = prefs.auto;
        auto.addEventListener('change', () => saveUpdatePrefs({auto: auto.checked}));
      }
      $('checkUpdateNow')?.addEventListener('click', () => checkForUpdates());
      const configured = Boolean(prefs.source || fallback);
      if (prefs.auto && configured && prefs.lastAutoDay !== todayKey()) {
        saveUpdatePrefs({lastAutoDay: todayKey()});
        window.setTimeout(() => checkForUpdates({silent: true}), 4000);
      }
    }

    async function showRecoveryNotice() {
      const notice = await window.supportBridge?.consumeRecoveryNotice?.().catch(() => null);
      if (!notice) return;
      toast(notice.reason === 'unresponsive'
        ? '界面已重新加载，项目已保存。点「继续上次项目」接着做，最近几秒的改动可能需要重做'
        : '界面刚才意外退出，已自动重新打开，项目已保存。点「继续上次项目」接着做，最近几秒的改动可能需要重做', 'warn');
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
      initUpdateCheck,
      checkForUpdates,
      showRecoveryNotice,
      renderSupportMarkdown,
      openSupportDocument,
      closeSupportDocument,
      exportDiagnosticsPackage
    };
  }

  window.FutureAISupportUI = { create };
})();
