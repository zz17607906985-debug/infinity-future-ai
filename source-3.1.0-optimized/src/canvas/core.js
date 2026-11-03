(() => {
  'use strict';

  function clampScale(value, min = 0.22, max = 2.5, fallback = 1) {
    const next = Number.isFinite(Number(value)) ? Number(value) : fallback;
    return Math.max(min, Math.min(max, next));
  }

  function screenToWorldPoint({clientX, clientY, rectLeft = 0, rectTop = 0, scale = 1, offsetX = 0, offsetY = 0}) {
    const safeScale = Number(scale) || 1;
    return {
      x: (Number(clientX || 0) - Number(rectLeft || 0) - Number(offsetX || 0)) / safeScale,
      y: (Number(clientY || 0) - Number(rectTop || 0) - Number(offsetY || 0)) / safeScale
    };
  }

  function viewportCenter({width = 0, height = 0, scale = 1, offsetX = 0, offsetY = 0}) {
    const safeScale = Number(scale) || 1;
    return {
      x: (Number(width || 0) / 2 - Number(offsetX || 0)) / safeScale,
      y: (Number(height || 0) / 2 - Number(offsetY || 0)) / safeScale
    };
  }

  function zoomAroundPoint({scale = 1, offsetX = 0, offsetY = 0}, focal, nextScale, limits = {}) {
    const mx = Number(focal?.x || 0);
    const my = Number(focal?.y || 0);
    const safeScale = Number(scale) || 1;
    const next = clampScale(nextScale, limits.min ?? 0.22, limits.max ?? 2.5, safeScale);
    const wx = (mx - Number(offsetX || 0)) / safeScale;
    const wy = (my - Number(offsetY || 0)) / safeScale;
    return {
      scale: next,
      offsetX: mx - wx * next,
      offsetY: my - wy * next
    };
  }

  function visibleWorldRect({width = 0, height = 0, scale = 1, offsetX = 0, offsetY = 0, pad = 0}) {
    const safeScale = Number(scale) || 1;
    const safePad = Number(pad || 0);
    const left = (-Number(offsetX || 0)) / safeScale - safePad;
    const top = (-Number(offsetY || 0)) / safeScale - safePad;
    return {
      left,
      top,
      right: left + Number(width || 0) / safeScale + safePad * 2,
      bottom: top + Number(height || 0) / safeScale + safePad * 2
    };
  }

  window.FutureAICanvasCore = {
    clampScale,
    screenToWorldPoint,
    viewportCenter,
    zoomAroundPoint,
    visibleWorldRect
  };
})();
