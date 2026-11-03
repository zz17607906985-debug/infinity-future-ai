(() => {
  'use strict';

  const ASPECT_PRESETS = Object.freeze([
    {value: '1:1', label: '1:1 方形', ratio: 1},
    {value: '3:2', label: '3:2 横向', ratio: 3 / 2},
    {value: '2:3', label: '2:3 竖向', ratio: 2 / 3},
    {value: '4:3', label: '4:3 横向', ratio: 4 / 3},
    {value: '3:4', label: '3:4 竖向', ratio: 3 / 4},
    {value: '16:9', label: '16:9 常用横屏', ratio: 16 / 9},
    {value: '9:16', label: '9:16 常用竖屏', ratio: 9 / 16},
    {value: '21:9', label: '21:9 电影宽屏', ratio: 21 / 9},
    {value: '9:21', label: '9:21 长竖屏', ratio: 9 / 21},
    {value: '6:19', label: '6:19 极长竖屏', ratio: 6 / 19},
    {value: '19:6', label: '19:6 超宽横幅', ratio: 19 / 6}
  ]);

  const IMAGE_SIZE_TABLE = Object.freeze({
    '1K': Object.freeze({'1:1': '1024x1024', '2:3': '1024x1536', '3:2': '1536x1024', '4:3': '1024x768', '3:4': '768x1024', '16:9': '1024x576', '9:16': '576x1024', '21:9': '1344x576', '9:21': '576x1344', '6:19': '600x1900', '19:6': '1900x600'}),
    '2K': Object.freeze({'1:1': '2048x2048', '2:3': '1360x2040', '3:2': '2040x1360', '4:3': '2048x1536', '3:4': '1536x2048', '16:9': '2048x1152', '9:16': '1152x2048', '21:9': '2688x1152', '9:21': '1152x2688', '6:19': '648x2052', '19:6': '2052x648'}),
    '4K': Object.freeze({'1:1': '4096x4096', '2:3': '2720x4080', '3:2': '4080x2720', '4:3': '3072x2304', '3:4': '2304x3072', '16:9': '4096x2304', '9:16': '2304x4096', '21:9': '3584x1536', '9:21': '1536x3584', '6:19': '1290x4085', '19:6': '4085x1290'})
  });

  const VIDEO_PRESETS = Object.freeze([
    {value: '1280x720', label: '1280 x 720 · 16:9 标准横屏', openAi: true},
    {value: '720x1280', label: '720 x 1280 · 9:16 标准竖屏', openAi: true},
    {value: '1792x1024', label: '1792 x 1024 · 高清横屏', openAi: true},
    {value: '1024x1792', label: '1024 x 1792 · 高清竖屏', openAi: true},
    {value: '1024x1024', label: '1024 x 1024 · 1:1 方形（兼容模式）', openAi: false}
  ]);

  function parseSize(value) {
    const match = String(value || '').trim().match(/^(\d+)\s*[x×]\s*(\d+)$/i);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return {width, height, size: `${width}x${height}`, ratio: width / height};
  }

  function normalizeAspect(value, fallback = '16:9') {
    const direct = String(value || '').trim().replace('：', ':');
    if (ASPECT_PRESETS.some(item => item.value === direct)) return direct;
    const parsed = parseSize(direct);
    if (!parsed) return fallback;
    let best = ASPECT_PRESETS[0];
    let bestDistance = Infinity;
    for (const preset of ASPECT_PRESETS) {
      const distance = Math.abs(Math.log(parsed.ratio / preset.ratio));
      if (distance < bestDistance) {
        best = preset;
        bestDistance = distance;
      }
    }
    return best.value;
  }

  function aspectRatio(value, fallback = 1) {
    const preset = ASPECT_PRESETS.find(item => item.value === normalizeAspect(value, ''));
    if (preset) return preset.ratio;
    const parsed = parseSize(value);
    return parsed?.ratio || fallback;
  }

  function greatestCommonDivisor(a, b) {
    let left = Math.abs(Math.round(a));
    let right = Math.abs(Math.round(b));
    while (right) [left, right] = [right, left % right];
    return left || 1;
  }

  function sizeAspectLabel(value) {
    const parsed = parseSize(value);
    if (!parsed) return '';
    const normalized = normalizeAspect(parsed.size, '');
    const preset = ASPECT_PRESETS.find(item => item.value === normalized);
    if (preset && Math.abs((parsed.ratio / preset.ratio) - 1) <= .005) return preset.value;
    const divisor = greatestCommonDivisor(parsed.width, parsed.height);
    return `${parsed.width / divisor}:${parsed.height / divisor}`;
  }

  function normalizeResolution(value) {
    const resolution = String(value || '').toUpperCase();
    return Object.prototype.hasOwnProperty.call(IMAGE_SIZE_TABLE, resolution) ? resolution : '1K';
  }

  function imageSizeForResolution(aspectOrSize, resolution = '1K') {
    const aspect = normalizeAspect(aspectOrSize, '1:1');
    return IMAGE_SIZE_TABLE[normalizeResolution(resolution)][aspect] || IMAGE_SIZE_TABLE['1K']['1:1'];
  }

  function customImageTargetSize(data = {}) {
    const selection = String(data.aspect || data.size || '');
    if (selection !== 'custom') return '';
    const width = Math.round(Number(data.customWidth));
    const height = Math.round(Number(data.customHeight));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 64 || height < 64 || width > 16384 || height > 16384) return '';
    return `${width}x${height}`;
  }

  function imageTargetSize(data = {}) {
    const custom = customImageTargetSize(data);
    if (custom) return custom;
    const selection = String(data.aspect || data.size || '');
    if (selection === 'custom') return '';
    return imageSizeForResolution(selection || '1:1', data.resolution || '1K');
  }

  function customVideoTargetSize(data = {}) {
    if (String(data?.size || '') !== 'custom') return '';
    const width = Math.round(Number(data.customWidth));
    const height = Math.round(Number(data.customHeight));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 64 || height < 64 || width > 16384 || height > 16384) return '';
    return `${width}x${height}`;
  }

  function videoTargetSize(value) {
    const data = typeof value === 'object' ? value : {size: value};
    if (String(data?.size || '') === 'custom') return customVideoTargetSize(data);
    const input = data?.size;
    const parsed = parseSize(input);
    if (!parsed) return '1280x720';
    const exact = VIDEO_PRESETS.find(item => item.value === parsed.size);
    if (exact) return exact.value;
    if (parsed.width <= 16384 && parsed.height <= 16384) return parsed.size;
    const aspect = normalizeAspect(parsed.size, '16:9');
    if (aspect === '9:16') return '720x1280';
    if (aspect === '1:1') return '1024x1024';
    return '1280x720';
  }

  function openAiVideoSize(value) {
    const size = videoTargetSize(value);
    return VIDEO_PRESETS.some(item => item.value === size && item.openAi) ? size : '';
  }

  function mediaAspectRatio(data = {}, type = 'image') {
    const size = type === 'image' ? imageTargetSize(data) : videoTargetSize(data);
    return Math.min(20, Math.max(.05, parseSize(size)?.ratio || 1));
  }

  window.FutureAIMediaDimensions = {
    ASPECT_PRESETS,
    IMAGE_SIZE_TABLE,
    VIDEO_PRESETS,
    parseSize,
    normalizeAspect,
    aspectRatio,
    sizeAspectLabel,
    normalizeResolution,
    imageSizeForResolution,
    customImageTargetSize,
    imageTargetSize,
    customVideoTargetSize,
    videoTargetSize,
    openAiVideoSize,
    mediaAspectRatio
  };
})();
