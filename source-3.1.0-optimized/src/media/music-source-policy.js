const crypto = require('crypto');

const KNOWN_SOURCE_IDS = new Set(['audius', 'ccmixter', 'archive', 'wikimedia', 'radio']);

function normalizeOpenMusicLicense(name = '', url = '') {
  const text = `${name} ${url}`.toLowerCase();
  if (!text.trim() || /non[-_ ]?commercial|\bby-nc\b|\/by-nc|\bnc-sa\b|\bnc-nd\b/.test(text)) return null;
  if (/public domain|\bcc0\b|\/publicdomain\//.test(text)) {
    return { id: /\bcc0\b/.test(text) ? 'CC0-1.0' : 'LicenseRef-Public-Domain', attributionRequired: false };
  }
  if (/\bby-sa\b|\/by-sa\//.test(text)) return { id: 'CC-BY-SA', attributionRequired: true };
  if (/creative commons attribution|\bcc[-_ ]?by\b|\/by\//.test(text)) return { id: 'CC-BY', attributionRequired: true };
  return null;
}

function openMusicRights(name = '', url = '') {
  const normalized = normalizeOpenMusicLicense(name, url);
  if (!normalized) return null;
  return {
    mode: 'open-license',
    licenseId: normalized.id,
    licenseName: String(name || normalized.id).slice(0, 120),
    licenseUrl: /^https?:\/\//i.test(String(url || '')) ? String(url).slice(0, 240) : '',
    attributionRequired: normalized.attributionRequired,
    downloadAllowed: false,
    exportAllowed: false
  };
}

function platformStreamRights(platform, termsUrl) {
  return {
    mode: 'platform-stream',
    licenseId: 'NOASSERTION',
    licenseName: `${platform} platform stream`,
    licenseUrl: termsUrl,
    attributionRequired: false,
    downloadAllowed: false,
    exportAllowed: false
  };
}

function trustedMusicStreamUrl(sourceId, value) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    return false;
  }
  return sourceId === 'audius' && parsed.protocol === 'https:' && parsed.hostname === 'api.audius.co'
    || sourceId === 'ccmixter' && parsed.protocol === 'https:' && /(^|\.)ccmixter\.org$/i.test(parsed.hostname) && parsed.pathname.startsWith('/content/')
    || sourceId === 'archive' && parsed.protocol === 'https:' && parsed.hostname === 'archive.org' && parsed.pathname.startsWith('/download/')
    || sourceId === 'wikimedia' && parsed.protocol === 'https:' && parsed.hostname === 'upload.wikimedia.org'
    || sourceId === 'radio' && /^https?:$/.test(parsed.protocol);
}

function createMusicSourcePolicy(options = {}) {
  const ttlMs = Math.max(1000, Number(options.ttlMs || 30 * 60 * 1000));
  const limit = Math.max(8, Number(options.limit || 256));
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const grants = new Map();

  function prune() {
    const timestamp = now();
    for (const [token, grant] of grants) {
      if (grant.expiresAt <= timestamp) grants.delete(token);
    }
    while (grants.size >= limit) grants.delete(grants.keys().next().value);
  }

  function issue(track) {
    const url = String(track?.url || '').trim();
    const sourceId = String(track?.sourceId || '').trim();
    if (!url || !KNOWN_SOURCE_IDS.has(sourceId) || !trustedMusicStreamUrl(sourceId, url)) return null;
    prune();
    const playbackGrant = crypto.randomBytes(18).toString('base64url');
    grants.set(playbackGrant, { sourceId, url, expiresAt: now() + ttlMs });
    return { ...track, playbackGrant };
  }

  function resolve(payload = {}) {
    const track = payload?.track || {};
    const sourceId = String(track.sourceId || payload.sourceId || '');
    if (!KNOWN_SOURCE_IDS.has(sourceId)) throw new Error('未知音乐来源插件');
    const url = String(track.url || '').trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('来源没有返回可播放的 HTTP 音频地址');
    const grant = grants.get(String(track.playbackGrant || ''));
    if (!grant || grant.expiresAt <= now() || grant.sourceId !== sourceId || grant.url !== url) {
      throw new Error('音乐播放授权已失效，请重新搜索该歌曲');
    }
    if (!trustedMusicStreamUrl(sourceId, url)) throw new Error('音乐来源返回了未经授权的播放地址');
    return { url, headers: {}, quality: 'standard', sourceId, rights: track.rights || null };
  }

  return { issue, resolve };
}

module.exports = {
  createMusicSourcePolicy,
  normalizeOpenMusicLicense,
  openMusicRights,
  platformStreamRights,
  trustedMusicStreamUrl
};
