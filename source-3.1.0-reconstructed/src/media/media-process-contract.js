(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FutureAIMediaProcessContract = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const OPERATIONS = Object.freeze([
    {id: 'extract-first-frame', label: '提取首帧', kind: 'image', fields: ['format']},
    {id: 'extract-last-frame', label: '提取尾帧', kind: 'image', fields: ['format']},
    {id: 'extract-frame', label: '提取指定时间帧', kind: 'image', fields: ['time', 'format']},
    {id: 'image-resize', label: '图片缩放', kind: 'image', fields: ['width', 'height', 'format']},
    {id: 'image-format', label: '图片转换格式', kind: 'image', fields: ['format']},
    {id: 'image-canvas', label: '改变画布比例 / 本地背景延展', kind: 'image', fields: ['width', 'height', 'background', 'format']},
    {id: 'video-trim', label: '视频裁剪', kind: 'video', fields: ['start', 'duration']},
    {id: 'video-concat', label: '视频拼接', kind: 'video', sources: 2, fields: []},
    {id: 'video-speed', label: '视频调速', kind: 'video', fields: ['speed']},
    {id: 'video-loop', label: '视频循环', kind: 'video', fields: ['loops', 'duration']},
    {id: 'audio-extract', label: '分离音轨', kind: 'audio', fields: []},
    {id: 'audio-volume', label: '音量调整', kind: 'audio', fields: ['volume']},
    {id: 'audio-mix', label: '音频混音', kind: 'audio', sources: 2, fields: []},
    {id: 'video-mute', label: '视频静音', kind: 'video', fields: []},
    {id: 'audio-align', label: '音频时长对齐', kind: 'audio', fields: ['duration']},
    {id: 'subtitle-burn', label: '字幕烧录', kind: 'video', fields: ['subtitleText']},
    {id: 'subtitle-convert', label: '字幕格式转换', kind: 'subtitle', fields: ['format', 'subtitleText']},
    {id: 'subtitle-shift', label: '字幕时间校正', kind: 'subtitle', fields: ['shiftSeconds', 'format', 'subtitleText']}
  ]);

  function operation(id) {
    return OPERATIONS.find(item => item.id === id) || OPERATIONS[0];
  }

  function number(value, min, max, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
  }

  function normalize(payload = {}) {
    const definition = operation(String(payload.operation || ''));
    const width = Math.round(number(payload.width, 64, 7680, 1280));
    const height = Math.round(number(payload.height, 64, 7680, 720));
    return {
      operation: definition.id,
      kind: definition.kind,
      sourceUrl: String(payload.sourceUrl || ''),
      secondSourceUrl: String(payload.secondSourceUrl || ''),
      storageDir: String(payload.storageDir || ''),
      width,
      height,
      start: number(payload.start, 0, 86400, 0),
      duration: number(payload.duration, .05, 86400, 5),
      time: number(payload.time, 0, 86400, 0),
      speed: number(payload.speed, .5, 2, 1),
      loops: Math.round(number(payload.loops, 1, 100, 2)),
      volume: number(payload.volume, 0, 4, 1),
      shiftSeconds: number(payload.shiftSeconds, -86400, 86400, 0),
      format: ['png', 'jpg', 'webp', 'mp4', 'm4a', 'srt', 'vtt'].includes(String(payload.format || '').toLowerCase()) ? String(payload.format).toLowerCase() : 'png',
      background: /^#[0-9a-f]{6}$/i.test(String(payload.background || '')) ? String(payload.background) : '#000000',
      subtitleText: String(payload.subtitleText || '').slice(0, 2_000_000)
    };
  }

  // Formats each operation can actually write (see mediaProcessExtension in main.js).
  function formatOptions(id) {
    const definition = operation(id);
    if (!definition.fields.includes('format')) return [];
    return definition.kind === 'subtitle' ? ['srt', 'vtt'] : ['png', 'jpg', 'webp'];
  }

  function requiresSecondSource(id) {
    return Number(operation(id).sources || 1) > 1;
  }

  return {OPERATIONS, operation, normalize, formatOptions, requiresSecondSource};
});
