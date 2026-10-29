(() => {
  'use strict';

  function create(deps = {}) {
    const $ = deps.$;
    const state = deps.state || {};
    const isCanvasOverlayTarget = deps.isCanvasOverlayTarget || (() => false);
    const closeFloatingCanvasUi = deps.closeFloatingCanvasUi || (() => {});
    const clearSelection = deps.clearSelection || (() => {});
    const releaseDrags = deps.releaseDrags || (() => {});
    const updateSelectionBox = deps.updateSelectionBox || (() => {});
    const isCanvasMenuBlockedTarget = deps.isCanvasMenuBlockedTarget || (() => false);
    const showNodeTypeMenu = deps.showNodeTypeMenu || (() => {});
    const hasAssetTransfer = deps.hasAssetTransfer || (() => false);
    const assetFromDataTransfer = deps.assetFromDataTransfer || (() => null);
    const dropAssetOnCanvas = deps.dropAssetOnCanvas || (() => {});
    const isSupportedUploadFile = deps.isSupportedUploadFile || (() => false);
    const screenToWorld = deps.screenToWorld || (() => ({x: 0, y: 0}));
    const addNode = deps.addNode || (() => null);
    const readUpload = deps.readUpload || (() => {});
    const saveProject = deps.saveProject || (() => {});
    const toast = deps.toast || (() => {});
    const zoomAroundPoint = deps.zoomAroundPoint || ((viewport) => viewport);
    const setCanvasProxyActive = deps.setCanvasProxyActive || (() => {});
    const scheduleTransform = deps.scheduleTransform || (() => {});
    const scheduleViewportInteractionEnd = deps.scheduleViewportInteractionEnd || (() => {});
    const updateLinkDrag = deps.updateLinkDrag || (() => {});
    const updateReferenceSort = deps.updateReferenceSort || (() => {});
    const finishReferenceSort = deps.finishReferenceSort || (() => {});
    const finishSelection = deps.finishSelection || (() => {});
    const updateNodeDrag = deps.updateNodeDrag || (() => {});
    const finishPortDrag = deps.finishPortDrag || (() => {});
    const safeReleasePointerCapture = deps.safeReleasePointerCapture || (() => {});
    const cancelPortDrag = deps.cancelPortDrag || (() => {});

    function bindCanvas() {
      const canvas = $('canvas');
      if (!canvas) return;
      canvas.addEventListener('pointerdown', e => {
        if (e.target.closest('.node') || e.target.closest('.port') || isCanvasOverlayTarget(e.target)) return;
        closeFloatingCanvasUi();
        canvas.setPointerCapture?.(e.pointerId);
        if (e.button === 0 && !e.shiftKey) clearSelection();
        if (e.button === 0 && e.shiftKey) {
          releaseDrags(false);
          state.selecting = {startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, pointerId: e.pointerId, moved: false};
          updateSelectionBox();
          e.preventDefault();
          return;
        }
        if (e.button === 0 || e.button === 1 || e.button === 2 || e.altKey) {
          releaseDrags(false);
          state.panning = {x: e.clientX, y: e.clientY, pointerId: e.pointerId};
          canvas.classList.add('is-panning');
          setCanvasProxyActive(true);
          e.preventDefault();
        }
      });
      canvas.addEventListener('contextmenu', e => e.preventDefault());
      canvas.addEventListener('dblclick', e => {
        if (state.activeWorkspace !== 'canvas') return;
        if (isCanvasMenuBlockedTarget(e.target) || e.target.closest('.node')) return;
        showNodeTypeMenu(e.clientX, e.clientY);
      });
      document.querySelector('.canvas-rail')?.addEventListener('dblclick', e => e.stopPropagation(), true);
      canvas.addEventListener('dragover', e => {
        if (hasAssetTransfer(e.dataTransfer)) {
          e.preventDefault();
          canvas.classList.add('asset-drop-over');
          return;
        }
        if ([...(e.dataTransfer?.items || [])].some(item => item.kind === 'file')) {
          e.preventDefault();
          canvas.classList.add('drag-over');
        }
      });
      canvas.addEventListener('dragleave', e => {
        if (!canvas.contains(e.relatedTarget)) canvas.classList.remove('drag-over', 'asset-drop-over');
      });
      canvas.addEventListener('drop', e => {
        const asset = assetFromDataTransfer(e.dataTransfer);
        if (asset) {
          e.preventDefault();
          canvas.classList.remove('drag-over', 'asset-drop-over');
          dropAssetOnCanvas(asset, e.clientX, e.clientY);
          return;
        }
        const files = [...(e.dataTransfer?.files || [])].filter(isSupportedUploadFile);
        if (!files.length) return;
        e.preventDefault();
        canvas.classList.remove('drag-over');
        const pos = screenToWorld(e.clientX, e.clientY);
        files.slice(0, 6).forEach((file, i) => {
          const node = addNode('upload', pos.x + i * 34, pos.y + i * 34, {}, null, false);
          readUpload(node, file);
        });
        saveProject();
        toast('已从文件夹拖入 ' + files.length + ' 个素材', 'success');
      });
      canvas.addEventListener('wheel', e => {
        if (isCanvasOverlayTarget(e.target)) return;
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        const next = zoomAroundPoint({scale: state.scale, offsetX: state.offsetX, offsetY: state.offsetY}, {x: mx, y: my}, state.scale * (e.deltaY > 0 ? .86 : 1.16));
        state.scale = next.scale;
        state.offsetX = next.offsetX;
        state.offsetY = next.offsetY;
        canvas.classList.add('is-zooming');
        setCanvasProxyActive(true);
        scheduleTransform(false, false);
        scheduleViewportInteractionEnd();
      }, {passive: false});
      document.addEventListener('pointermove', e => {
        if (state.linkDrag) return updateLinkDrag(e);
        if (state.refSorting) return updateReferenceSort(e);
        if (state.selecting?.pointerId != null && e.pointerId !== state.selecting.pointerId) return;
        if (state.panning?.pointerId != null && e.pointerId !== state.panning.pointerId) return;
        if (state.dragging?.pointerId != null && e.pointerId !== state.dragging.pointerId) return;
        if (state.selecting && !(e.buttons & 1)) {
          finishSelection(e.shiftKey);
          releaseDrags(true);
          return;
        }
        if (state.panning && e.buttons === 0) {
          releaseDrags(true);
          return;
        }
        if (state.selecting) {
          state.selecting.x = e.clientX;
          state.selecting.y = e.clientY;
          if (Math.abs(state.selecting.x - state.selecting.startX) > 8 || Math.abs(state.selecting.y - state.selecting.startY) > 8) state.selecting.moved = true;
          updateSelectionBox();
        }
        if (state.panning) {
          state.offsetX += e.clientX - state.panning.x;
          state.offsetY += e.clientY - state.panning.y;
          state.panning.x = e.clientX;
          state.panning.y = e.clientY;
          scheduleTransform(false, false);
        }
        if (state.dragging) updateNodeDrag(e.clientX, e.clientY, e.altKey);
      });
      document.addEventListener('mousemove', e => {
        if (!state.dragging || state.dragging.pointerId != null) return;
        updateNodeDrag(e.clientX, e.clientY, e.altKey);
      });
      document.addEventListener('pointerup', e => {
        if (state.linkDrag) {
          finishPortDrag(e);
          return;
        }
        if (state.refSorting) {
          finishReferenceSort(e);
          return;
        }
        if (state.selecting) finishSelection(e.shiftKey);
        safeReleasePointerCapture(canvas, e.pointerId);
        releaseDrags(true);
      });
      document.addEventListener('mouseup', () => {
        if (state.dragging && state.dragging.pointerId == null) releaseDrags(true);
      });
      document.addEventListener('mousedown', e => {
        if (state.dragging && !state.panning && !e.target.closest('.node,.canvas-group')) releaseDrags(true);
      }, true);
      document.addEventListener('dragstart', e => e.preventDefault());
      window.addEventListener('blur', () => releaseDrags(true));
      document.addEventListener('mouseleave', () => releaseDrags(true));
      document.addEventListener('pointercancel', e => {
        if (state.linkDrag) cancelPortDrag();
        if (state.refSorting) state.refSorting = null;
        safeReleasePointerCapture(canvas, e.pointerId);
        releaseDrags(true);
      });
    }

    return {bindCanvas};
  }

  window.FutureAICanvasEvents = {create};
})();
