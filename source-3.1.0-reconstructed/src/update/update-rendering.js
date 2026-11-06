(() => {
  'use strict';

  function formatUpdateSummary(result = {}) {
    return [
      `当前版本：${result?.currentVersion || '未知'}`,
      `更新版本：${result?.availableVersion || '未发现'}`,
      `更新包：${result?.installerPath || '未选择'}`,
      `发布者：${result?.publisher || '未验证'}`,
      '',
      '升级前会自动创建完整工作区备份。',
      '新版本启动检查失败时会自动运行上一版签名安装器。'
    ].join('\n');
  }

  function rollbackConfirmationText() {
    return '将验证并运行上一版签名安装器。开始前会自动创建完整工作区备份，若上一版启动失败会恢复当前版本。确认回滚？';
  }

  window.FutureAIUpdateRendering = {
    formatUpdateSummary,
    rollbackConfirmationText
  };
})();
