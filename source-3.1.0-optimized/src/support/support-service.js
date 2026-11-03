'use strict';

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');

const MAX_SUPPORT_DOCUMENT_BYTES = 1024 * 1024;
const SUPPORT_DOCUMENTS = Object.freeze({
  help: { file: 'HELP-CENTER.md', title: '帮助中心' },
  privacy: { file: 'PRIVACY-POLICY.md', title: '隐私政策' },
  agreement: { file: 'USER-AGREEMENT.md', title: '用户协议' },
  refund: { file: 'REFUND-AND-SUPPORT.md', title: '退款与售后' },
  requirements: { file: 'SYSTEM-REQUIREMENTS.md', title: '系统要求' },
  releases: { file: 'RELEASE-NOTES.md', title: '版本说明' },
  thirdParty: { file: 'THIRD-PARTY-NOTICES.txt', title: '第三方许可' },
  musicPolicy: { file: 'MUSIC-SOURCE-POLICY.md', title: '音乐来源政策' }
});

function resolveLegalRoot(candidates = []) {
  const root = candidates
    .filter(Boolean)
    .map(candidate => path.resolve(candidate))
    .find(candidate => fsSync.existsSync(candidate) && fsSync.statSync(candidate).isDirectory());
  if (!root) throw new Error('客户支持文档未随应用安装');
  return root;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function readSupportDocument(legalRoot, id) {
  const entry = SUPPORT_DOCUMENTS[id];
  if (!entry) throw new Error('不支持的帮助文档');
  const root = path.resolve(legalRoot);
  const file = path.resolve(root, entry.file);
  if (path.dirname(file) !== root) throw new Error('帮助文档路径无效');
  const stats = await fs.stat(file);
  if (!stats.isFile() || stats.size > MAX_SUPPORT_DOCUMENT_BYTES) throw new Error('帮助文档大小异常');
  return { id, title: entry.title, content: await fs.readFile(file, 'utf8') };
}

async function buildSupportInfo({ legalRoot, version, releaseChannel = 'internal', packaged = false }) {
  const contact = await readJson(path.join(legalRoot, 'support-contact.json'), { status: 'unconfigured', channels: [] });
  const approval = await readJson(path.join(legalRoot, 'legal-approval.json'), { status: 'draft' });
  return {
    version: String(version || '0.0.0'),
    releaseChannel: releaseChannel === 'stable' ? 'stable' : 'internal',
    packaged: Boolean(packaged),
    signatureStatus: releaseChannel === 'stable' ? 'verified-at-build' : 'unsigned-internal',
    supportConfigured: contact.status === 'configured' && Array.isArray(contact.channels) && contact.channels.length > 0,
    legalStatus: approval.status === 'approved' ? 'approved' : 'draft',
    documents: Object.entries(SUPPORT_DOCUMENTS).map(([id, item]) => ({ id, title: item.title }))
  };
}

module.exports = {
  MAX_SUPPORT_DOCUMENT_BYTES,
  SUPPORT_DOCUMENTS,
  buildSupportInfo,
  readSupportDocument,
  resolveLegalRoot
};
