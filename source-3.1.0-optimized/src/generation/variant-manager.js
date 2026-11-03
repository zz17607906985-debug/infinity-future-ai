(function () {
  'use strict';

  const STATUSES = Object.freeze(['unseen', 'candidate', 'approved', 'rejected', 'revision']);
  const STATUS_LABELS = Object.freeze({unseen: '未查看', candidate: '候选', approved: '通过', rejected: '淘汰', revision: '返工'});

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function normalizeStatus(value) {
    return STATUSES.includes(value) ? value : 'unseen';
  }

  function normalizeVariant(value = {}, index = 0) {
    return {
      id: String(value.id || `variant-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`),
      mediaType: value.mediaType === 'video' ? 'video' : 'image',
      url: String(value.url || ''),
      status: normalizeStatus(value.status),
      model: String(value.model || ''),
      provider: String(value.provider || ''),
      prompt: String(value.prompt || ''),
      parameters: clone(value.parameters || {}),
      elapsedMs: Math.max(0, Number(value.elapsedMs || 0)),
      estimatedCost: value.estimatedCost == null ? null : clone(value.estimatedCost),
      actualDuration: value.actualDuration == null ? null : Number(value.actualDuration),
      error: String(value.error || ''),
      createdAt: Number(value.createdAt || Date.now()),
      viewedAt: Number(value.viewedAt || 0),
      approvedAt: Number(value.approvedAt || 0)
    };
  }

  function variants(data = {}) {
    return (Array.isArray(data.variants) ? data.variants : []).map(normalizeVariant).filter(item => item.url || item.error);
  }

  function recordOutputs(data = {}, outputs = []) {
    const list = variants(data);
    const incoming = (Array.isArray(outputs) ? outputs : [outputs]).map(normalizeVariant);
    incoming.forEach(item => {
      const existing = list.find(candidate => candidate.url && item.url && candidate.url === item.url);
      if (existing) Object.assign(existing, item, {id: existing.id, status: existing.status});
      else list.unshift(item);
    });
    data.variants = list.slice(0, 40);
    if (data.approval?.outputUrl && incoming.some(item => item.url && item.url !== data.approval.outputUrl)) {
      data.approval = Object.assign({}, data.approval, {status: 'invalidated', invalidatedAt: Date.now(), reason: '输出内容已更新，需要重新确认'});
    }
    return data.variants;
  }

  function ensureCurrentOutput(data = {}, mediaType = 'image') {
    const urls = Array.isArray(data.urls) && data.urls.length ? data.urls : [data.url].filter(Boolean);
    return recordOutputs(data, urls.map((url, index) => ({
      url,
      mediaType,
      status: data.approval?.outputUrl === url && data.approval?.status === 'approved' ? 'approved' : 'unseen',
      model: data.model,
      prompt: data.prompt,
      parameters: mediaType === 'video'
        ? {operation: data.operation, size: data.size, duration: data.duration, speed: data.speed}
        : {aspect: data.aspect, size: data.size, resolution: data.resolution, quality: data.quality, seed: data.seed},
      actualDuration: data.outputMetadata?.actualDuration ?? null,
      createdAt: Number(data.outputMetadata?.recordedAt || data.generatedAt || Date.now()) + index
    })));
  }

  function setStatus(data = {}, variantId, status) {
    const next = normalizeStatus(status);
    const list = variants(data);
    const item = list.find(value => value.id === variantId);
    if (!item) return null;
    item.status = next;
    item.viewedAt = Date.now();
    if (next === 'approved') {
      list.forEach(value => { if (value.id !== item.id && value.status === 'approved') value.status = 'candidate'; });
      item.approvedAt = Date.now();
      data.approval = {status: 'approved', variantId: item.id, outputUrl: item.url, approvedAt: item.approvedAt};
    } else if (data.approval?.variantId === item.id) {
      data.approval = {status: 'invalidated', variantId: item.id, outputUrl: item.url, invalidatedAt: Date.now(), reason: `状态改为${STATUS_LABELS[next]}`};
    }
    data.variants = list;
    return item;
  }

  function replaceWithVariant(data = {}, variantId) {
    const list = variants(data);
    const winner = list.find(item => item.id === variantId && item.url);
    if (!winner) throw new Error('没有找到可替换的候选版本');
    const previous = {url: data.url || '', urls: clone(data.urls || []), outputMetadata: clone(data.outputMetadata || null)};
    if (previous.url && previous.url !== winner.url) recordOutputs(data, [{url: previous.url, mediaType: winner.mediaType, status: 'candidate', model: data.model, prompt: data.prompt, parameters: winner.parameters}]);
    data.url = winner.url;
    data.urls = [winner.url];
    if (winner.mediaType === 'video') data.outputMetadata = Object.assign({}, data.outputMetadata || {}, {actualDuration: winner.actualDuration});
    data.selectedVariantId = winner.id;
    data.variants = variants(data);
    return {winner, previous};
  }

  function approvedVariants(data = {}) {
    return variants(data).filter(item => item.status === 'approved' && item.url);
  }

  function branchSpecs({models = [], prompts = [], seeds = [], aspects = [], durations = [], referenceSets = [], max = 12} = {}) {
    const values = {
      models: (models.length ? models : ['']).slice(0, max),
      prompts: (prompts.length ? prompts : ['']).slice(0, max),
      seeds: (seeds.length ? seeds : ['']).slice(0, max),
      aspects: (aspects.length ? aspects : ['']).slice(0, max),
      durations: (durations.length ? durations : ['']).slice(0, max),
      referenceSets: (referenceSets.length ? referenceSets : [null]).slice(0, max)
    };
    const output = [];
    for (const model of values.models) for (const prompt of values.prompts) for (const seed of values.seeds) for (const aspect of values.aspects) for (const duration of values.durations) for (const references of values.referenceSets) {
      output.push({model, prompt, seed, aspect, duration, references: clone(references)});
      if (output.length >= max) return output;
    }
    return output;
  }

  window.FutureAIVariantManager = {
    STATUSES,
    STATUS_LABELS,
    normalizeVariant,
    variants,
    recordOutputs,
    ensureCurrentOutput,
    setStatus,
    replaceWithVariant,
    approvedVariants,
    branchSpecs
  };
})();
