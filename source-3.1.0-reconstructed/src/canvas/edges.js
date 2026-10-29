(() => {
  'use strict';

  function portCenterFromRects({portRect, viewportRect, scale = 1}) {
    const safeScale = Number(scale) || 1;
    return {
      x: (Number(portRect.left || 0) + Number(portRect.width || 0) / 2 - Number(viewportRect.left || 0)) / safeScale,
      y: (Number(portRect.top || 0) + Number(portRect.height || 0) / 2 - Number(viewportRect.top || 0)) / safeScale
    };
  }

  function fallbackPortCenter({node, size, io}) {
    const width = Number(size?.width || 0);
    const height = Number(size?.height || 0);
    return {
      x: Number(node?.x || 0) + (io === 'out' ? width : 0),
      y: Number(node?.y || 0) + Math.max(70, height / 2)
    };
  }

  function edgePathD(a, b) {
    const dx = Math.max(80, Math.abs(Number(b.x || 0) - Number(a.x || 0)) * .45);
    return `M${a.x},${a.y} C${Number(a.x || 0) + dx},${a.y} ${Number(b.x || 0) - dx},${b.y} ${b.x},${b.y}`;
  }

  function segmentIntersectsView(a, b, view) {
    return Math.max(a.x, b.x) >= view.left &&
      Math.min(a.x, b.x) <= view.right &&
      Math.max(a.y, b.y) >= view.top &&
      Math.min(a.y, b.y) <= view.bottom;
  }

  function edgeClassName(toPort) {
    return 'edge edge-' + String(toPort || '');
  }

  window.FutureAICanvasEdges = {
    portCenterFromRects,
    fallbackPortCenter,
    edgePathD,
    segmentIntersectsView,
    edgeClassName
  };
})();
