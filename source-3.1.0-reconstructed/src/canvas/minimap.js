(() => {
  'use strict';

  /**
   * Canvas minimap: node rectangles plus the visible viewport on a small <canvas>.
   * Click or drag on it to pan. Redraws are throttled and only happen while it is shown.
   */
  const REDRAW_INTERVAL_MS = 120;
  const PAD = 6;

  function create(deps = {}) {
    const {
      panel,
      canvas,
      getView,
      setViewCenter,
      nodeSize,
      isSelected = () => false
    } = deps;
    const observeTarget = deps.observeTarget || null;
    let enabled = false;
    let pending = false;
    let lastDrawAt = 0;
    let mapping = null;
    let frozenMapping = null;
    let dragPointer = null;

    const shown = () => enabled && panel && !panel.classList.contains('hidden');

    function accentColor() {
      const value = getComputedStyle(document.body).getPropertyValue('--theme-accent').trim();
      return value || '#4fd6e8';
    }

    function computeMapping(width, height) {
      const view = getView();
      const host = view.canvasRect;
      const left = -view.offsetX / view.scale;
      const top = -view.offsetY / view.scale;
      const viewRect = {left, top, right: left + host.width / view.scale, bottom: top + host.height / view.scale};
      const bounds = {...viewRect};
      const rects = [];
      view.nodes.forEach(node => {
        if (node.el?.classList.contains('search-hidden')) return;
        const size = nodeSize(node);
        const rect = {id: node.id, left: node.x, top: node.y, right: node.x + size.width, bottom: node.y + size.height};
        rects.push(rect);
        bounds.left = Math.min(bounds.left, rect.left);
        bounds.top = Math.min(bounds.top, rect.top);
        bounds.right = Math.max(bounds.right, rect.right);
        bounds.bottom = Math.max(bounds.bottom, rect.bottom);
      });
      const worldW = Math.max(1, bounds.right - bounds.left);
      const worldH = Math.max(1, bounds.bottom - bounds.top);
      const ratio = Math.min((width - PAD * 2) / worldW, (height - PAD * 2) / worldH);
      const originX = PAD + (width - PAD * 2 - worldW * ratio) / 2 - bounds.left * ratio;
      const originY = PAD + (height - PAD * 2 - worldH * ratio) / 2 - bounds.top * ratio;
      return {ratio, originX, originY, rects, viewRect};
    }

    function draw() {
      pending = false;
      lastDrawAt = performance.now();
      if (!shown() || !canvas) return;
      const cssW = canvas.clientWidth || 200;
      const cssH = canvas.clientHeight || 128;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const pxW = Math.round(cssW * dpr);
      const pxH = Math.round(cssH * dpr);
      if (canvas.width !== pxW || canvas.height !== pxH) {
        canvas.width = pxW;
        canvas.height = pxH;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const map = computeMapping(cssW, cssH);
      mapping = map;
      const fit = frozenMapping || map;
      const accent = accentColor();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      const toX = x => fit.originX + x * fit.ratio;
      const toY = y => fit.originY + y * fit.ratio;
      map.rects.forEach(rect => {
        const x = toX(rect.left);
        const y = toY(rect.top);
        const w = Math.max(2, (rect.right - rect.left) * fit.ratio);
        const h = Math.max(2, (rect.bottom - rect.top) * fit.ratio);
        ctx.fillStyle = isSelected(rect.id) ? accent : 'rgba(214,228,238,.34)';
        ctx.fillRect(x, y, w, h);
      });
      const v = map.viewRect;
      const vx = toX(v.left);
      const vy = toY(v.top);
      const vw = (v.right - v.left) * fit.ratio;
      const vh = (v.bottom - v.top) * fit.ratio;
      ctx.save();
      ctx.globalAlpha = .14;
      ctx.fillStyle = accent;
      ctx.fillRect(vx, vy, vw, vh);
      ctx.restore();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = accent;
      ctx.strokeRect(vx + .75, vy + .75, Math.max(1, vw - 1.5), Math.max(1, vh - 1.5));
    }

    function schedule() {
      if (pending || !shown()) return;
      pending = true;
      const wait = Math.max(0, REDRAW_INTERVAL_MS - (performance.now() - lastDrawAt));
      setTimeout(() => requestAnimationFrame(draw), wait);
    }

    function panTo(event) {
      const fit = frozenMapping || mapping;
      if (!fit) return;
      const r = canvas.getBoundingClientRect();
      const worldX = (event.clientX - r.left - fit.originX) / fit.ratio;
      const worldY = (event.clientY - r.top - fit.originY) / fit.ratio;
      setViewCenter(worldX, worldY);
      schedule();
    }

    canvas?.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (!mapping) draw();
      frozenMapping = mapping;
      dragPointer = event.pointerId;
      try { canvas.setPointerCapture(event.pointerId); } catch (_) { /* synthetic events have no capturable pointer */ }
      panTo(event);
    });
    canvas?.addEventListener('pointermove', event => {
      if (dragPointer === null || event.pointerId !== dragPointer) return;
      event.preventDefault();
      panTo(event);
    });
    const endDrag = event => {
      if (dragPointer === null || event.pointerId !== dragPointer) return;
      dragPointer = null;
      frozenMapping = null;
      schedule();
    };
    canvas?.addEventListener('pointerup', endDrag);
    canvas?.addEventListener('pointercancel', endDrag);
    panel?.addEventListener('wheel', event => event.stopPropagation(), {passive: true});

    const observer = observeTarget && typeof MutationObserver === 'function'
      ? new MutationObserver(schedule)
      : null;
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;

    function setEnabled(next) {
      enabled = !!next;
      panel?.classList.toggle('hidden', !enabled);
      panel?.setAttribute('aria-hidden', String(!enabled));
      if (enabled) {
        observer?.observe(observeTarget, {childList: true});
        if (observeTarget) resizeObserver?.observe(observeTarget.parentElement || observeTarget);
        schedule();
      } else {
        observer?.disconnect();
        resizeObserver?.disconnect();
        mapping = null;
      }
    }

    return {setEnabled, schedule, isEnabled: () => enabled};
  }

  window.FutureAICanvasMinimap = {create};
})();
