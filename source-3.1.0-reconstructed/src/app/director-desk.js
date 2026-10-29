(() => {
  'use strict';

  function normalizeDirectorDeskDestination(value) {
    return ['shot-pack', 'short', 'assistant', 'canvas'].includes(value) ? value : 'canvas';
  }

  function normalizeDirectorShotPack(value) {
    if (!value || typeof value !== 'object') return null;
    const characters = Array.isArray(value.characters) ? value.characters.map(item => ({
      name: String(item?.name || '').trim(),
      color: String(item?.color || '').trim(),
      colorName: String(item?.colorName || '').trim(),
      pose: String(item?.pose || '').trim()
    })).filter(item => item.name) : [];
    const camera = value.camera && typeof value.camera === 'object' ? {
      name: String(value.camera.name || '').trim(),
      fov: Number(value.camera.fov) || 0,
      distance: Number(value.camera.distance) || 0,
      shotSize: String(value.camera.shotSize || '').trim(),
      angle: String(value.camera.angle || '').trim(),
      lens: String(value.camera.lens || '').trim(),
      motionLabel: String(value.camera.motionLabel || '').trim(),
      motionNote: String(value.camera.motionNote || '').trim()
    } : null;
    const prompt = String(value.prompt || '').trim();
    const legend = String(value.legend || '').trim();
    const shotIndex = Number(value.shotIndex) || 0;
    const shotTotal = Number(value.shotTotal) || 0;
    const shotName = String(value.shotName || '').trim();
    if (!prompt && !characters.length && !camera) return null;
    return {version: 1, legend, characters, camera, prompt, shotIndex, shotTotal, shotName};
  }

  function directorShotPackPrompt(pack, fallback) {
    return String(pack?.prompt || '').trim() || fallback;
  }

  function directorShotPackTitle(pack, fallback, index) {
    const shotNo = Number(pack?.shotIndex) || (index + 1);
    const shot = pack?.camera?.shotSize;
    const motion = pack?.camera?.motionLabel;
    const name = pack?.shotName || pack?.camera?.name;
    const parts = [`镜头${String(shotNo).padStart(2, '0')}`, name, shot, motion].filter(Boolean);
    if (parts.length > 1) return [...new Set(parts)].join(' · ');
    return fallback || `导演台镜头包 ${index + 1}`;
  }

  function directorShotPackVideoPrompt(pack, imagePrompt) {
    const shot = pack?.camera?.shotSize || '中景';
    const angle = pack?.camera?.angle || '平视';
    const motion = pack?.camera?.motionLabel || '固定机位';
    const legend = pack?.legend || '';
    return [
      `以这张3D预演关键帧为第一帧生成视频。`,
      legend ? `角色色标：${legend}。` : '',
      `保持${shot}、${angle}，运镜：${motion}。`,
      `不要换人、不要改变站位和服装身份；按色标对应角色连续表演。`,
      imagePrompt ? `画面依据：${imagePrompt.split('\n').slice(0, 4).join(' ')}` : ''
    ].filter(Boolean).join('');
  }

  function normalizeDirectorDeskCaptures(payload) {
    const sharedPack = normalizeDirectorShotPack(payload?.shotPack);
    return (Array.isArray(payload?.captures) ? payload.captures : [])
      .map((item, index) => ({
        dataUrl: typeof item?.dataUrl === 'string' ? item.dataUrl.trim() : '',
        fileName: typeof item?.fileName === 'string' && item.fileName.trim()
          ? item.fileName.trim()
          : `director-desk-capture-${index + 1}.png`,
        shotPack: normalizeDirectorShotPack(item?.shotPack) || sharedPack
      }))
      .filter(item => item.dataUrl);
  }

  function directorDeskCaptureBaseName(fileName, index) {
    const raw = String(fileName || '').replace(/\.[a-z0-9]+$/i, '').trim();
    return raw || `导演台截图 ${index + 1}`;
  }

  function imageNodeDirectorUrl(node) {
    return String(node?.data?.url || (Array.isArray(node?.data?.urls) ? node.data.urls[0] : '') || node?.data?.refUrl || '').trim();
  }

  window.FutureAIDirectorDesk = {
    normalizeDirectorDeskDestination,
    normalizeDirectorShotPack,
    directorShotPackPrompt,
    directorShotPackTitle,
    directorShotPackVideoPrompt,
    normalizeDirectorDeskCaptures,
    directorDeskCaptureBaseName,
    imageNodeDirectorUrl
  };
})();
