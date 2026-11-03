(() => {
  'use strict';

  const DEFAULT_KEY_ID = 'key-1';

  function normalizeKeyPool(provider = {}) {
    const source = Array.isArray(provider.keyPool) ? provider.keyPool : [];
    const seen = new Set();
    const keys = source.map((item, index) => {
      const id = String(item?.id || `key-${index + 1}`).trim();
      if (!id || seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        label: String(item?.label || `Key ${index + 1}`).trim() || `Key ${index + 1}`,
        scope: ['all', 'chat', 'image', 'video'].includes(item?.scope) ? item.scope : 'all',
        lastUsedAt: Number(item?.lastUsedAt || 0),
        failureCount: Number(item?.failureCount || 0),
        cooldownUntil: Number(item?.cooldownUntil || 0),
        lastError: String(item?.lastError || '').slice(0, 240),
        health: ['unknown', 'ok', 'cooldown', 'blocked'].includes(item?.health) ? item.health : 'unknown'
      };
    }).filter(Boolean);
    const activeKeyId = keys.some(item => item.id === provider.activeKeyId)
      ? provider.activeKeyId
      : (keys[0]?.id || '');
    return {keys, activeKeyId};
  }

  function migrateLegacyProviderKey(provider = {}, hasLegacyKey = false) {
    const normalized = normalizeKeyPool(provider);
    if (!normalized.keys.length && (hasLegacyKey || provider.apiKeySaved || provider.apiKey)) {
      normalized.keys.push({id: DEFAULT_KEY_ID, label: '主 Key', scope: 'all', lastUsedAt: 0, failureCount: 0});
      normalized.activeKeyId = DEFAULT_KEY_ID;
    }
    return normalized;
  }

  function activeKeyMeta(provider = {}) {
    const pool = normalizeKeyPool(provider);
    return pool.keys.find(item => item.id === pool.activeKeyId) || pool.keys[0] || null;
  }

  function normalizeModelKeyBindings(bindings = {}, keys = []) {
    const validIds = new Set((Array.isArray(keys) ? keys : []).map(item => String(item?.id || '').trim()).filter(Boolean));
    if (!bindings || typeof bindings !== 'object') return {};
    return Object.fromEntries(Object.entries(bindings)
      .map(([model, keyId]) => [String(model || '').trim(), String(keyId || '').trim()])
      .filter(([model, keyId]) => model && validIds.has(keyId)));
  }

  function capabilityModelField(capability = 'all') {
    return capability === 'chat' ? 'chatModel' : capability === 'video' ? 'videoModel' : capability === 'image' ? 'imageModel' : '';
  }

  function isKeyCapabilityBlocked(provider = {}, keyId = '', capability = 'all') {
    if (capability !== 'image' || !keyId) return false;
    return provider.imageCapabilityByKey?.[keyId]?.status === 'blocked';
  }

  function selectKeyIdForRequest(provider = {}, capability = 'all', requestedModel = '', now = Date.now(), runningCounts = {}) {
    const normalized = normalizeKeyPool(provider);
    const keys = normalized.keys.filter(item => item.scope === 'all' || item.scope === capability);
    if (!keys.length) return '';
    const available = keys.filter(item => (
      Number(item.cooldownUntil || 0) <= now
      && item.health !== 'blocked'
      && !isKeyCapabilityBlocked(provider, item.id, capability)
    ));
    if (!available.length) return '';
    // A model binding or a legacy manual mode must never turn a shared provider
    // back into a single-key bottleneck. Every eligible key participates.
    return available.slice().sort((a, b) => {
      const loadDiff = Number(runningCounts?.[a.id] || 0) - Number(runningCounts?.[b.id] || 0);
      return loadDiff || Number(a.lastUsedAt || 0) - Number(b.lastUsedAt || 0);
    })[0]?.id || '';
  }

  function shouldRotateOnError(error) {
    const status = Number(error?.status || error?.response?.status || 0);
    const message = String(error?.message || error || '');
    return status === 401 || status === 403 || status === 429 || /invalid.{0,12}(?:api.?key|credential)|quota|rate.?limit|unauthori[sz]ed|forbidden/i.test(message);
  }

  function sanitizeErrorSummary(error, secrets = []) {
    let message = String(error?.message || error || '');
    for (const secret of Array.isArray(secrets) ? secrets : []) {
      const value = String(secret || '');
      if (value.length >= 4) message = message.split(value).join('[REDACTED]');
    }
    return message
      .replace(/sk-[A-Za-z0-9_\-]{8,}/g, 'sk-[REDACTED]')
      .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]')
      .replace(/((?:api[_ -]?key|token)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
      .slice(0, 240);
  }

  function takeLease(leases, preferredId = '') {
    if (!Array.isArray(leases) || !leases.length) return '';
    const wanted = String(preferredId || '').trim();
    const index = wanted ? leases.indexOf(wanted) : 0;
    if (index < 0) return String(leases.shift() || '');
    return String(leases.splice(index, 1)[0] || '');
  }

  window.FutureAIKeyPool = {normalizeKeyPool, migrateLegacyProviderKey, activeKeyMeta, normalizeModelKeyBindings, isKeyCapabilityBlocked, selectKeyIdForRequest, shouldRotateOnError, sanitizeErrorSummary, takeLease, DEFAULT_KEY_ID};
})();
