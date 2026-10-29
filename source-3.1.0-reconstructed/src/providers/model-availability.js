(() => {
  'use strict';

  /**
   * Which models a provider's key can actually use, and the ordered image fallback chain built
   * from them. Pure functions: callers supply provider records and the model-kind classifier.
   */

  const KIND_TAGS = {chat: '对话', image: '生图', video: '视频'};
  const ROUTE_SEPARATOR = '::';

  // Splits a /v1/models listing into chat, image and video ids (unknown ids are left out).
  function classifyAvailableModels(ids = [], classifyModelKind) {
    const result = {chat: [], image: [], video: []};
    for (const id of new Set(ids.map(item => String(item || '').trim()).filter(Boolean))) {
      const kind = classifyModelKind(id);
      if (kind in result) result[kind].push(id);
    }
    return result;
  }

  function availabilityRecord(ids, classifyModelKind, checkedAt = Date.now()) {
    return {...classifyAvailableModels(ids, classifyModelKind), checkedAt};
  }

  function isAvailableModel(provider, kind, model) {
    const list = provider?.availableModels?.[kind];
    if (!Array.isArray(list)) return false;
    const value = String(model || '').trim().toLowerCase();
    return !!value && list.some(item => String(item).toLowerCase() === value);
  }

  // The chosen model/provider cannot serve the request at all (as opposed to a bad prompt or size).
  function isModelUnavailableError(err) {
    const status = Number(err?.status || 0);
    if (status === 404 || status === 503) return true;
    const text = `${err?.code || ''} ${err?.type || ''} ${err?.message || err || ''}`;
    return /not[_ -]?supported|unsupported|model[_ -]?not[_ -]?found|not[_ -]?available|no available (?:model )?(?:channels?|distributor)|does not exist|模型.*(?:不支持|不存在|不可用|无可用渠道)/i.test(text);
  }

  function routeKey(providerId, model) {
    return `${providerId}${ROUTE_SEPARATOR}${model}`;
  }

  /**
   * Every provider+image-model pair the user could route to, in provider order. `imageModelsFor(provider)`
   * lists a provider's image models; a provider whose "检测可用模型" ran uses that checked list instead.
   */
  function availableImageRoutes(providers = [], imageModelsFor) {
    const routes = [];
    for (const provider of providers) {
      if (!provider?.id || provider.enabledImage === false) continue;
      const checked = provider.availableModels?.image;
      const confirmed = Array.isArray(checked);
      const models = confirmed ? checked : imageModelsFor(provider);
      for (const model of new Set(models.filter(Boolean))) {
        routes.push({key: routeKey(provider.id, model), providerId: provider.id, providerName: provider.name || provider.id, model, confirmed});
      }
    }
    return routes;
  }

  // "gpt-image-2.5-flare" → {family: 'gpt-image-#-flare', version: [2, 5]}. Numbers become '#', so
  // versions of one line share a family; named variants (-flare, -sunburst) are told apart below.
  // "gpt-image2" and "gpt-image-2" name the same model; compare ids in this form.
  function canonicalModelId(model) {
    return String(model || '').trim().toLowerCase().replace(/([a-z])(\d)/g, '$1-$2');
  }

  function modelFamily(model) {
    const text = canonicalModelId(model);
    const version = [];
    const family = text.replace(/(^|[-_/])(\d+(?:\.\d+)*)(?=$|[-_/])/g, (m, sep, num) => {
      if (!version.length) version.push(...num.split('.').map(Number));
      return `${sep}#`;
    });
    return {family, version};
  }

  function compareVersions(a = [], b = []) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const diff = (a[i] || 0) - (b[i] || 0);
      if (diff) return diff;
    }
    return 0;
  }

  // A variant extends another listed model id ("gpt-image-2.5-flare" extends "gpt-image-2.5").
  function isVariantOf(model, others) {
    const id = canonicalModelId(model);
    return others.some(other => {
      const base = canonicalModelId(other);
      return base !== id && id.startsWith(`${base}-`);
    });
  }

  // Whether requests through this provider can carry a key: its own saved key, the built-in global
  // key when the provider borrows it, or a custom-sync endpoint that takes no key.
  function providerHasUsableKey(provider, globalKey = '') {
    if (!provider) return false;
    if (provider.type === 'custom-sync') return true;
    if (provider.apiKeySaved) return true;
    return Boolean(provider.useGlobalKey && String(globalKey || '').trim());
  }

  /**
   * The provider used for a model kind when a node has no provider of its own. The saved choice wins
   * while it can actually send requests; otherwise the first capable provider with a usable key, so a
   * service added on a fresh install is used instead of the keyless built-in default.
   */
  function preferredGlobalProvider(providers = [], {selectedId = '', supports = () => true, hasUsableKey = () => true} = {}) {
    const list = providers.filter(Boolean);
    const capable = list.filter(provider => supports(provider));
    const chosen = capable.find(provider => provider.id === selectedId);
    if (chosen && hasUsableKey(chosen)) return chosen;
    return capable.find(provider => hasUsableKey(provider)) || chosen || capable[0] || list[0] || null;
  }

  // The image route new requests use: the global image provider's chosen model.
  function defaultImageRoute(providers = [], globalImageProviderId = '', imageModelsFor) {
    const usable = providers.filter(provider => provider?.id && provider.enabledImage !== false);
    const provider = usable.find(item => item.id === globalImageProviderId) || usable.find(item => item.imageModel) || usable[0];
    if (!provider) return null;
    const model = provider.imageModel || imageModelsFor(provider)[0] || provider.availableModels?.image?.[0];
    if (!model) return null;
    const confirmed = Array.isArray(provider.availableModels?.image) && provider.availableModels.image.some(item => String(item).toLowerCase() === String(model).toLowerCase());
    return {key: routeKey(provider.id, model), providerId: provider.id, providerName: provider.name || provider.id, model, confirmed};
  }

  /**
   * Up to `limit` automatic backups for `primary`: one route per model id (preferring a provider whose
   * model check confirmed it, then the primary's provider), named variants dropped, the newest model of
   * each family; the next-older version of the primary's own family comes first.
   */
  function autoBackupRoutes(routes = [], primary = null, limit = 2) {
    const primaryId = primary?.model ? canonicalModelId(primary.model) : '';
    const byModel = new Map();
    for (const route of routes) {
      const id = canonicalModelId(route.model);
      if (id === primaryId) continue;
      const current = byModel.get(id);
      const score = item => (item.confirmed ? 2 : 0) + (item.providerId === primary?.providerId ? 1 : 0);
      if (!current || score(route) > score(current)) byModel.set(id, route);
    }
    const ids = [...byModel.keys()];
    const allIds = [...ids, primaryId].filter(Boolean);
    const candidates = [...byModel.values()].filter(route => !isVariantOf(route.model, allIds));
    const primaryInfo = modelFamily(primaryId);
    const families = new Map();
    for (const route of candidates) {
      const info = modelFamily(route.model);
      const sameLine = primaryId && info.family === primaryInfo.family;
      // In the primary's own line prefer the newest version that is not newer than the primary.
      if (sameLine && compareVersions(info.version, primaryInfo.version) > 0) continue;
      const best = families.get(info.family);
      if (!best || compareVersions(info.version, modelFamily(best.model).version) > 0) families.set(info.family, route);
    }
    const picked = [...families.entries()].map(([family, route], index) => ({route, index, own: family === primaryInfo.family}));
    picked.sort((a, b) => (b.own - a.own) || (b.route.confirmed - a.route.confirmed) || a.index - b.index);
    return picked.slice(0, limit).map(item => item.route);
  }

  // Saved settings → {enabled, version: 2, customized, chain}. Older saves (a full `order` list) are
  // dropped in favour of the trimmed automatic chain.
  function normalizeFallbackSettings(raw = {}) {
    const customized = raw?.version === 2 && raw.customized === true && Array.isArray(raw.chain);
    return {
      enabled: raw?.enabled !== false,
      version: 2,
      customized,
      chain: customized ? raw.chain.filter(key => typeof key === 'string') : []
    };
  }

  /**
   * The effective chain: {primary, backups}. A customized chain keeps the user's picks that still
   * exist; otherwise backups are chosen automatically.
   */
  function imageFallbackChain(providers = [], fallback = {}, imageModelsFor, globalImageProviderId = '') {
    const settings = normalizeFallbackSettings(fallback);
    const routes = availableImageRoutes(providers, imageModelsFor);
    const primary = defaultImageRoute(providers, globalImageProviderId, imageModelsFor);
    let backups;
    if (settings.customized) {
      const byKey = new Map(routes.map(route => [route.key, route]));
      backups = [...new Set(settings.chain)].map(key => byKey.get(key)).filter(route => route && route.key !== primary?.key);
    } else {
      backups = autoBackupRoutes(routes, primary);
    }
    return {primary, backups, routes, customized: settings.customized};
  }

  // Routes to try after `failedKey` failed: the primary (if it was not the one that failed), then backups.
  function imageFallbackRoutes(providers = [], fallback = {}, imageModelsFor, globalImageProviderId = '', failedKey = '') {
    const {primary, backups} = imageFallbackChain(providers, fallback, imageModelsFor, globalImageProviderId);
    const seen = new Set([failedKey]);
    return [primary, ...backups].filter(route => route && !seen.has(route.key) && seen.add(route.key));
  }

  function chainSummary(chain) {
    if (!chain?.primary) return '还没有可用的生图模型';
    const backups = chain.backups.map(route => route.model);
    return `当前：${chain.primary.model}${backups.length ? ` → 备用 ${backups.join(' → ')}` : '（无备用）'}`;
  }

  function fallbackEnabled(fallback) {
    return fallback?.enabled !== false;
  }

  // Moves one key up (-1) or down (+1) and returns the new list of keys.
  function moveRoute(routes, key, delta) {
    const keys = routes.map(route => typeof route === 'string' ? route : route.key);
    const from = keys.indexOf(key);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= keys.length) return keys;
    [keys[from], keys[to]] = [keys[to], keys[from]];
    return keys;
  }

  function fallbackNote(route) {
    return `原图片模型不可用，已自动改用 ${route.providerName} · ${route.model}`;
  }

  const api = {KIND_TAGS, providerHasUsableKey, preferredGlobalProvider, classifyAvailableModels, availabilityRecord, isAvailableModel, isModelUnavailableError, routeKey, availableImageRoutes, canonicalModelId, modelFamily, defaultImageRoute, autoBackupRoutes, normalizeFallbackSettings, imageFallbackChain, imageFallbackRoutes, chainSummary, fallbackEnabled, moveRoute, fallbackNote};
  if (typeof window !== 'undefined') window.FutureAIModelAvailability = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
