(() => {
  'use strict';

  const TOOLS = Object.freeze(['inpaint', 'outpaint', 'cutout', 'upscale']);
  const TOOL_LABELS = Object.freeze({
    inpaint: '选区重绘',
    outpaint: '扩图',
    cutout: '抠图去背景',
    upscale: '放大变清晰'
  });
  const DEFAULT_MAX_SIDE = 4096;
  const DEFAULT_UPSCALE_MAX = 7680;

  function clampInt(value, min, max, fallback = 0) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function normalizePads(input = {}) {
    const top = clampInt(input.top, 0, 4096, 0);
    const right = clampInt(input.right, 0, 4096, 0);
    const bottom = clampInt(input.bottom, 0, 4096, 0);
    const left = clampInt(input.left, 0, 4096, 0);
    return { top, right, bottom, left };
  }

  function outpaintGeometry({ width, height, pads, maxSide = DEFAULT_MAX_SIDE } = {}) {
    const w = Math.max(1, Math.round(Number(width) || 1));
    const h = Math.max(1, Math.round(Number(height) || 1));
    const p = normalizePads(pads);
    let nextW = w + p.left + p.right;
    let nextH = h + p.top + p.bottom;
    const limit = Math.max(256, Math.round(Number(maxSide) || DEFAULT_MAX_SIDE));
    if (nextW > limit || nextH > limit) {
      const scale = Math.min(limit / nextW, limit / nextH);
      nextW = Math.max(1, Math.round(nextW * scale));
      nextH = Math.max(1, Math.round(nextH * scale));
      const ox = Math.round(p.left * scale);
      const oy = Math.round(p.top * scale);
      const ow = Math.max(1, Math.round(w * scale));
      const oh = Math.max(1, Math.round(h * scale));
      return {
        width: nextW,
        height: nextH,
        offsetX: ox,
        offsetY: oy,
        originalWidth: ow,
        originalHeight: oh,
        pads: {
          top: oy,
          left: ox,
          right: Math.max(0, nextW - ox - ow),
          bottom: Math.max(0, nextH - oy - oh)
        },
        scaled: true,
        scale
      };
    }
    return {
      width: nextW,
      height: nextH,
      offsetX: p.left,
      offsetY: p.top,
      originalWidth: w,
      originalHeight: h,
      pads: p,
      scaled: false,
      scale: 1
    };
  }

  function upscaleTargets(size = {}, { maxSide = DEFAULT_UPSCALE_MAX } = {}) {
    const w = Math.max(1, Math.round(Number(size.width) || 1));
    const h = Math.max(1, Math.round(Number(size.height) || 1));
    const limit = Math.max(256, Math.round(Number(maxSide) || DEFAULT_UPSCALE_MAX));
    const factors = [2, 4];
    return factors.map(factor => {
      const width = w * factor;
      const height = h * factor;
      const ok = width <= limit && height <= limit;
      return { factor, width, height, supported: ok, reason: ok ? '' : `超过上限 ${limit}px` };
    });
  }

  function historyStep(entries = [], index = 0, delta = 0) {
    const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
    if (!list.length) return { index: 0, total: 0, entry: null, changed: false };
    const cur = clampInt(index, 0, list.length - 1, list.length - 1);
    const next = clampInt(cur + Number(delta || 0), 0, list.length - 1, cur);
    return {
      index: next,
      total: list.length,
      entry: list[next] || null,
      changed: next !== cur
    };
  }

  function operationsIncludeEdit(operations) {
    return Array.isArray(operations) && operations.includes('edit');
  }

  function toolSupport({ tool, operations, providerType, hasLocalMedia = true, hasMask = false } = {}) {
    const id = String(tool || '');
    const canEdit = operationsIncludeEdit(operations);
    const type = String(providerType || '');
    const chatLike = type === 'chat-image' || type === 'openai-compatible';
    if (id === 'inpaint') {
      if (!canEdit) {
        return { supported: false, mode: 'none', tip: '当前模型不支持', detail: '选区重绘需要支持图编辑（/images/edits）的图片模型。' };
      }
      if (hasMask && chatLike && type !== 'openai-images' && type !== 'custom-sync') {
        return { supported: false, mode: 'none', tip: '当前模型不支持', detail: '当前线路走对话出图，无法提交遮罩。请换用 OpenAI Images 或带编辑接口的供应商。' };
      }
      return { supported: true, mode: 'api-edit', tip: '', detail: '' };
    }
    if (id === 'outpaint') {
      if (!canEdit) {
        return { supported: false, mode: 'none', tip: '当前模型不支持', detail: '扩图需要支持图编辑的图片模型。' };
      }
      return { supported: true, mode: 'api-edit', tip: '', detail: '' };
    }
    if (id === 'cutout') {
      if (hasLocalMedia) return { supported: true, mode: 'local', tip: '', detail: '本地抠图，不消耗额度。' };
      if (canEdit) return { supported: true, mode: 'api-edit', tip: '', detail: '将调用当前图片模型去背景。' };
      return { supported: false, mode: 'none', tip: '当前模型不支持', detail: '本地媒体桥接不可用，且当前模型不支持图编辑。' };
    }
    if (id === 'upscale') {
      if (hasLocalMedia) return { supported: true, mode: 'local', tip: '', detail: '本地放大，不消耗额度。' };
      if (canEdit) return { supported: true, mode: 'api-edit', tip: '', detail: '将调用当前图片模型增强放大。' };
      return { supported: false, mode: 'none', tip: '当前模型不支持', detail: '本地媒体桥接不可用，且当前模型不支持图编辑。' };
    }
    return { supported: false, mode: 'none', tip: '未知工具', detail: '' };
  }

  function maskCoverageRatio({ painted = 0, total = 0 } = {}) {
    const t = Math.max(0, Number(total) || 0);
    const p = Math.max(0, Number(painted) || 0);
    if (!t) return 0;
    return Math.min(1, p / t);
  }

  function maskHasPaint(coverage, { minRatio = 0.0005 } = {}) {
    return Number(coverage) >= Number(minRatio);
  }

  /** OpenAI edits mask: transparent pixels = region to edit. */
  function paintMaskToOpenAIAlpha(source, { width, height, paintedIsEdit = true } = {}) {
    const w = Math.max(1, Math.round(Number(width) || 1));
    const h = Math.max(1, Math.round(Number(height) || 1));
    const out = new Uint8ClampedArray(w * h * 4);
    const src = source instanceof Uint8ClampedArray || ArrayBuffer.isView(source)
      ? source
      : null;
    for (let i = 0; i < w * h; i += 1) {
      const o = i * 4;
      let painted = false;
      if (src && src.length >= o + 4) {
        // Treat non-zero alpha (or bright red channel from brush overlay) as painted.
        painted = src[o + 3] > 16 || src[o] > 40;
      }
      const edit = paintedIsEdit ? painted : !painted;
      if (edit) {
        out[o] = 0;
        out[o + 1] = 0;
        out[o + 2] = 0;
        out[o + 3] = 0; // transparent → edit
      } else {
        out[o] = 255;
        out[o + 1] = 255;
        out[o + 2] = 255;
        out[o + 3] = 255; // opaque → keep
      }
    }
    return { width: w, height: h, data: out };
  }

  function sizeLabel(width, height) {
    return `${Math.round(Number(width) || 0)}×${Math.round(Number(height) || 0)}`;
  }

  function buildEditPayloadMeta({ tool, prompt, geometry, factor, mode } = {}) {
    return {
      tool: String(tool || ''),
      label: TOOL_LABELS[tool] || String(tool || ''),
      prompt: String(prompt || '').trim(),
      mode: String(mode || ''),
      geometry: geometry || null,
      factor: factor || null,
      sizeLabel: geometry ? sizeLabel(geometry.width, geometry.height) : ''
    };
  }

  /** Prefill for a NEW image node that receives a local-edit result (never mutates the source). */
  function buildResultNodeSeed(sourceData = {}, meta = {}) {
    const tool = String(meta.tool || '');
    const label = String(meta.label || TOOL_LABELS[tool] || '局部编辑');
    const baseTitle = String(sourceData.title || sourceData.name || '').trim();
    const prompt = meta.prompt != null ? String(meta.prompt) : String(sourceData.prompt || '');
    const size = meta.size || sourceData.size || '1024x576';
    const hasExplicitSize = Boolean(meta.size);
    return {
      title: baseTitle ? (baseTitle + ' · ' + label) : label,
      prompt: prompt.trim(),
      model: sourceData.model || '',
      // Explicit edit output size must not be rewritten by aspect→resolution mapping.
      aspect: hasExplicitSize ? 'custom' : (sourceData.aspect || '16:9'),
      size,
      resolution: sourceData.resolution || '1K',
      count: '1',
      url: '',
      urls: [],
      refUrl: '',
      manualRefUrl: '',
      refOrder: [],
      references: [],
      variants: [],
      selectedVariantId: '',
      status: '',
      statusType: '',
      localEdit: {
        tool,
        label,
        sourceTitle: baseTitle
      }
    };
  }

  function resultNodePlacement(source = {}, size = {}) {
    const width = Math.max(120, Math.round(Number(size && size.width) || 280));
    return {
      x: Math.round(Number(source.x) || 0) + width + 80,
      y: Math.round(Number(source.y) || 0),
      gap: 80
    };
  }

  /** Fields that must stay identical on the source node after a local edit. */
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
      status: data.status || '',
      statusType: data.statusType || ''
    };
  }

  const api = {
    TOOLS,
    TOOL_LABELS,
    DEFAULT_MAX_SIDE,
    DEFAULT_UPSCALE_MAX,
    clampInt,
    normalizePads,
    outpaintGeometry,
    upscaleTargets,
    historyStep,
    toolSupport,
    maskCoverageRatio,
    maskHasPaint,
    paintMaskToOpenAIAlpha,
    sizeLabel,
    buildEditPayloadMeta,
    buildResultNodeSeed,
    resultNodePlacement,
    snapshotSourceIdentity,
    operationsIncludeEdit
  };

  if (typeof window !== 'undefined') window.FutureAILocalEditCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
