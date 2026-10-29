(() => {
  'use strict';

  function create(deps = {}) {
    const $ = deps.$ || (id => document.getElementById(id));
    const toast = typeof deps.toast === 'function' ? deps.toast : () => {};
    const Core = () => deps.Core || window.FutureAILocalEditCore;
    const Variants = () => deps.Variants || window.FutureAIVariantManager;

    let activeNodeId = '';
    let activeTool = 'inpaint';
    let sourceUrl = '';
    let naturalW = 0;
    let naturalH = 0;
    let painting = false;
    let brushSize = 28;
    let padUniform = 128;
    let upscaleFactor = 2;
    let cutoutThreshold = 42;
    let running = false;

    function nodeById(id) {
      return typeof deps.getNode === 'function' ? deps.getNode(id) : null;
    }

    function modal() { return $('localEditModal'); }
    function stage() { return $('localEditStage'); }
    function statusEl() { return $('localEditStatus'); }
    function promptEl() { return $('localEditPrompt'); }
    function tipEl() { return $('localEditTip'); }
    function runBtn() { return $('localEditRun'); }

    function setStatus(text) {
      const el = statusEl();
      if (el) el.textContent = text || '';
    }

    function setTip(text, kind = '') {
      const el = tipEl();
      if (!el) return;
      el.textContent = text || '';
      el.dataset.kind = kind || '';
      el.classList.toggle('is-warn', kind === 'warn');
      el.classList.toggle('is-error', kind === 'error');
    }

    function currentCapability() {
      const node = nodeById(activeNodeId);
      if (!node) return { operations: [], providerType: '', hasLocalMedia: Boolean(window.mediaBridge?.process) };
      const info = typeof deps.resolveImageCapability === 'function' ? deps.resolveImageCapability(node) : null;
      return {
        operations: Array.isArray(info?.operations) ? info.operations : [],
        providerType: String(info?.providerType || info?.provider?.type || ''),
        hasLocalMedia: Boolean(window.mediaBridge?.process),
        provider: info?.provider || null,
        modelId: info?.modelId || ''
      };
    }

    function supportFor(tool) {
      const cap = currentCapability();
      return Core().toolSupport({
        tool,
        operations: cap.operations,
        providerType: cap.providerType,
        hasLocalMedia: cap.hasLocalMedia,
        hasMask: tool === 'inpaint' || tool === 'outpaint'
      });
    }

    function syncToolButtons() {
      const root = modal();
      if (!root) return;
      root.querySelectorAll('[data-local-edit-tool]').forEach(btn => {
        const tool = btn.dataset.localEditTool;
        const support = supportFor(tool);
        btn.classList.toggle('active', tool === activeTool);
        btn.classList.toggle('is-disabled', !support.supported);
        btn.title = support.supported ? (Core().TOOL_LABELS[tool] || tool) : (support.tip || '当前模型不支持');
        btn.setAttribute('aria-disabled', support.supported ? 'false' : 'true');
      });
      root.querySelectorAll('[data-local-edit-pane]').forEach(pane => {
        pane.classList.toggle('hidden', pane.dataset.localEditPane !== activeTool);
      });
      const support = supportFor(activeTool);
      if (!support.supported) {
        setTip(`${support.tip}：${support.detail || ''}`.trim(), 'warn');
        if (runBtn()) {
          runBtn().disabled = true;
          runBtn().textContent = support.tip || '当前模型不支持';
        }
      } else {
        setTip(support.detail || '', '');
        if (runBtn()) {
          runBtn().disabled = running;
          runBtn().textContent = running ? '处理中…' : '开始处理';
        }
      }
      updatePromptVisibility();
    }

    function updatePromptVisibility() {
      const wrap = $('localEditPromptWrap');
      if (!wrap) return;
      const needPrompt = activeTool === 'inpaint' || activeTool === 'outpaint';
      wrap.classList.toggle('hidden', !needPrompt);
    }

    function clearCanvases() {
      const host = stage();
      if (!host) return;
      host.innerHTML = '';
    }

    function ensureStageCanvases() {
      const host = stage();
      if (!host) return null;
      let base = host.querySelector('#localEditBase');
      let overlay = host.querySelector('#localEditOverlay');
      let mask = host.querySelector('#localEditMask');
      if (!base) {
        host.innerHTML = '';
        base = document.createElement('canvas');
        base.id = 'localEditBase';
        overlay = document.createElement('canvas');
        overlay.id = 'localEditOverlay';
        mask = document.createElement('canvas');
        mask.id = 'localEditMask';
        mask.className = 'local-edit-mask-canvas';
        const wrap = document.createElement('div');
        wrap.className = 'local-edit-canvas-wrap';
        wrap.append(base, overlay, mask);
        host.appendChild(wrap);
        bindPaint(mask);
      }
      return { base, overlay, mask };
    }

    function bindPaint(maskCanvas) {
      if (maskCanvas.dataset.bound === '1') return;
      maskCanvas.dataset.bound = '1';
      const paintAt = (evt) => {
        if (activeTool !== 'inpaint' || running) return;
        const ctx = maskCanvas.getContext('2d');
        const rect = maskCanvas.getBoundingClientRect();
        const x = ((evt.clientX - rect.left) / rect.width) * maskCanvas.width;
        const y = ((evt.clientY - rect.top) / rect.height) * maskCanvas.height;
        ctx.fillStyle = 'rgba(239,68,68,.72)';
        ctx.beginPath();
        ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
        ctx.fill();
        setStatus(`已涂抹选区 · 笔刷 ${brushSize}px`);
      };
      maskCanvas.addEventListener('pointerdown', evt => {
        if (activeTool !== 'inpaint') return;
        painting = true;
        maskCanvas.setPointerCapture?.(evt.pointerId);
        paintAt(evt);
      });
      maskCanvas.addEventListener('pointermove', evt => {
        if (!painting) return;
        paintAt(evt);
      });
      const stop = () => { painting = false; };
      maskCanvas.addEventListener('pointerup', stop);
      maskCanvas.addEventListener('pointercancel', stop);
      maskCanvas.addEventListener('pointerleave', stop);
    }

    function loadImage(url) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('无法读取图片'));
        img.src = url;
      });
    }

    async function drawSource() {
      const canvases = ensureStageCanvases();
      if (!canvases || !sourceUrl) return;
      const img = await loadImage(sourceUrl);
      naturalW = img.naturalWidth || img.width;
      naturalH = img.naturalHeight || img.height;
      const { base, overlay, mask } = canvases;
      [base, overlay, mask].forEach(c => {
        c.width = naturalW;
        c.height = naturalH;
      });
      const bctx = base.getContext('2d');
      bctx.clearRect(0, 0, naturalW, naturalH);
      bctx.drawImage(img, 0, 0);
      overlay.getContext('2d').clearRect(0, 0, naturalW, naturalH);
      mask.getContext('2d').clearRect(0, 0, naturalW, naturalH);
      const wrap = stage()?.querySelector('.local-edit-canvas-wrap');
      if (wrap) {
        const maxW = Math.min(920, Math.max(280, stage().clientWidth - 24 || 720));
        const scale = Math.min(1, maxW / naturalW);
        wrap.style.width = `${Math.round(naturalW * scale)}px`;
        wrap.style.height = `${Math.round(naturalH * scale)}px`;
      }
      setStatus(`${Core().sizeLabel(naturalW, naturalH)} · 选择工具后开始`);
      drawOutpaintPreview();
    }

    function drawOutpaintPreview() {
      if (activeTool !== 'outpaint') return;
      const canvases = ensureStageCanvases();
      if (!canvases || !naturalW) return;
      const pads = Core().normalizePads({
        top: Number($('localEditPadTop')?.value || padUniform),
        right: Number($('localEditPadRight')?.value || padUniform),
        bottom: Number($('localEditPadBottom')?.value || padUniform),
        left: Number($('localEditPadLeft')?.value || padUniform)
      });
      const geo = Core().outpaintGeometry({ width: naturalW, height: naturalH, pads });
      const { overlay } = canvases;
      const ctx = overlay.getContext('2d');
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      // Preview pad as translucent border on original coords (approximate).
      ctx.fillStyle = 'rgba(59,130,246,.22)';
      const inset = Math.min(pads.top, pads.right, pads.bottom, pads.left, 48);
      if (pads.top) ctx.fillRect(0, 0, naturalW, Math.min(pads.top, naturalH));
      if (pads.bottom) ctx.fillRect(0, Math.max(0, naturalH - Math.min(pads.bottom, naturalH)), naturalW, Math.min(pads.bottom, naturalH));
      if (pads.left) ctx.fillRect(0, 0, Math.min(pads.left, naturalW), naturalH);
      if (pads.right) ctx.fillRect(Math.max(0, naturalW - Math.min(pads.right, naturalW)), 0, Math.min(pads.right, naturalW), naturalH);
      void inset;
      setStatus(`扩图后 ${Core().sizeLabel(geo.width, geo.height)}${geo.scaled ? '（已按上限缩放）' : ''}`);
    }

    function clearMask() {
      const mask = $('localEditMask');
      if (!mask) return;
      mask.getContext('2d').clearRect(0, 0, mask.width, mask.height);
      setStatus('已清空选区');
    }

    function maskCoverage() {
      const mask = $('localEditMask');
      if (!mask) return 0;
      const ctx = mask.getContext('2d');
      const data = ctx.getImageData(0, 0, mask.width, mask.height).data;
      let painted = 0;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 16) painted += 1;
      }
      return Core().maskCoverageRatio({ painted, total: mask.width * mask.height });
    }

    function exportOpenAIMaskDataUrl() {
      const mask = $('localEditMask');
      if (!mask) return '';
      const ctx = mask.getContext('2d');
      const painted = ctx.getImageData(0, 0, mask.width, mask.height);
      const converted = Core().paintMaskToOpenAIAlpha(painted.data, {
        width: mask.width,
        height: mask.height,
        paintedIsEdit: true
      });
      const out = document.createElement('canvas');
      out.width = converted.width;
      out.height = converted.height;
      out.getContext('2d').putImageData(new ImageData(converted.data, converted.width, converted.height), 0, 0);
      return out.toDataURL('image/png');
    }

    async function buildOutpaintAssets(pads) {
      const geo = Core().outpaintGeometry({ width: naturalW, height: naturalH, pads });
      const img = await loadImage(sourceUrl);
      const canvas = document.createElement('canvas');
      canvas.width = geo.width;
      canvas.height = geo.height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, geo.width, geo.height);
      ctx.drawImage(img, geo.offsetX, geo.offsetY, geo.originalWidth, geo.originalHeight);
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = geo.width;
      maskCanvas.height = geo.height;
      const mctx = maskCanvas.getContext('2d');
      // Opaque keep on original region; transparent edit on pads.
      mctx.fillStyle = 'rgba(255,255,255,1)';
      mctx.fillRect(0, 0, geo.width, geo.height);
      mctx.clearRect(0, 0, geo.width, geo.pads.top);
      mctx.clearRect(0, geo.height - geo.pads.bottom, geo.width, geo.pads.bottom);
      mctx.clearRect(0, 0, geo.pads.left, geo.height);
      mctx.clearRect(geo.width - geo.pads.right, 0, geo.pads.right, geo.height);
      // Also clear the pad strips that overlap corners already cleared.
      return {
        geometry: geo,
        imageDataUrl: canvas.toDataURL('image/png'),
        maskDataUrl: maskCanvas.toDataURL('image/png'),
        size: `${geo.width}x${geo.height}`
      };
    }

    function sampleCornerAverage(ctx, w, h) {
      const pts = [
        [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
        [Math.floor(w / 2), 0], [Math.floor(w / 2), h - 1],
        [0, Math.floor(h / 2)], [w - 1, Math.floor(h / 2)]
      ];
      let r = 0, g = 0, b = 0;
      pts.forEach(([x, y]) => {
        const d = ctx.getImageData(x, y, 1, 1).data;
        r += d[0]; g += d[1]; b += d[2];
      });
      const n = pts.length;
      return { r: r / n, g: g / n, b: b / n };
    }

    async function localCutout() {
      const img = await loadImage(sourceUrl);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const { width, height } = canvas;
      const image = ctx.getImageData(0, 0, width, height);
      const data = image.data;
      const bg = sampleCornerAverage(ctx, width, height);
      const thr = Math.max(8, Math.min(120, Number(cutoutThreshold) || 42));
      const thr2 = thr * thr;
      for (let i = 0; i < data.length; i += 4) {
        const dr = data[i] - bg.r;
        const dg = data[i + 1] - bg.g;
        const db = data[i + 2] - bg.b;
        if ((dr * dr + dg * dg + db * db) <= thr2) data[i + 3] = 0;
      }
      // Flood from edges for near-bg connectivity.
      const visited = new Uint8Array(width * height);
      const stack = [];
      const push = (x, y) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return;
        const idx = y * width + x;
        if (visited[idx]) return;
        visited[idx] = 1;
        stack.push(idx);
      };
      for (let x = 0; x < width; x += 1) { push(x, 0); push(x, height - 1); }
      for (let y = 0; y < height; y += 1) { push(0, y); push(width - 1, y); }
      while (stack.length) {
        const idx = stack.pop();
        const o = idx * 4;
        const dr = data[o] - bg.r;
        const dg = data[o + 1] - bg.g;
        const db = data[o + 2] - bg.b;
        if ((dr * dr + dg * dg + db * db) > thr2 * 1.35 && data[o + 3] > 8) continue;
        data[o + 3] = 0;
        const x = idx % width;
        const y = (idx - x) / width;
        push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
      }
      ctx.putImageData(image, 0, 0);
      return canvas.toDataURL('image/png');
    }

    async function canvasUpscale(target) {
      const img = await loadImage(sourceUrl);
      const canvas = document.createElement('canvas');
      canvas.width = target.width;
      canvas.height = target.height;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, target.width, target.height);
      return { dataUrl: canvas.toDataURL('image/png'), width: target.width, height: target.height, mode: 'canvas' };
    }

    async function localUpscale(factor) {
      const target = Core().upscaleTargets({ width: naturalW, height: naturalH }).find(item => item.factor === factor);
      if (!target?.supported) throw new Error(target?.reason || '目标尺寸过大');
      if (!window.mediaBridge?.process) return canvasUpscale(target);
      try {
        const storageDir = typeof deps.getStorageDir === 'function' ? deps.getStorageDir() : '';
        const result = await window.mediaBridge.process({
          operation: 'image-resize',
          sourceUrl,
          width: target.width,
          height: target.height,
          format: 'png',
          storageDir
        });
        return { url: result.url, width: target.width, height: target.height, mode: 'ffmpeg' };
      } catch (error) {
        // data: URLs / unauthorized paths → soft canvas fallback (still local, no API).
        console.warn('localUpscale mediaBridge failed, falling back to canvas', error);
        return canvasUpscale(target);
      }
    }

    function discardPendingResultNode(pendingId) {
      if (!pendingId) return;
      try { deps.deleteNode?.(pendingId, false); } catch (_) {}
      try { deps.drawEdges?.(); } catch (_) {}
      try { deps.scheduleDrawEdges?.(); } catch (_) {}
    }

    // Local edits always spawn a NEW image node; the source node (url/history/params) stays untouched.
    // One saveProject after success → single undo removes the new node + wire.
    async function applyResultToNode(resultUrl, meta = {}) {
      const source = nodeById(activeNodeId);
      if (!source || !resultUrl) return null;
      if (typeof deps.addNode !== 'function') throw new Error('缺少 addNode，无法创建结果节点');
      const tool = meta.tool || activeTool;
      const label = meta.label || Core().TOOL_LABELS[tool] || '局部编辑';
      let pendingId = '';
      try {
        const persisted = typeof deps.persistMediaUrl === 'function'
          ? await deps.persistMediaUrl(resultUrl, `local_edit_${tool}_${Date.now()}`, 'png')
          : resultUrl;
        const seed = Core().buildResultNodeSeed(source.data || {}, {
          tool,
          label,
          prompt: meta.prompt,
          size: meta.size
        });
        const size = typeof deps.nodeSize === 'function' ? deps.nodeSize(source) : { width: 280 };
        const place = Core().resultNodePlacement(source, size);
        const next = deps.addNode('image', place.x, place.y, seed, null, false);
        if (!next?.id) throw new Error('无法创建结果节点');
        pendingId = next.id;

        const V = Variants();
        V?.ensureCurrentOutput?.(next.data, 'image');
        const recorded = V?.recordOutputs?.(next.data, {
          url: persisted,
          mediaType: 'image',
          status: 'unseen',
          model: next.data.model,
          prompt: meta.prompt || next.data.prompt || '',
          parameters: {
            edit: label,
            tool,
            size: meta.size || '',
            sourceNodeId: source.id
          }
        }) || [];
        const entry = Array.isArray(recorded) ? recorded[0] : null;
        next.data.url = persisted;
        next.data.urls = [persisted];
        if (entry?.id) next.data.selectedVariantId = entry.id;
        next.data.status = `${label}完成`;
        next.data.statusType = '';

        const wired = deps.connectSilently?.(source.id, 'image', next.id, 'ref');
        if (!wired) throw new Error('无法连接结果节点到原图');

        deps.hydrateNode?.(next);
        deps.selectSingleNode?.(next.id);
        deps.saveProject?.();
        toast(`${label}完成（已新建节点）`, 'success');
        return next;
      } catch (error) {
        discardPendingResultNode(pendingId);
        throw error;
      }
    }

    async function runApiEdit({ prompt, refUrls, maskUrl, size, tool, label }) {
      if (typeof deps.runImageEdit !== 'function') throw new Error('缺少图编辑接口');
      const node = nodeById(activeNodeId);
      if (!node) throw new Error('节点不存在');
      const result = await deps.runImageEdit({
        node,
        prompt,
        refUrls,
        maskUrl,
        size,
        tool,
        label
      });
      return result;
    }

    async function runActiveTool() {
      if (running) return;
      const support = supportFor(activeTool);
      if (!support.supported) {
        setTip(`${support.tip}：${support.detail || ''}`.trim(), 'warn');
        toast(support.tip || '当前模型不支持', 'warn');
        return;
      }
      const node = nodeById(activeNodeId);
      if (!node) return;
      running = true;
      syncToolButtons();
      try {
        if (activeTool === 'inpaint') {
          const coverage = maskCoverage();
          if (!Core().maskHasPaint(coverage)) {
            toast('请先在图片上涂抹要重绘的区域', 'warn');
            return;
          }
          const prompt = String(promptEl()?.value || '').trim();
          if (!prompt) {
            toast('请填写重绘内容', 'warn');
            return;
          }
          setStatus('正在提交选区重绘…');
          const maskDataUrl = exportOpenAIMaskDataUrl();
          const size = `${naturalW}x${naturalH}`;
          const result = await runApiEdit({
            prompt,
            refUrls: [sourceUrl],
            maskUrl: maskDataUrl,
            size,
            tool: 'inpaint',
            label: '选区重绘'
          });
          if (result?.url) await applyResultToNode(result.url, { tool: 'inpaint', label: '选区重绘', prompt, size });
          closeLocalEdit();
          return;
        }
        if (activeTool === 'outpaint') {
          const prompt = String(promptEl()?.value || '').trim() || '自然延伸画面，保持风格一致';
          const pads = Core().normalizePads({
            top: Number($('localEditPadTop')?.value || padUniform),
            right: Number($('localEditPadRight')?.value || padUniform),
            bottom: Number($('localEditPadBottom')?.value || padUniform),
            left: Number($('localEditPadLeft')?.value || padUniform)
          });
          if (!(pads.top || pads.right || pads.bottom || pads.left)) {
            toast('请至少在一个方向设置扩边像素', 'warn');
            return;
          }
          setStatus('正在准备扩图画布…');
          const assets = await buildOutpaintAssets(pads);
          const persistedImage = typeof deps.persistMediaUrl === 'function'
            ? await deps.persistMediaUrl(assets.imageDataUrl, `outpaint_base_${Date.now()}`, 'png')
            : assets.imageDataUrl;
          const persistedMask = typeof deps.persistMediaUrl === 'function'
            ? await deps.persistMediaUrl(assets.maskDataUrl, `outpaint_mask_${Date.now()}`, 'png')
            : assets.maskDataUrl;
          setStatus(`正在扩图至 ${assets.geometry.width}×${assets.geometry.height}…`);
          const result = await runApiEdit({
            prompt,
            refUrls: [persistedImage],
            maskUrl: persistedMask,
            size: assets.size,
            tool: 'outpaint',
            label: '扩图'
          });
          if (result?.url) await applyResultToNode(result.url, { tool: 'outpaint', label: '扩图', prompt, size: assets.size });
          closeLocalEdit();
          return;
        }
        if (activeTool === 'cutout') {
          setStatus('正在本地抠图…');
          const dataUrl = await localCutout();
          await applyResultToNode(dataUrl, { tool: 'cutout', label: '抠图去背景' });
          closeLocalEdit();
          return;
        }
        if (activeTool === 'upscale') {
          const factor = Number(upscaleFactor) === 4 ? 4 : 2;
          setStatus(`正在本地放大 ${factor}×…`);
          const out = await localUpscale(factor);
          const resultUrl = out.url || out.dataUrl;
          await applyResultToNode(resultUrl, {
            tool: 'upscale',
            label: `放大 ${factor}×`,
            size: `${out.width}x${out.height}`
          });
          closeLocalEdit();
          return;
        }
      } catch (error) {
        console.error(error);
        const msg = error?.message || String(error);
        setStatus(msg);
        setTip(msg, 'error');
        toast(`局部编辑失败：\n${msg}`, 'error');
      } finally {
        running = false;
        syncToolButtons();
      }
    }

    function selectTool(tool) {
      if (!Core().TOOLS.includes(tool)) return;
      activeTool = tool;
      painting = false;
      syncToolButtons();
      if (tool === 'outpaint') drawOutpaintPreview();
      else setStatus(`${Core().sizeLabel(naturalW, naturalH)} · ${Core().TOOL_LABELS[tool] || tool}`);
    }

    async function openLocalEdit(node) {
      if (!node || node.type !== 'image') return toast('请选择图片节点', 'warn');
      const url = node.data?.url || (Array.isArray(node.data?.urls) ? node.data.urls[0] : '');
      if (!url) return toast('请先生成或上传一张图片', 'warn');
      activeNodeId = node.id;
      sourceUrl = url;
      activeTool = 'inpaint';
      running = false;
      const title = $('localEditTitle');
      if (title) title.textContent = typeof deps.nodeDisplayTitle === 'function' ? deps.nodeDisplayTitle(node) : (node.data?.title || '图片');
      if (promptEl()) promptEl().value = '';
      const modalEl = modal();
      if (!modalEl) return toast('局部编辑界面未加载', 'error');
      modalEl.classList.remove('hidden');
      try {
        await drawSource();
      } catch (error) {
        toast(error?.message || '无法打开图片', 'error');
        closeLocalEdit();
        return;
      }
      syncToolButtons();
      setTip('', '');
    }

    function closeLocalEdit() {
      painting = false;
      running = false;
      activeNodeId = '';
      sourceUrl = '';
      clearCanvases();
      modal()?.classList.add('hidden');
    }

    function bindUi() {
      $('localEditClose')?.addEventListener('click', closeLocalEdit);
      $('localEditCancel')?.addEventListener('click', closeLocalEdit);
      $('localEditRun')?.addEventListener('click', () => { runActiveTool().catch(() => {}); });
      $('localEditClearMask')?.addEventListener('click', clearMask);
      modal()?.querySelectorAll('[data-local-edit-tool]').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.classList.contains('is-disabled')) {
            const support = supportFor(btn.dataset.localEditTool);
            toast(support.tip || '当前模型不支持', 'warn');
            setTip(`${support.tip}：${support.detail || ''}`.trim(), 'warn');
            selectTool(btn.dataset.localEditTool);
            return;
          }
          selectTool(btn.dataset.localEditTool);
        });
      });
      $('localEditBrush')?.addEventListener('input', evt => {
        brushSize = Math.max(4, Math.min(160, Number(evt.target.value) || 28));
        const label = $('localEditBrushLabel');
        if (label) label.textContent = `${brushSize}px`;
      });
      ['localEditPadTop', 'localEditPadRight', 'localEditPadBottom', 'localEditPadLeft'].forEach(id => {
        $(id)?.addEventListener('input', () => {
          if (id === 'localEditPadTop') padUniform = Number($(id).value) || 0;
          drawOutpaintPreview();
        });
      });
      $('localEditPadUniform')?.addEventListener('click', () => {
        const v = Number($('localEditPadTop')?.value || padUniform) || 128;
        ['localEditPadTop', 'localEditPadRight', 'localEditPadBottom', 'localEditPadLeft'].forEach(id => {
          if ($(id)) $(id).value = String(v);
        });
        drawOutpaintPreview();
      });
      modal()?.querySelectorAll('[data-upscale-factor]').forEach(btn => {
        btn.addEventListener('click', () => {
          upscaleFactor = Number(btn.dataset.upscaleFactor) === 4 ? 4 : 2;
          modal().querySelectorAll('[data-upscale-factor]').forEach(el => {
            el.classList.toggle('active', Number(el.dataset.upscaleFactor) === upscaleFactor);
          });
          const targets = Core().upscaleTargets({ width: naturalW, height: naturalH });
          const hit = targets.find(item => item.factor === upscaleFactor);
          setStatus(hit ? `目标 ${Core().sizeLabel(hit.width, hit.height)}${hit.supported ? '' : `（${hit.reason}）`}` : '');
        });
      });
      $('localEditCutoutThreshold')?.addEventListener('input', evt => {
        cutoutThreshold = Math.max(8, Math.min(120, Number(evt.target.value) || 42));
        const label = $('localEditCutoutLabel');
        if (label) label.textContent = String(cutoutThreshold);
      });
      modal()?.addEventListener('click', evt => {
        if (evt.target === modal()) closeLocalEdit();
      });
    }

    bindUi();

    return {
      openLocalEdit,
      closeLocalEdit,
      selectTool,
      supportFor,
      isOpen: () => Boolean(modal() && !modal().classList.contains('hidden'))
    };
  }

  window.FutureAILocalEdit = { create };
})();
