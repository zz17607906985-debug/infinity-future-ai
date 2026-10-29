(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FutureAIAssetSmartIndex = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const COLLECTIONS = Object.freeze([
    {id: 'all', label: '全部智能集合'},
    {id: 'character', label: '角色'},
    {id: 'scene', label: '场景'},
    {id: 'object', label: '道具'},
    {id: 'style', label: '画风'},
    {id: 'shot', label: '镜头 / 构图'},
    {id: 'unused', label: '未使用'},
    {id: 'indexed', label: '已建立视觉索引'}
  ]);

  function semanticCollections(asset = {}) {
    const text = [asset.name, asset.prompt, ...(asset.tags || [])].join(' ').toLowerCase();
    const output = [];
    if (/角色|人物|人像|主角|character|portrait|face/.test(text)) output.push('character');
    if (/场景|室内|室外|城市|森林|房间|scene|environment|location/.test(text)) output.push('scene');
    if (/道具|物体|产品|武器|车辆|object|prop|product/.test(text)) output.push('object');
    if (/画风|风格|色彩|光影|材质|style|lighting|palette/.test(text)) output.push('style');
    if (/镜头|构图|景别|分镜|shot|composition|camera/.test(text)) output.push('shot');
    return [...new Set(output)];
  }

  function featureDistance(a, b) {
    if (!isValidFeature(a) || !isValidFeature(b)) return Infinity;
    const color = Math.sqrt(['r', 'g', 'b'].reduce((sum, key) => sum + Math.pow(Number(a[key] || 0) - Number(b[key] || 0), 2), 0)) / 441.7;
    const hashA = String(a.hash || '');
    const hashB = String(b.hash || '');
    if (!hashA || hashA.length !== hashB.length) return color;
    let different = 0;
    for (let index = 0; index < hashA.length; index += 1) if (hashA[index] !== hashB[index]) different += 1;
    return color * .45 + different / hashA.length * .55;
  }

  function isValidFeature(feature) {
    if (!feature || typeof feature !== 'object') return false;
    const hash = String(feature.hash || '');
    return /^[01]{64}$/.test(hash)
      && ['r', 'g', 'b'].every(key => Number.isFinite(Number(feature[key])) && Number(feature[key]) >= 0 && Number(feature[key]) <= 255);
  }

  function queryIntent(query = '') {
    const text = String(query || '').trim().toLowerCase();
    if (!text) return {collection: 'all', terms: [], similar: false};
    let collection = 'all';
    if (/未使用|没使用|没有使用|unused/.test(text)) collection = 'unused';
    else if (/角色|人物|主角|character|portrait|face/.test(text)) collection = 'character';
    else if (/同一场景|场景|地点|scene|location/.test(text)) collection = 'scene';
    else if (/相似构图|构图|镜头|景别|composition|shot|camera/.test(text)) collection = 'shot';
    else if (/道具|物体|object|prop/.test(text)) collection = 'object';
    else if (/画风|风格|style/.test(text)) collection = 'style';
    const similar = /相似|类似|同一|same|similar/.test(text);
    const terms = text.replace(/找|查找|搜索|这个|同一|相似|类似|没有使用的?|未使用|素材|角色|人物|主角|场景|地点|构图|镜头|景别|道具|物体|画风|风格|find|search|same|similar|unused|character|portrait|face|scene|location|composition|shot|camera|object|prop|style/g, ' ')
      .split(/[\s,，。；;]+/).map(value => value.trim()).filter(Boolean);
    return {collection, terms: [...new Set(terms)], similar};
  }

  function matchesQuery(asset = {}, query = '', usageCount = 0, sourceFeature = null, threshold = .42) {
    const intent = queryIntent(query);
    if (!matchesCollection(asset, intent.collection, usageCount)) return false;
    if (intent.similar && sourceFeature && featureDistance(asset.visualFeature, sourceFeature) > threshold) return false;
    if (!intent.terms.length) return true;
    const haystack = [asset.name, asset.prompt, asset.model, ...(asset.tags || []), ...(asset.smartCollections || [])].join(' ').toLowerCase();
    return intent.terms.every(term => haystack.includes(term));
  }

  function repairIndex(assets = []) {
    let invalid = 0;
    const repaired = (Array.isArray(assets) ? assets : []).map(asset => {
      const next = {...asset, smartCollections: semanticCollections(asset)};
      if (next.visualFeature && !isValidFeature(next.visualFeature)) {
        next.visualFeature = null;
        next.visualIndexError = '视觉索引已损坏，等待重建';
        invalid += 1;
      }
      return next;
    });
    return {assets: repaired, invalid};
  }

  function matchesCollection(asset = {}, collection = 'all', usageCount = 0) {
    if (collection === 'all') return true;
    if (collection === 'unused') return Number(usageCount || 0) === 0;
    if (collection === 'indexed') return Boolean(asset.visualFeature?.hash);
    const collections = Array.isArray(asset.smartCollections) ? asset.smartCollections : semanticCollections(asset);
    return collections.includes(collection);
  }

  function imageFeatureFromPixels(data, width, height) {
    let r = 0, g = 0, b = 0, pixels = 0;
    const luminance = [];
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (data[index + 3] < 16) continue;
      r += data[index]; g += data[index + 1]; b += data[index + 2]; pixels += 1;
      luminance.push(data[index] * .299 + data[index + 1] * .587 + data[index + 2] * .114);
    }
    const average = luminance.reduce((sum, value) => sum + value, 0) / Math.max(1, luminance.length);
    return {version: 1, r: Math.round(r / Math.max(1, pixels)), g: Math.round(g / Math.max(1, pixels)), b: Math.round(b / Math.max(1, pixels)), hash: luminance.map(value => value >= average ? '1' : '0').join(''), width, height, indexedAt: Date.now()};
  }

  async function extractVisualFeature(url) {
    if (typeof document === 'undefined') return null;
    const image = new Image();
    image.decoding = 'async';
    image.src = String(url || '');
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('素材无法读取')); });
    const canvas = document.createElement('canvas');
    canvas.width = 8; canvas.height = 8;
    const context = canvas.getContext('2d', {willReadFrequently: true});
    context.drawImage(image, 0, 0, 8, 8);
    return imageFeatureFromPixels(context.getImageData(0, 0, 8, 8).data, 8, 8);
  }

  return {COLLECTIONS, semanticCollections, featureDistance, isValidFeature, queryIntent, matchesQuery, matchesCollection, repairIndex, imageFeatureFromPixels, extractVisualFeature};
});
