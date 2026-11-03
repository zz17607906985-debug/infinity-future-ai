(() => {
  'use strict';

  const CLEANUP_TYPE_LABELS = {
    asarBackup: '历史 asar 备份',
    updateAsarBackup: '过期更新 asar 备份',
    codexBackup: '过期 Codex 备份',
    orphanInstallRuntime: '安装目录遗留运行时',
    installDebris: '安装目录无关残留',
    tmpE2E: 'E2E 临时产物',
    unreferencedMedia: '未引用素材',
    oldLogs: '旧日志'
  };

  function cleanupTypeLabel(type) {
    return CLEANUP_TYPE_LABELS[type] || type;
  }

  function defaultFormatBytes(bytes = 0) {
    const size = Number(bytes) || 0;
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / 1024 / 1024).toFixed(2)} MB`;
  }

  function formatCleanupSummary({scan = {}, formatBytes = defaultFormatBytes} = {}) {
    const byType = scan?.summary?.byType || {};
    const lines = Object.entries(byType).map(([type, item]) => `${cleanupTypeLabel(type)}：${item.count} 项，${formatBytes(item.bytes)}`);
    return [
      `将清理 ${scan?.summary?.count || 0} 项，约 ${formatBytes(scan?.summary?.bytes || 0)}。`,
      ...lines,
      '',
      '不会删除当前 app.asar、正在使用的 Codex、API Key、项目数据和被项目引用的素材。',
      'FFmpeg、bundled Codex 本体与用户项目目录不受影响。',
      '确认执行清理？'
    ].join('\n');
  }

  window.FutureAICleanupRendering = {
    CLEANUP_TYPE_LABELS,
    cleanupTypeLabel,
    formatCleanupSummary
  };
})();
