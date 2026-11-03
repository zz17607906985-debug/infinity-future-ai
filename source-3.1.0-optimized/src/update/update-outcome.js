const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const TERMINAL = new Set(['completed', 'rolled-back', 'rollback-failed']);

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is invalid`);
  return value;
}

function parseInstallerUpdateOutcome({transaction, status, acknowledgement = null} = {}) {
  object(transaction, 'update transaction');
  object(status, 'update status');
  if (transaction.schema !== 'future-ai-installer-update-transaction/v1'
    || !UUID.test(String(transaction.token || ''))
    || !['update', 'rollback'].includes(transaction.mode)
    || !VERSION.test(String(transaction.currentVersion || ''))
    || !VERSION.test(String(transaction.targetVersion || ''))) throw new Error('update transaction is invalid');
  if (status.schema !== 'future-ai-installer-update-status/v1'
    || status.token !== transaction.token
    || typeof status.status !== 'string'
    || !Number.isFinite(Date.parse(status.updatedAt))) throw new Error('update status is invalid');
  if (!TERMINAL.has(status.status)) return null;
  if (acknowledgement && typeof acknowledgement === 'object'
    && acknowledgement.schema === 'future-ai-update-acknowledgement/v1'
    && acknowledgement.token === status.token
    && acknowledgement.status === status.status
    && acknowledgement.updatedAt === status.updatedAt) return null;
  return Object.freeze({
    token: status.token,
    status: status.status,
    mode: transaction.mode,
    updatedAt: status.updatedAt,
    currentVersion: transaction.currentVersion,
    targetVersion: transaction.targetVersion,
    workspaceBackupVerified: status.status === 'rolled-back'
  });
}

module.exports = {parseInstallerUpdateOutcome};
