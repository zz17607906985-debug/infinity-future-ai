(() => {
  'use strict';

  function isSupportedUploadFile(file) {
    return !!file && /^(image|video)\//i.test(file.type || '');
  }

  function isVideoMedia(mime = '', url = '') {
    return /^video\//i.test(mime || '') || /^data:video\//i.test(url || '') || /\.(mp4|webm|mov|m4v|avi)$/i.test(url || '');
  }

  function safeMediaUrl(value) {
    const raw = String(value || '').trim();
    if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return '';
    if (/^data:/i.test(raw)) {
      return /^data:(?:image\/(?:png|jpe?g|gif|webp|avif|bmp)|video\/(?:mp4|webm|quicktime|x-m4v)|audio\/(?:mpeg|mp4|ogg|wav|webm));/i.test(raw)
        ? raw
        : '';
    }
    try {
      const parsed = new URL(raw, document.baseURI);
      return ['http:', 'https:', 'blob:', 'file:'].includes(parsed.protocol) ? parsed.href : '';
    } catch {
      return '';
    }
  }

  function safeExternalUrl(value) {
    const raw = String(value || '').trim();
    if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return '';
    try {
      const parsed = new URL(raw);
      return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
    } catch {
      return '';
    }
  }

  function safeDownloadName(node, now = Date.now()) {
    const ext = isVideoMedia(node?.data?.mime, node?.data?.url) ? 'mp4' : 'png';
    return (node?.data?.name || ('future_upload_' + now + '.' + ext)).replace(/[\\/:*?"<>|]+/g, '_');
  }

  function mediaExtFromMime(mime = '', name = '') {
    if (/png/i.test(mime)) return 'png';
    if (/jpe?g/i.test(mime)) return 'jpg';
    if (/webp/i.test(mime)) return 'webp';
    if (/gif/i.test(mime)) return 'gif';
    if (/mp4/i.test(mime)) return 'mp4';
    if (/webm/i.test(mime)) return 'webm';
    const ext = String(name || '').match(/\.([a-z0-9]{2,5})$/i)?.[1];
    return ext || (/^video\//i.test(mime) ? 'mp4' : 'png');
  }

  function mediaExtFromDataUrl(dataUrl = '') {
    const mime = String(dataUrl).match(/^data:([^;]+);/)?.[1] || '';
    return mediaExtFromMime(mime);
  }

  function dataURLToBlob(dataURL) {
    const parts = String(dataURL || '').split(',');
    const mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/png';
    const raw = atob(parts[1] || '');
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return new Blob([arr], {type: mime});
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async function blobUrlToDataUrl(url) {
    const blob = await fetch(url).then(res => res.blob());
    return await blobToDataUrl(blob);
  }

  window.FutureAIMediaUtils = {
    isSupportedUploadFile,
    isVideoMedia,
    safeMediaUrl,
    safeExternalUrl,
    safeDownloadName,
    mediaExtFromMime,
    mediaExtFromDataUrl,
    dataURLToBlob,
    blobToDataUrl,
    blobUrlToDataUrl
  };
})();
