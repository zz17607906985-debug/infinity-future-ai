(() => {
  'use strict';

  /** License activation UI (bridge glue + status card). */
  function create(deps = {}) {
    const $ = deps.$;
    const esc = deps.esc;
    const toast = deps.toast;
    const openModal = deps.openModal;

    function renderLicenseStatus(result = {status: 'invalid'}) {
      const card = $('licenseStatus');
      if (!card) return;
      const status = result.status || 'invalid';
      const states = {
        active: ['fa-solid fa-shield-check', '已激活', `${result.maskedLicenseId || ''} · v${result.majorVersion || 1} · ${result.updateEligible ? '可获取维护期更新' : '永久版可用'}`],
        'not-activated': ['fa-regular fa-circle', '尚未激活', '输入购买后收到的兑换码即可使用'],
        'not-configured': ['fa-solid fa-triangle-exclamation', '发行配置未完成', '当前内部版本尚未写入正式发行公钥'],
        invalid: ['fa-solid fa-shield-halved', '授权状态异常', result.reason || '请重新导入有效激活响应码']
      };
      const [icon, title, detail] = states[status] || states.invalid;
      card.dataset.status = status;
      card.innerHTML = `<i class="${icon}"></i><div><strong>${esc(title)}</strong><span>${esc(detail)}</span></div>`;
      if ($('deactivateLicense')) $('deactivateLicense').disabled = status !== 'active';
    }

    async function refreshLicenseStatus() {
      if (!window.licenseBridge?.getStatus) return renderLicenseStatus({status: 'not-configured'});
      try {
        renderLicenseStatus(await window.licenseBridge.getStatus());
      } catch (err) {
        renderLicenseStatus({status: 'invalid', reason: err.message || String(err)});
      }
    }

    async function createLicenseActivationRequest() {
      if (!window.licenseBridge?.createActivationRequest) return toast('当前环境不支持软件授权', 'warn');
      try {
        const code = await window.licenseBridge.createActivationRequest({licenseId: ($('licenseId')?.value || '').trim()});
        if ($('activationRequestCode')) $('activationRequestCode').value = code;
        toast('请求码已生成', 'success');
      } catch (err) {
        toast('生成请求码失败：\n' + (err.message || err), 'error');
      }
    }

    async function redeemLicense() {
      if (!window.licenseBridge?.redeem) return toast('当前环境不支持在线激活', 'warn');
      const field = $('licenseRedemptionCode');
      const button = $('redeemLicense');
      const code = field?.value?.trim();
      if (!code) return toast('请输入兑换码', 'warn');
      if (button?.disabled) return;
      if (button) {
        button.disabled = true;
        button.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 激活中';
      }
      try {
        const result = await window.licenseBridge.redeem(code);
        renderLicenseStatus(result);
        if (field) field.value = '';
        toast('当前电脑已激活', 'success');
      } catch (err) {
        const reason = String(err?.message || err);
        const message = /TIMEOUT|network|fetch/i.test(reason)
          ? '暂时无法连接授权服务，请检查网络后重试'
          : /NOT_FOUND|INVALID_CODE|ACTIVATION_REJECTED/i.test(reason)
            ? '兑换码无效或已被停用'
            : reason;
        toast('激活失败：\n' + message, 'error');
        await refreshLicenseStatus();
      } finally {
        if (button) {
          button.disabled = false;
          button.innerHTML = '<i class="fa-solid fa-shield-check"></i> 激活';
        }
      }
    }

    async function copyLicenseActivationRequest() {
      const field = $('activationRequestCode');
      const value = field?.value?.trim();
      if (!value) return toast('请先生成请求码', 'warn');
      try {
        await navigator.clipboard.writeText(value);
        toast('请求码已复制', 'success');
      } catch {
        field.focus();
        field.select();
        document.execCommand('copy');
        toast('请求码已复制', 'success');
      }
    }

    async function importLicenseActivation() {
      if (!window.licenseBridge?.importActivation) return toast('当前环境不支持软件授权', 'warn');
      const code = $('activationResponseCode')?.value?.trim();
      if (!code) return toast('请输入激活响应码', 'warn');
      try {
        const result = await window.licenseBridge.importActivation(code);
        renderLicenseStatus(result);
        if ($('activationResponseCode')) $('activationResponseCode').value = '';
        toast('本机授权已激活', 'success');
      } catch (err) {
        toast('激活失败：\n' + (err.message || err), 'error');
        await refreshLicenseStatus();
      }
    }

    async function deactivateLicense() {
      if (!window.licenseBridge?.deactivate) return toast('当前环境不支持软件授权', 'warn');
      const confirmed = await openModal({
        title: '解除本机授权',
        text: '解除后可在其他电脑重新输入原兑换码。',
        okText: '确认解除',
        confirm: true
      });
      if (!confirmed) return;
      try {
        const online = typeof window.licenseBridge.release === 'function';
        const result = online ? await window.licenseBridge.release() : await window.licenseBridge.deactivate();
        if (!online && $('activationRequestCode')) $('activationRequestCode').value = JSON.stringify(result);
        await refreshLicenseStatus();
        toast(online ? '本机已解除，可在其他电脑重新激活' : '本机已解除；离线回执已保存在恢复区域', 'success');
      } catch (err) {
        toast('解除失败，本机授权保持不变：\n' + (err.message || err), 'error');
      }
    }

    return {
      renderLicenseStatus,
      refreshLicenseStatus,
      createLicenseActivationRequest,
      redeemLicense,
      copyLicenseActivationRequest,
      importLicenseActivation,
      deactivateLicense
    };
  }

  window.FutureAILicenseUI = { create };
})();
