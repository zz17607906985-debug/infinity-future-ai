(() => {
  'use strict';

  /**
   * Capture the infinite canvas (all nodes or selection) into a PNG data URL.
   * Draws node chrome + media thumbnails onto an offscreen canvas — no html2canvas dep.
   */
  function createCanvasSnapshot(deps = {}) {
    const PAD = 48;

    function nodeSize(node) {
      const el = node?.el;
      const width = Math.max(120, Math.round(el?.offsetWidth || node?.w || 280));
      const height = Math.max(80, Math.round(el?.offsetHeight || node?.h || 180));
      return { width, height };
    }

    function collectNodes({ nodes, selectedIds, scope = 'all' } = {}) {
      const map = nodes instanceof Map ? nodes : new Map(Object.entries(nodes || {}));
      const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
      const list = [];
      for (const [id, node] of map.entries()) {
        if (!node) continue;
        if (scope === 'selection' && selected.size && !selected.has(id)) continue;
        list.push({ id, node });
      }
      if (scope === 'selection' && selected.size && !list.length) {
        throw new Error('没有选中的节点可导出');
      }
      if (!list.length) throw new Error('画布上没有可导出的节点');
      return list;
    }

    function boundsOf(list) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const { node } of list) {
        const x = Number(node.x) || 0;
        const y = Number(node.y) || 0;
        const { width, height } = nodeSize(node);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + width);
        maxY = Math.max(maxY, y + height);
      }
      return {
        minX: minX - PAD,
        minY: minY - PAD,
        width: Math.ceil(maxX - minX + PAD * 2),
        height: Math.ceil(maxY - minY + PAD * 2)
      };
    }

    function mediaElement(node) {
      const el = node?.el;
      if (!el) return null;
      return el.querySelector('img,video,canvas') || null;
    }

    function drawNode(ctx, node, originX, originY) {
      const x = (Number(node.x) || 0) - originX;
      const y = (Number(node.y) || 0) - originY;
      const { width, height } = nodeSize(node);
      ctx.fillStyle = '#1a2129';
      ctx.strokeStyle = 'rgba(255,255,255,.18)';
      ctx.lineWidth = 2;
      roundRect(ctx, x, y, width, height, 12);
      ctx.fill();
      ctx.stroke();

      // title bar
      ctx.fillStyle = '#222b34';
      roundRect(ctx, x, y, width, 34, 12, true);
      ctx.fill();
      ctx.fillStyle = '#e7eef4';
      ctx.font = '600 13px system-ui,sans-serif';
      const title = String(node.data?.title || node.data?.name || node.type || '节点').slice(0, 40);
      ctx.fillText(title, x + 12, y + 22);

      const media = mediaElement(node);
      const bodyY = y + 40;
      const bodyH = Math.max(20, height - 48);
      if (media && media.tagName === 'IMG' && media.naturalWidth) {
        drawContained(ctx, media, x + 8, bodyY, width - 16, bodyH);
      } else if (media && media.tagName === 'VIDEO' && (media.videoWidth || media.readyState >= 2)) {
        drawContained(ctx, media, x + 8, bodyY, width - 16, bodyH);
      } else if (media && media.tagName === 'CANVAS') {
        drawContained(ctx, media, x + 8, bodyY, width - 16, bodyH);
      } else {
        ctx.fillStyle = '#8d9aa5';
        ctx.font = '12px system-ui,sans-serif';
        const tip = String(node.data?.prompt || node.type || '').slice(0, 80);
        wrapText(ctx, tip || '（无预览）', x + 12, bodyY + 18, width - 24, 16);
      }
    }

    function drawContained(ctx, source, x, y, w, h) {
      const sw = source.naturalWidth || source.videoWidth || source.width || w;
      const sh = source.naturalHeight || source.videoHeight || source.height || h;
      if (!sw || !sh) return;
      const scale = Math.min(w / sw, h / sh);
      const dw = sw * scale;
      const dh = sh * scale;
      const dx = x + (w - dw) / 2;
      const dy = y + (h - dh) / 2;
      try { ctx.drawImage(source, dx, dy, dw, dh); } catch (_err) { /* tainted / not ready */ }
    }

    function roundRect(ctx, x, y, w, h, r, topOnly = false) {
      const radius = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.arcTo(x + w, y, x + w, y + h, radius);
      if (topOnly) {
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x, y + h);
        ctx.lineTo(x, y + radius);
      } else {
        ctx.arcTo(x + w, y + h, x, y + h, radius);
        ctx.arcTo(x, y + h, x, y, radius);
      }
      ctx.arcTo(x, y, x + w, y, radius);
      ctx.closePath();
    }

    function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
      const chars = String(text || '').split('');
      let line = '';
      let cy = y;
      for (const ch of chars) {
        const test = line + ch;
        if (ctx.measureText(test).width > maxWidth && line) {
          ctx.fillText(line, x, cy);
          line = ch;
          cy += lineHeight;
          if (cy > y + lineHeight * 6) break;
        } else line = test;
      }
      if (line) ctx.fillText(line, x, cy);
    }

    async function capture({ nodes, selectedIds, scope = 'all', maxSide = 4096 } = {}) {
      const list = collectNodes({ nodes, selectedIds, scope });
      const box = boundsOf(list);
      let width = box.width;
      let height = box.height;
      const side = Math.min(Math.max(Number(maxSide) || 4096, 256), 8192);
      const scale = Math.min(1, side / Math.max(width, height, 1));
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));

      const canvas = (deps.document || document).createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0e1318';
      ctx.fillRect(0, 0, width, height);
      ctx.scale(scale, scale);
      for (const { node } of list) drawNode(ctx, node, box.minX, box.minY);
      const dataUrl = canvas.toDataURL('image/png');
      return {
        dataUrl,
        width,
        height,
        nodeCount: list.length,
        scope: scope === 'selection' ? 'selection' : 'all',
        mime: 'image/png'
      };
    }

    return { capture, collectNodes, boundsOf, nodeSize };
  }

  const api = { createCanvasSnapshot };
  if (typeof window !== 'undefined') window.FutureAICanvasSnapshot = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
