function normalizeCodexPermission(mode, { internal = false, scheduled = false } = {}) {
  const requested = String(mode || 'project');
  if (requested === 'readonly') return 'readonly';
  if (requested === 'full' && internal && !scheduled) return 'full';
  return 'project';
}

module.exports = {
  normalizeCodexPermission
};
