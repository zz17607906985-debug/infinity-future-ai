const crypto = require('node:crypto');
const fs = require('node:fs');

const KID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;

function loadIssuerKeyRing(file, expectedSchema = 'future-ai-issuer-keys/v1') {
  const raw = fs.readFileSync(file, 'utf8');
  if (Buffer.byteLength(raw, 'utf8') > 64 * 1024) throw new Error('发行公钥配置超过安全限制');
  const doc = JSON.parse(raw);
  if (!doc || Object.keys(doc).sort().join(',') !== 'keys,schema'
    || doc.schema !== expectedSchema || !Array.isArray(doc.keys) || doc.keys.length > 8) {
    throw new Error('发行公钥配置格式无效');
  }
  const ring = new Map();
  for (const item of doc.keys) {
    if (!item || Object.keys(item).sort().join(',') !== 'alg,kid,publicKey'
      || item.alg !== 'Ed25519' || typeof item.kid !== 'string' || !KID_PATTERN.test(item.kid)
      || typeof item.publicKey !== 'string' || item.publicKey.length > 2048 || ring.has(item.kid)) {
      throw new Error('发行公钥条目无效');
    }
    const keyBytes = Buffer.from(item.publicKey, 'base64url');
    if (keyBytes.toString('base64url') !== item.publicKey) throw new Error('发行公钥编码无效');
    const publicKey = crypto.createPublicKey({ key: keyBytes, type: 'spki', format: 'der' });
    if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('发行公钥算法无效');
    ring.set(item.kid, publicKey);
  }
  return ring;
}

module.exports = { loadIssuerKeyRing };
