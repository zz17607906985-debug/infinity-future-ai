(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FutureAICanvasArrange = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  /**
   * Pure geometry for canvas arrangement: align, distribute, and drag snapping.
   * Rects are {id, x, y, w, h} in world coordinates; results never mutate input.
   */
  const ALIGN_MODES = ['left', 'center', 'right', 'top', 'middle', 'bottom'];
  const MIN_DISTRIBUTE_GAP = 24;

  function bounds(rects) {
    const left = Math.min(...rects.map(r => r.x));
    const top = Math.min(...rects.map(r => r.y));
    const right = Math.max(...rects.map(r => r.x + r.w));
    const bottom = Math.max(...rects.map(r => r.y + r.h));
    return {x: left, y: top, w: right - left, h: bottom - top};
  }

  function alignRects(rects, mode) {
    if (!Array.isArray(rects) || rects.length < 2 || !ALIGN_MODES.includes(mode)) return [];
    const box = bounds(rects);
    return rects.map(r => {
      const next = {id: r.id, x: r.x, y: r.y};
      if (mode === 'left') next.x = box.x;
      else if (mode === 'center') next.x = box.x + (box.w - r.w) / 2;
      else if (mode === 'right') next.x = box.x + box.w - r.w;
      else if (mode === 'top') next.y = box.y;
      else if (mode === 'middle') next.y = box.y + (box.h - r.h) / 2;
      else next.y = box.y + box.h - r.h;
      return next;
    });
  }

  // Equal gaps between neighbours along one axis; the first item stays put.
  function distributeRects(rects, axis) {
    if (!Array.isArray(rects) || rects.length < 3 || (axis !== 'x' && axis !== 'y')) return [];
    const size = axis === 'x' ? 'w' : 'h';
    const sorted = rects.slice().sort((a, b) => a[axis] - b[axis] || String(a.id).localeCompare(String(b.id)));
    const first = sorted[0];
    const total = sorted.reduce((sum, r) => sum + r[size], 0);
    const span = Math.max(...sorted.map(r => r[axis] + r[size])) - first[axis];
    let gap = (span - total) / (sorted.length - 1);
    if (!(gap >= 0)) gap = MIN_DISTRIBUTE_GAP;
    let cursor = first[axis];
    return sorted.map(r => {
      const next = {id: r.id, x: r.x, y: r.y};
      next[axis] = cursor;
      cursor += r[size] + gap;
      return next;
    });
  }

  function axisSnap(start, length, targets, startKey, lengthKey, threshold) {
    const moving = [start, start + length / 2, start + length];
    let best = null;
    targets.forEach(t => {
      [t[startKey], t[startKey] + t[lengthKey] / 2, t[startKey] + t[lengthKey]].forEach(line => {
        moving.forEach(edge => {
          const delta = line - edge;
          if (Math.abs(delta) > threshold) return;
          if (!best || Math.abs(delta) < Math.abs(best.delta)) best = {delta, line};
        });
      });
    });
    return best;
  }

  // Snap a moving rect to edges/centres of target rects. Returns the correction and guide lines to draw.
  function snapMove(moving, targets, threshold) {
    const list = Array.isArray(targets) ? targets : [];
    const limit = Math.max(0, Number(threshold) || 0);
    const sx = axisSnap(moving.x, moving.w, list, 'x', 'w', limit);
    const sy = axisSnap(moving.y, moving.h, list, 'y', 'h', limit);
    const dx = sx ? sx.delta : 0;
    const dy = sy ? sy.delta : 0;
    const guides = [];
    const span = (rect, a, b) => [Math.min(rect[a], moving[a] + (a === 'x' ? dx : dy)), Math.max(rect[a] + rect[b], moving[a] + (a === 'x' ? dx : dy) + moving[b])];
    const hits = (line, startKey, lengthKey) => list.filter(t => [t[startKey], t[startKey] + t[lengthKey] / 2, t[startKey] + t[lengthKey]].some(v => Math.abs(v - line) < 0.5));
    if (sx) {
      const matched = hits(sx.line, 'x', 'w');
      const [from, to] = matched.reduce((acc, t) => {
        const [a, b] = span(t, 'y', 'h');
        return [Math.min(acc[0], a), Math.max(acc[1], b)];
      }, [Infinity, -Infinity]);
      guides.push({axis: 'x', pos: sx.line, from, to});
    }
    if (sy) {
      const matched = hits(sy.line, 'y', 'h');
      const [from, to] = matched.reduce((acc, t) => {
        const [a, b] = span(t, 'x', 'w');
        return [Math.min(acc[0], a), Math.max(acc[1], b)];
      }, [Infinity, -Infinity]);
      guides.push({axis: 'y', pos: sy.line, from, to});
    }
    return {dx, dy, guides};
  }

  return {ALIGN_MODES, bounds, alignRects, distributeRects, snapMove};
});
