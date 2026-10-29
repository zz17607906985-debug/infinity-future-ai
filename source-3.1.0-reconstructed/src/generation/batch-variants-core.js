(function initBatchVariantsCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FutureAIBatchVariantsCore = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  'use strict';

  // Choice (agent17s): batch/variants always spawn N NEW sibling image nodes in a neat row.
  // Source node (prompt / url / history) stays untouched — same contract as local-edit.
  // 「选用这张继续」 selects a result node for downstream wires; siblings stay on canvas.

  const MAX_COUNT = 4;
  const DEFAULT_COUNT = 2;
  const GAP_X = 36;
  const OFFSET_X = 80;

  const STYLE_PRESETS = Object.freeze([
    { id: 'realistic', label: '写实', suffix: '，写实摄影，细腻皮肤质感，自然光影，高细节' },
    { id: 'anime', label: '动漫', suffix: '，日系动漫风格，清晰线稿，鲜明配色，赛璐璐上色' },
    { id: 'flat', label: '扁平', suffix: '，扁平插画，色块分明，少阴影，矢量感' },
    { id: 'cinematic', label: '电影感', suffix: '，电影灯光，胶片质感，宽银幕构图，氛围强烈' },
    { id: 'illustration', label: '插画', suffix: '，数字插画，笔触感，艺术构图，精致细节' }
  ]);

  const ASPECT_PRESETS = Object.freeze([
    { id: '1:1', label: '1:1' },
    { id: '16:9', label: '16:9' },
    { id: '9:16', label: '9:16' },
    { id: '4:3', label: '4:3' },
    { id: '3:4', label: '3:4' }
  ]);

  const MODES = Object.freeze(['same', 'style', 'aspect']);

  function clampCount(value, fallback = DEFAULT_COUNT) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(1, Math.min(MAX_COUNT, n));
  }

  function normalizeMode(value) {
    return MODES.includes(value) ? value : 'same';
  }

  function styleById(id) {
    return STYLE_PRESETS.find(item => item.id === id) || null;
  }

  function aspectById(id) {
    return ASPECT_PRESETS.find(item => item.id === id) || null;
  }

  function uniqueIds(list, allowed) {
    const seen = new Set();
    const out = [];
    for (const raw of Array.isArray(list) ? list : []) {
      const id = String(raw || '');
      if (!id || seen.has(id)) continue;
      if (allowed && !allowed.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }

  function applyStyleSuffix(prompt, styleId) {
    const base = String(prompt || '').trim();
    const style = styleById(styleId);
    if (!style) return base;
    if (!base) return style.suffix.replace(/^，/, '').trim();
    if (base.includes(style.suffix.trim()) || base.includes(style.label)) return base;
    return base + style.suffix;
  }

  /**
   * Build N generation specs from panel options.
   * @returns {{specs: object[], tip: string, unsupported: boolean}}
   */
  function buildSpecs({
    count = DEFAULT_COUNT,
    mode = 'same',
    prompt = '',
    aspect = '16:9',
    size = '',
    model = '',
    resolution = '1K',
    styles = [],
    aspects = [],
    seed = '',
    useSourceImage = false,
    sourceUrl = '',
    canGenerate = true
  } = {}) {
    if (!canGenerate) {
      return {
        specs: [],
        tip: '当前模型不支持批量生成',
        unsupported: true
      };
    }
    const n = clampCount(count);
    const kind = normalizeMode(mode);
    const basePrompt = String(prompt || '').trim();
    const baseAspect = String(aspect || '16:9');
    const baseSeed = String(seed || '').trim();
    const seedBase = Number.parseInt(baseSeed, 10);
    const hasSeed = baseSeed && Number.isFinite(seedBase);

    // Generation needs a prompt even for image-to-image (the queue rejects empty prompts),
    // so block here instead of creating nodes that are bound to fail.
    if (!basePrompt) {
      return { specs: [], tip: '请先填写提示词', unsupported: false };
    }

    const specs = [];
    if (kind === 'style') {
      const allowed = new Set(STYLE_PRESETS.map(item => item.id));
      // One node per selected style (count picker is ignored in this mode).
      const pool = uniqueIds(styles, allowed).slice(0, MAX_COUNT);
      if (!pool.length) return { specs: [], tip: '请至少选择一种风格', unsupported: false };
      for (let index = 0; index < pool.length; index += 1) {
        const style = styleById(pool[index]);
        specs.push({
          index,
          label: `变体·${style.label}`,
          prompt: applyStyleSuffix(basePrompt, style.id),
          aspect: baseAspect,
          size: size || '',
          model,
          resolution,
          seed: hasSeed ? String(seedBase + index) : '',
          styleId: style.id,
          useSourceImage: Boolean(useSourceImage && sourceUrl),
          mode: 'style'
        });
      }
    } else if (kind === 'aspect') {
      const allowed = new Set(ASPECT_PRESETS.map(item => item.id));
      // One node per selected ratio (count picker is ignored in this mode).
      const pool = uniqueIds(aspects, allowed).slice(0, MAX_COUNT);
      if (!pool.length) return { specs: [], tip: '请至少选择一种比例', unsupported: false };
      for (let index = 0; index < pool.length; index += 1) {
        const preset = aspectById(pool[index]);
        specs.push({
          index,
          label: `变体·${preset.label}`,
          prompt: basePrompt,
          aspect: preset.id,
          size: '',
          model,
          resolution,
          seed: hasSeed ? String(seedBase + index) : '',
          styleId: '',
          useSourceImage: Boolean(useSourceImage && sourceUrl),
          mode: 'aspect'
        });
      }
    } else {
      for (let index = 0; index < n; index += 1) {
        specs.push({
          index,
          label: `批量 ${index + 1}/${n}`,
          prompt: basePrompt,
          aspect: baseAspect,
          size: size || '',
          model,
          resolution,
          seed: hasSeed ? String(seedBase + index) : '',
          styleId: '',
          useSourceImage: Boolean(useSourceImage && sourceUrl),
          mode: 'same'
        });
      }
    }

    return {
      specs,
      tip: `将新建 ${specs.length} 个图片节点，原节点保持不变`,
      unsupported: false
    };
  }

  /**
   * Reference roles a new node inherits from the node it was made from. The caller re-wires the same
   * upstream ref edges, so keys (upstream node ids) still match. With wireSourceId the source node's own
   * output becomes the new 编辑原图 and any inherited 编辑原图 is demoted to a general reference.
   */
  function carriedReferences(sourceData = {}, wireSourceId = '') {
    const saved = Array.isArray(sourceData.references) ? sourceData.references : [];
    const references = saved
      .filter(item => item && item.key && !(wireSourceId && item.key === '__manual_ref__'))
      .map(item => ({
        key: String(item.key),
        sourceNodeId: String(item.sourceNodeId || ''),
        role: wireSourceId && item.role === 'source' ? 'reference' : String(item.role || 'reference'),
        strength: String(item.strength || 'medium')
      }));
    if (wireSourceId) references.unshift({key: wireSourceId, sourceNodeId: wireSourceId, role: 'source', strength: 'medium'});
    const seed = {
      references: references.map((item, order) => Object.assign(item, {order})),
      refOrder: references.map(item => item.key),
      refUrl: '',
      manualRefUrl: '',
      manualRefMime: '',
      manualRefSizeBytes: 0,
      manualRefName: ''
    };
    // An uploaded (manual) reference only applies while the node has no wired refs, so it is carried only then.
    if (!wireSourceId && sourceData.manualRefUrl && references.some(item => item.key === '__manual_ref__')) {
      Object.assign(seed, {
        manualRefUrl: String(sourceData.manualRefUrl),
        manualRefMime: String(sourceData.manualRefMime || ''),
        manualRefSizeBytes: Math.max(0, Number(sourceData.manualRefSizeBytes) || 0),
        manualRefName: String(sourceData.manualRefName || '')
      });
    }
    return seed;
  }

  function buildResultNodeSeed(sourceData = {}, spec = {}, carried = carriedReferences()) {
    const baseTitle = String(sourceData.title || sourceData.name || '').trim();
    const label = String(spec.label || '批量');
    return {
      title: baseTitle ? `${baseTitle} · ${label}` : label,
      prompt: String(spec.prompt != null ? spec.prompt : sourceData.prompt || ''),
      model: String(spec.model || sourceData.model || ''),
      aspect: String(spec.aspect || sourceData.aspect || '16:9'),
      size: String(spec.size || (spec.aspect && spec.aspect !== sourceData.aspect ? '' : sourceData.size || '')),
      resolution: String(spec.resolution || sourceData.resolution || '1K'),
      seed: String(spec.seed || ''),
      count: '1',
      quality: sourceData.quality || 'auto',
      url: '',
      urls: [],
      ...carried,
      variants: [],
      selectedVariantId: '',
      status: '',
      statusType: '',
      batchResult: {
        mode: spec.mode || 'same',
        label,
        styleId: spec.styleId || '',
        sourceTitle: baseTitle,
        batchId: String(spec.batchId || ''),
        index: Number(spec.index) || 0
      }
    };
  }

  function resultRowPlacement(source = {}, size = {}, index = 0, count = 1) {
    const width = Math.max(120, Math.round(Number(size && size.width) || 280));
    const height = Math.max(120, Math.round(Number(size && size.height) || 320));
    const startX = Math.round(Number(source.x) || 0) + width + OFFSET_X;
    const startY = Math.round(Number(source.y) || 0);
    // Prefer a single horizontal row; wrap to a second row only past 4 (should not happen).
    const col = index % Math.max(1, Math.min(count, MAX_COUNT));
    const row = Math.floor(index / Math.max(1, Math.min(count, MAX_COUNT)));
    return {
      x: startX + col * (width + GAP_X),
      y: startY + row * (height + GAP_X),
      gap: GAP_X
    };
  }

  /**
   * First free slot to the right of the source: start one column right, then step down
   * (and finally further right) until the box overlaps no occupied rect.
   * @param {{x:number,y:number}} source
   * @param {{width:number,height:number}} size
   * @param {Array<{x:number,y:number,width:number,height:number}>} occupied
   */
  function freeSlotRight(source = {}, size = {}, occupied = []) {
    const width = Math.max(120, Math.round(Number(size && size.width) || 280));
    const height = Math.max(120, Math.round(Number(size && size.height) || 320));
    const base = resultRowPlacement(source, {width, height}, 0, 1);
    const hits = (x, y) => (occupied || []).some(r => r && x < r.x + r.width + GAP_X && x + width + GAP_X > r.x && y < r.y + r.height + GAP_X && y + height + GAP_X > r.y);
    for (let col = 0; col < 8; col++) {
      for (let row = 0; row < 8; row++) {
        const x = base.x + col * (width + GAP_X);
        const y = base.y + row * (height + GAP_X);
        if (!hits(x, y)) return {x, y, gap: GAP_X};
      }
    }
    return {x: base.x + 8 * (width + GAP_X), y: base.y, gap: GAP_X};
  }

  /** Seed for「重新生成」: same prompt, settings and references on a fresh node; the source stays as is. */
  function buildRegenerateSeed(sourceData = {}, carried = carriedReferences()) {
    const baseTitle = String(sourceData.title || sourceData.name || '').trim();
    return {
      title: baseTitle ? `${baseTitle} · 重新生成` : '重新生成',
      prompt: String(sourceData.prompt || ''),
      model: String(sourceData.model || ''),
      aspect: String(sourceData.aspect || '16:9'),
      size: String(sourceData.size || ''),
      resolution: String(sourceData.resolution || '1K'),
      seed: '',
      count: String(sourceData.count || '1'),
      quality: sourceData.quality || 'auto',
      url: '',
      urls: [],
      ...carried,
      variants: [],
      selectedVariantId: '',
      status: '',
      statusType: '',
      ...(sourceData.camera3d ? { camera3d: JSON.parse(JSON.stringify(sourceData.camera3d)) } : {})
    };
  }

  // Result-only fields: a fresh copy starts without them so it can produce its own output.
  const OUTPUT_FIELDS = ['url', 'urls', 'variants', 'selectedVariantId', 'status', 'statusType', 'statusSafety', 'videoTask', 'outputMetadata', 'generatedAt', 'provenanceRecords', 'approval', 'sourceUrl', 'lastOperation', 'transformations', 'mediaVersions', 'outputModel', 'error', 'promptId', 'batchResult', 'batchPick', 'assistantOperationLog', 'queuePrepared', 'locked'];

  /** Same settings as the source (any node type), no result yet, title marked with `suffix`. */
  function freshCopySeed(sourceData = {}, suffix = '重新生成') {
    const seed = JSON.parse(JSON.stringify(sourceData || {}));
    for (const key of OUTPUT_FIELDS) delete seed[key];
    const baseTitle = String(sourceData.title || sourceData.name || '').trim();
    seed.title = baseTitle ? `${baseTitle} · ${suffix}` : suffix;
    return seed;
  }

  function snapshotSourceIdentity(data = {}) {
    return {
      url: data.url || '',
      urls: Array.isArray(data.urls) ? data.urls.slice() : [],
      selectedVariantId: data.selectedVariantId || '',
      variantIds: Array.isArray(data.variants) ? data.variants.map(item => item && item.id).filter(Boolean) : [],
      prompt: data.prompt || '',
      model: data.model || '',
      size: data.size || '',
      aspect: data.aspect || '',
      resolution: data.resolution || '',
      count: data.count || '1',
      status: data.status || '',
      statusType: data.statusType || ''
    };
  }

  function identitiesMatch(before = {}, after = {}) {
    return JSON.stringify(before) === JSON.stringify(after);
  }

  /** Mark a batch result as the working pick; siblings stay. */
  function markPicked(data = {}, batchId = '') {
    data.batchPick = {
      picked: true,
      batchId: String(batchId || data.batchResult?.batchId || ''),
      at: Date.now()
    };
    const tags = Array.isArray(data.tags) ? data.tags.slice() : [];
    if (!tags.includes('已选用')) tags.push('已选用');
    data.tags = tags;
    return data;
  }

  function clearPick(data = {}) {
    if (data.batchPick) delete data.batchPick;
    if (Array.isArray(data.tags)) data.tags = data.tags.filter(tag => tag !== '已选用');
    return data;
  }

  /** Seed for「选用」 from an on-node variant grid (urls[]) — spawn one working node. */
  function buildPickSpawnSeed(sourceData = {}, url = '', carried = carriedReferences()) {
    const picked = String(url || sourceData.url || '');
    const baseTitle = String(sourceData.title || sourceData.name || '').trim();
    return {
      title: baseTitle ? `${baseTitle} · 选用` : '选用继续',
      prompt: String(sourceData.prompt || ''),
      model: String(sourceData.model || ''),
      aspect: String(sourceData.aspect || '16:9'),
      size: String(sourceData.size || ''),
      resolution: String(sourceData.resolution || '1K'),
      count: '1',
      quality: sourceData.quality || 'auto',
      url: picked,
      urls: picked ? [picked] : [],
      ...carried,
      variants: [],
      selectedVariantId: '',
      status: '',
      statusType: '',
      batchPick: { picked: true, fromVariantGrid: true, at: Date.now() },
      tags: ['已选用']
    };
  }

  function estimateSpendUnits(count) {
    return clampCount(count);
  }

  function supportTip({ hasProvider = true, canGenerate = true, hasKey = true, nodeType = 'image' } = {}) {
    if (nodeType !== 'image') return { supported: false, tip: '当前仅支持图片节点批量' };
    if (!hasProvider) return { supported: false, tip: '请先在设置里配置图片供应商' };
    if (!hasKey) return { supported: false, reason: 'no-key', tip: '当前模型没有可用的 API Key，请先在「设置」里填写并保存后再批量生成' };
    if (!canGenerate) return { supported: false, tip: '当前模型不支持批量生成' };
    return { supported: true, tip: '' };
  }

  /**
   * One combined toast for a whole batch. Failed-empty nodes are removed by the caller.
   * @param {{total:number, done:number, failed:number, reason?:string}} r
   */
  function batchSummaryToast({ total = 0, done = 0, failed = 0, reason = '' } = {}) {
    const why = String(reason || '').split(/\n/)[0].trim().slice(0, 60);
    if (failed && !done) {
      return { level: 'error', text: `批量失败 ${failed}/${total}` + (why ? `：${why}` : '') + '（失败节点已移除）' };
    }
    if (failed) {
      return { level: 'warn', text: `批量完成 ${done}/${total}，失败 ${failed} 张已移除` + (why ? `（${why}）` : '') };
    }
    return { level: 'success', text: `批量完成：${done} 张` };
  }

  /** Number of nodes a batch will create: same=count, style/aspect=one per selected chip (max 4). */
  function plannedCount({ mode = 'same', count = DEFAULT_COUNT, styles = [], aspects = [] } = {}) {
    const kind = normalizeMode(mode);
    if (kind === 'style') return uniqueIds(styles, new Set(STYLE_PRESETS.map(i => i.id))).slice(0, MAX_COUNT).length;
    if (kind === 'aspect') return uniqueIds(aspects, new Set(ASPECT_PRESETS.map(i => i.id))).slice(0, MAX_COUNT).length;
    return clampCount(count);
  }

  return {
    MAX_COUNT,
    DEFAULT_COUNT,
    STYLE_PRESETS,
    ASPECT_PRESETS,
    MODES,
    clampCount,
    normalizeMode,
    styleById,
    aspectById,
    applyStyleSuffix,
    buildSpecs,
    batchSummaryToast,
    plannedCount,
    carriedReferences,
    buildResultNodeSeed,
    resultRowPlacement,
    freeSlotRight,
    buildRegenerateSeed,
    freshCopySeed,
    snapshotSourceIdentity,
    identitiesMatch,
    markPicked,
    clearPick,
    buildPickSpawnSeed,
    estimateSpendUnits,
    supportTip
  };
});
