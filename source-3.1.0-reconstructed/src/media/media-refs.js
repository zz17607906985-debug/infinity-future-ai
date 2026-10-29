// Which strings inside a canvas node are media that must live in <storageDir>/media.
// Shared by the "未保存" background sweep and the 重新定位 action.
(function (root) {
  'use strict';
  // Fields that hold media: url/urls/refUrl/maskUrl/sourceImage…, references, variants, frames…
  const MEDIA_KEY = /(^|[a-z])(url|urls|image|images|frames?|references?|variants?|thumb|thumbnail|poster|mask)$/i;
  const NON_MEDIA_KEY = /(api|comfy|endpoint|base|server|host|source|origin|page|link|webhook)url$/i;
  const MEDIA_VALUE = /^(https?:\/\/|data:(image|video|audio)\/|blob:|file:)/i;

  function isMediaKey(key) {
    const name = String(key || '');
    return MEDIA_KEY.test(name) && !NON_MEDIA_KEY.test(name);
  }

  // Calls visit(value, path) for every media string under media-looking keys
  // (arrays/objects below such a key included) and replaces it with the result.
  async function mapNodeMediaRefs(data, visit, {depth = 6} = {}) {
    let changed = false;
    const walk = async (value, inMedia, keyPath, level) => {
      if (typeof value === 'string') {
        if (!inMedia || !MEDIA_VALUE.test(value)) return value;
        const next = await visit(value, keyPath);
        if (typeof next === 'string' && next !== value) { changed = true; return next; }
        return value;
      }
      if (level > depth || !value || typeof value !== 'object') return value;
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) value[i] = await walk(value[i], inMedia, keyPath.concat(i), level + 1);
        return value;
      }
      for (const key of Object.keys(value)) {
        const media = inMedia ? (key === 'url' || key === 'src' || isMediaKey(key)) : isMediaKey(key);
        value[key] = await walk(value[key], media, keyPath.concat(key), level + 1);
      }
      return value;
    };
    await walk(data, false, [], 0);
    return changed;
  }

  function collectNodeMediaRefs(data) {
    const out = [];
    const walk = (value, inMedia, level) => {
      if (typeof value === 'string') { if (inMedia && MEDIA_VALUE.test(value)) out.push(value); return; }
      if (level > 6 || !value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach(item => walk(item, inMedia, level + 1)); return; }
      for (const key of Object.keys(value)) walk(value[key], inMedia ? (key === 'url' || key === 'src' || isMediaKey(key)) : isMediaKey(key), level + 1);
    };
    walk(data, false, 0);
    return out;
  }

  // Replaces every occurrence of one media string with another (重新定位).
  function replaceNodeMediaRef(data, from, to) {
    let count = 0;
    const walk = value => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          if (value[i] === from) { value[i] = to; count++; } else walk(value[i]);
        }
        return;
      }
      for (const key of Object.keys(value)) {
        if (value[key] === from) { value[key] = to; count++; } else walk(value[key]);
      }
    };
    walk(data);
    return count;
  }

  // Retry schedule for media that could not be saved yet: 1 min, 5 min, 15 min, then every 30 min.
  function sweepDelayMs(attempt) {
    const steps = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000];
    return steps[Math.min(Math.max(0, attempt), steps.length)] || 30 * 60 * 1000;
  }

  const api = {isMediaKey, mapNodeMediaRefs, collectNodeMediaRefs, replaceNodeMediaRef, sweepDelayMs};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FutureAIMediaRefs = api;
})(typeof window !== 'undefined' ? window : globalThis);
