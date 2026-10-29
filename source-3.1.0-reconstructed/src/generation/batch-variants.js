(function () {
  'use strict';

  function create(deps = {}) {
    const $ = deps.$;
    const toast = deps.toast || (() => {});
    const Core = () => deps.Core || window.FutureAIBatchVariantsCore;
    let activeNodeId = '';
    let running = false;
    let mode = 'same';
    let count = Core().DEFAULT_COUNT;
    let selectedStyles = ['realistic', 'anime'];
    let selectedAspects = ['1:1', '16:9'];
    let useSourceImage = false;
    let bound = false;

    function nodeById(id) {
      return typeof deps.getNode === 'function' ? deps.getNode(id) : null;
    }

    function modal() { return $('batchVariantsModal'); }
    function tipEl() { return $('batchVariantsTip'); }
    function statusEl() { return $('batchVariantsStatus'); }
    function summaryEl() { return $('batchVariantsSummary'); }
    function runBtn() { return $('batchVariantsRun'); }

    function setTip(text, kind = '') {
      const el = tipEl();
      if (!el) return;
      el.textContent = text || '';
      el.classList.toggle('is-warn', kind === 'warn');
      el.classList.toggle('is-error', kind === 'error');
    }

    function setStatus(text) {
      const el = statusEl();
      if (el) el.textContent = text || '准备就绪';
    }

    function supportFor(node) {
      if (!node) return { supported: false, tip: '节点不存在' };
      if (typeof deps.resolveImageCapability === 'function') {
        const cap = deps.resolveImageCapability(node) || {};
        const ops = Array.isArray(cap.operations) ? cap.operations : [];
        const canGenerate = !ops.length || ops.includes('generate') || ops.includes('edit');
        return Core().supportTip({
          hasProvider: Boolean(cap.provider),
          canGenerate,
          hasKey: cap.hasUsableKey !== false,
          nodeType: node.type
        });
      }
      return Core().supportTip({ hasProvider: true, canGenerate: true, nodeType: node.type });
    }

    function syncChips() {
      document.querySelectorAll('[data-batch-count]').forEach(btn => {
        btn.classList.toggle('active', Number(btn.dataset.batchCount) === count);
      });
      document.querySelectorAll('[data-batch-mode]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.batchMode === mode);
      });
      document.querySelectorAll('[data-batch-style]').forEach(btn => {
        btn.classList.toggle('active', selectedStyles.includes(btn.dataset.batchStyle));
      });
      document.querySelectorAll('[data-batch-aspect]').forEach(btn => {
        btn.classList.toggle('active', selectedAspects.includes(btn.dataset.batchAspect));
      });
      const stylePane = $('batchVariantsStylePane');
      const aspectPane = $('batchVariantsAspectPane');
      stylePane?.classList.toggle('hidden', mode !== 'style');
      aspectPane?.classList.toggle('hidden', mode !== 'aspect');
      // Style/ratio modes create one node per selected chip; the count picker does not apply.
      $('batchVariantsCountPane')?.classList.toggle('hidden', mode !== 'same');
      const note = $('batchVariantsCountNote');
      if (note) {
        note.classList.toggle('hidden', mode === 'same');
        const n = Core().plannedCount({ mode, count, styles: selectedStyles, aspects: selectedAspects });
        note.textContent = mode === 'style'
          ? `将生成 ${n} 张：每个所选风格一张（最多 4）`
          : mode === 'aspect' ? `将生成 ${n} 张：每个所选比例一张（最多 4）` : '';
      }
      const useImg = $('batchVariantsUseSource');
      if (useImg) useImg.checked = useSourceImage;
    }

    function refreshSummary(node) {
      if (!node) return;
      const support = supportFor(node);
      if (!support.supported) {
        if (summaryEl()) summaryEl().innerHTML = `<strong>${escapeHtml(support.tip)}</strong>`;
        setTip(support.tip, 'warn');
        if (runBtn()) runBtn().disabled = true;
        return;
      }
      const promptEl = $('batchVariantsPrompt');
      const built = Core().buildSpecs({
        count,
        mode,
        prompt: promptEl ? String(promptEl.value || '') : (node.data?.prompt || ''),
        aspect: node.data?.aspect || '16:9',
        size: node.data?.size || '',
        model: node.data?.model || '',
        resolution: node.data?.resolution || '1K',
        styles: selectedStyles,
        aspects: selectedAspects,
        seed: node.data?.seed || '',
        useSourceImage,
        sourceUrl: node.data?.url || '',
        canGenerate: true
      });
      if (summaryEl()) {
        const lines = built.specs.map(spec => String(spec.label || '批量'));
        summaryEl().innerHTML = lines.length
          ? `<strong>将新建 ${lines.length} 个节点</strong><ul>${lines.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
          : `<strong>${escapeHtml(built.tip || '暂无规格')}</strong>`;
      }
      setTip(built.unsupported ? built.tip : (built.tip || ''), built.unsupported ? 'warn' : (built.specs.length ? '' : 'warn'));
      const btn = runBtn();
      if (btn) btn.disabled = running || !built.specs.length || built.unsupported;
    }

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
    }

    function shortReason(err) {
      const diag = typeof deps.diagnoseGenerationError === 'function' ? deps.diagnoseGenerationError(err, {}) : null;
      if (diag?.summary) return diag.summary;
      return String(err?.message || err || '').split(/\n/)[0];
    }

    function discardNodes(ids) {
      for (const id of ids || []) {
        try { deps.deleteNode?.(id, false); } catch (_) {}
      }
      try { deps.drawEdges?.(); } catch (_) {}
      try { deps.scheduleDrawEdges?.(); } catch (_) {}
    }

    async function runBatch() {
      if (running) return;
      const source = nodeById(activeNodeId);
      if (!source) return;
      const support = supportFor(source);
      if (!support.supported) {
        // Pre-check (e.g. no API key): block before any node is created.
        setTip(support.tip, 'warn');
        toast(support.tip || '当前模型不支持', 'warn');
        if (runBtn()) runBtn().disabled = true;
        return;
      }
      const batchId = `batch-${Date.now()}`;
      // Modal prompt is preview-only: never write it back onto the source node.
      const promptEl = $('batchVariantsPrompt');
      const runPrompt = promptEl ? String(promptEl.value || '') : String(source.data?.prompt || '');
      const built = Core().buildSpecs({
        count,
        mode,
        prompt: runPrompt,
        aspect: source.data?.aspect || '16:9',
        size: source.data?.size || '',
        model: source.data?.model || '',
        resolution: source.data?.resolution || '1K',
        styles: selectedStyles,
        aspects: selectedAspects,
        seed: source.data?.seed || '',
        useSourceImage,
        sourceUrl: source.data?.url || '',
        canGenerate: true
      });
      if (!built.specs.length) {
        setTip(built.tip || '无法开始批量', 'warn');
        toast(built.tip || '无法开始批量', 'warn');
        return;
      }

      running = true;
      syncChips();
      if (runBtn()) runBtn().disabled = true;
      const before = Core().snapshotSourceIdentity(source.data || {});
      const createdIds = [];
      setStatus(`正在创建 ${built.specs.length} 个结果节点…`);

      try {
        const size = typeof deps.nodeSize === 'function' ? deps.nodeSize(source) : { width: 280, height: 320 };
        for (const spec of built.specs) {
          spec.batchId = batchId;
          const wireSource = Boolean(spec.useSourceImage && source.data?.url);
          const carried = Core().carriedReferences(source.data || {}, wireSource ? source.id : '');
          const seed = Core().buildResultNodeSeed(source.data || {}, spec, carried);
          const place = Core().resultRowPlacement(source, size, spec.index, built.specs.length);
          const next = deps.addNode('image', place.x, place.y, seed, null, false);
          if (!next?.id) throw new Error('无法创建结果节点');
          createdIds.push(next.id);
          if (wireSource && !deps.connectSilently?.(source.id, 'image', next.id, 'ref')) throw new Error('无法连接结果节点到原图');
          copyUpstreamReferences(source.id, next.id);
          deps.hydrateNode?.(next);
        }

        // One undo step for the whole strip of new nodes (+ optional wires).
        deps.saveProject?.();

        const after = Core().snapshotSourceIdentity(source.data || {});
        if (!Core().identitiesMatch(before, after)) {
          throw new Error('原节点在批量创建时被改动，已中止');
        }

        closeModal();

        // Enqueue each result node (count=1). Overlapping spend tickets → one combined flash.
        const enqueue = deps.enqueueImageGeneration;
        if (typeof enqueue !== 'function') {
          setStatus('节点已创建，但缺少生成队列');
          toast('节点已创建。请手动点生成。', 'warn');
          return;
        }
        setStatus(`正在排队生成 0/${createdIds.length}…`);
        let done = 0;
        let failed = 0;
        let firstReason = '';
        const failedIds = [];
        const total = createdIds.length;
        // Parallel enqueue; the queue enforces per-provider concurrency. Per-node toasts are muted
        // (quiet) so the whole batch ends with exactly one toast.
        const tasks = createdIds.map(async id => {
          try {
            const ok = await enqueue(id, { quiet: true });
            if (ok === false) throw new Error('生成未完成');
            done += 1;
          } catch (err) {
            failed += 1;
            failedIds.push(id);
            if (!firstReason) firstReason = shortReason(err);
            console.warn('batch variant failed', id, err);
          }
          setStatus(`批量进度 ${done + failed}/${total}` + (failed ? `（失败 ${failed}）` : ''));
        });
        await Promise.allSettled(tasks);
        // Failed nodes without any image are removed (like local-edit discarding its pending node).
        const emptyFailed = failedIds.filter(id => {
          const n = nodeById(id);
          return n && !n.data?.url && !(Array.isArray(n.data?.urls) && n.data.urls.some(Boolean));
        });
        if (emptyFailed.length) {
          discardNodes(emptyFailed);
          deps.saveProject?.();
        }
        const summary = Core().batchSummaryToast({ total, done, failed, reason: firstReason });
        toast(summary.text, summary.level);
        setStatus(summary.text);
        const keep = createdIds.find(id => !emptyFailed.includes(id) && nodeById(id));
        if (keep) deps.selectSingleNode?.(keep);
        else deps.selectSingleNode?.(source.id);
      } catch (error) {
        discardNodes(createdIds);
        const msg = error?.message || String(error);
        setStatus('批量失败');
        setTip(msg, 'error');
        toast(`批量失败：\n${msg}`, 'error');
      } finally {
        running = false;
        if (runBtn()) runBtn().disabled = false;
        syncChips();
      }
    }

    function openBatchVariants(node) {
      const target = node || nodeById(activeNodeId);
      if (!target || target.type !== 'image') {
        toast('请先选中一个图片节点', 'warn');
        return;
      }
      activeNodeId = target.id;
      const support = supportFor(target);
      const title = $('batchVariantsTitle');
      if (title) title.textContent = deps.nodeDisplayTitle?.(target) || target.data?.title || '图片节点';
      useSourceImage = Boolean(target.data?.url);
      const promptEl = $('batchVariantsPrompt');
      if (promptEl) promptEl.value = String(target.data?.prompt || '');
      const modalEl = modal();
      if (!modalEl) return toast('批量界面未加载', 'error');
      modalEl.classList.remove('hidden');
      modalEl.setAttribute('aria-hidden', 'false');
      syncChips();
      refreshSummary(target);
      setStatus(support.supported ? '准备就绪' : support.tip);
      setTimeout(() => $('batchVariantsPrompt')?.focus(), 0);
    }

    function closeModal() {
      const modalEl = modal();
      if (!modalEl) return;
      modalEl.classList.add('hidden');
      modalEl.setAttribute('aria-hidden', 'true');
      activeNodeId = activeNodeId;
    }

    function pickContinue(node) {
      if (!node?.id) return null;
      Core().markPicked(node.data || {}, node.data?.batchResult?.batchId || '');
      // Clear pick mark on siblings of the same batch.
      const batchId = node.data?.batchResult?.batchId || node.data?.batchPick?.batchId || '';
      if (batchId && typeof deps.getNodes === 'function') {
        for (const other of deps.getNodes() || []) {
          if (other.id === node.id) continue;
          if (other.data?.batchResult?.batchId === batchId || other.data?.batchPick?.batchId === batchId) {
            Core().clearPick(other.data);
            deps.hydrateNode?.(other);
          }
        }
      }
      deps.hydrateNode?.(node);
      deps.selectSingleNode?.(node.id);
      deps.saveProject?.();
      toast('已选用这张，可继续连到下游（其他结果仍保留）', 'success');
      return node;
    }

    /** Re-wire the source node's upstream input edges (`ref` for image/video, `media` for media tools) onto the copy. */
    function copyUpstreamReferences(sourceId, targetId, port = 'ref') {
      const upstream = (typeof deps.getEdges === 'function' ? deps.getEdges() : []).filter(edge => edge.to === sourceId && edge.toPort === port);
      for (const edge of upstream) deps.connectSilently?.(edge.from, edge.fromPort, targetId, port);
    }

    function sizeOf(node) {
      return typeof deps.nodeSize === 'function' ? deps.nodeSize(node) : { width: 280, height: 320 };
    }

    /** Add a `type` node in the first free slot right of `source` (never overlapping another node). */
    function spawnRight(source, type, seed) {
      if (typeof deps.addNode !== 'function') throw new Error('缺少 addNode');
      const occupied = (typeof deps.getNodes === 'function' ? deps.getNodes() : [])
        .filter(other => other && other.id !== source.id)
        .map(other => Object.assign({ x: Number(other.x) || 0, y: Number(other.y) || 0 }, sizeOf(other)));
      const place = Core().freeSlotRight(source, sizeOf(source), occupied);
      const next = deps.addNode(type, place.x, place.y, seed, null, false);
      if (!next?.id) throw new Error('无法创建新节点');
      return next;
    }

    function hasOutput(node) {
      return Boolean(node && (node.data?.url || (Array.isArray(node.data?.urls) && node.data.urls.some(Boolean))));
    }

    /**
     * Run `run(newNode)` on a fresh copy right of `source`. The source is never written;
     * if the run produces nothing the copy is removed. Exactly one toast either way.
     */
    async function runOnNewNode(source, { type, seed, port = 'ref', run, label, noun }) {
      const before = Core().snapshotSourceIdentity(source.data || {});
      const next = spawnRight(source, type, seed);
      copyUpstreamReferences(source.id, next.id, port);
      deps.hydrateNode?.(next);
      deps.selectSingleNode?.(next.id);
      deps.saveProject?.();
      let ok = false;
      let reason = '';
      try {
        ok = (await run(next)) !== false;
        if (!ok) reason = '生成未完成';
      } catch (err) {
        reason = shortReason(err);
        console.warn(`${label} failed`, next.id, err);
      }
      const after = Core().snapshotSourceIdentity(source.data || {});
      if (!Core().identitiesMatch(before, after)) console.warn(`${label}: source identity changed unexpectedly`);
      const result = nodeById(next.id);
      if (ok && hasOutput(result)) {
        toast(`${label}完成：新结果在右侧新节点，原${noun}保留`, 'success');
        return result;
      }
      if (result?.data?.videoTask) {
        // A paid video task is still running remotely: keep the new node so it can be queried later.
        toast(`${label}仍在进行：右侧新节点已保留，可点「继续查询视频」；原${noun}未改动`, 'warn');
        return result;
      }
      if (!reason || reason === '生成未完成') reason = result?.data?.statusType === 'error' && result.data.status ? result.data.status : reason;
      if (result) {
        discardNodes([next.id]);
        deps.saveProject?.();
        deps.selectSingleNode?.(source.id);
      }
      const why = String(reason || '').split(/\n/)[0].trim().slice(0, 60);
      toast(`${label}失败${why ? `：${why}` : ''}（新节点已移除，原${noun}未改动）`, 'error');
      return null;
    }

    /** Spawn a working node from the active url on a multi-variant image node. */
    function pickVariantSpawn(node, url) {
      if (!node || !url) return null;
      if (typeof deps.addNode !== 'function') throw new Error('缺少 addNode');
      const before = Core().snapshotSourceIdentity(node.data || {});
      const wireSource = Boolean(node.data?.url || (Array.isArray(node.data?.urls) && node.data.urls.length));
      const seed = Core().buildPickSpawnSeed(node.data || {}, url, Core().carriedReferences(node.data || {}, wireSource ? node.id : ''));
      const size = typeof deps.nodeSize === 'function' ? deps.nodeSize(node) : { width: 280, height: 320 };
      const place = Core().resultRowPlacement(node, size, 0, 1);
      const next = deps.addNode('image', place.x, place.y, seed, null, false);
      if (!next?.id) throw new Error('无法创建选用节点');
      if (wireSource) deps.connectSilently?.(node.id, 'image', next.id, 'ref');
      copyUpstreamReferences(node.id, next.id);
      // Apply the picked media onto the new node (seed already has url).
      next.data.url = url;
      next.data.urls = [url];
      deps.hydrateNode?.(next);
      deps.selectSingleNode?.(next.id);
      deps.saveProject?.();
      const after = Core().snapshotSourceIdentity(node.data || {});
      if (!Core().identitiesMatch(before, after)) {
        console.warn('pickVariantSpawn: source identity changed unexpectedly');
      }
      toast('已选用并新建节点，原节点变体保留', 'success');
      return next;
    }

    /** 「重新生成」 on an image node that already has output: run on a new node to the right, keep the source. */
    async function regenerateAsNew(source, overrides = {}) {
      if (!source?.id || source.type !== 'image') return null;
      const support = supportFor(source);
      if (!support.supported) {
        toast(support.tip || '当前模型不支持', 'warn');
        return null;
      }
      if (typeof deps.enqueueImageGeneration !== 'function') throw new Error('缺少生成队列');
      const seed = Object.assign(Core().buildRegenerateSeed(source.data || {}, Core().carriedReferences(source.data || {}, '')), overrides);
      return runOnNewNode(source, { type: 'image', seed, run: next => deps.enqueueImageGeneration(next.id, { quiet: true }), label: '重新生成', noun: '图' });
    }

    /** Video / media-tool rerun on a node that already has a result: same settings on a new node to the right. */
    async function rerunAsNew(source, { run, label, noun, port = 'ref' }) {
      if (!source?.id) return null;
      return runOnNewNode(source, { type: source.type, seed: Core().freshCopySeed(source.data || {}, label), port, run, label, noun });
    }

    /** Put a finished image (crop / edit result) on a new node to the right, wired from the source; the source stays as is. */
    function addResultNode(source, url, suffix) {
      const seed = Core().buildPickSpawnSeed(source.data || {}, url, Core().carriedReferences(source.data || {}, source.id));
      const baseTitle = String(source.data?.title || source.data?.name || '').trim();
      seed.title = baseTitle ? `${baseTitle} · ${suffix}` : suffix;
      delete seed.batchPick;
      seed.tags = [];
      const next = spawnRight(source, 'image', seed);
      deps.connectSilently?.(source.id, source.type === 'upload' ? 'media' : 'image', next.id, 'ref');
      deps.hydrateNode?.(next);
      deps.selectSingleNode?.(next.id);
      deps.drawEdges?.();
      deps.saveProject?.();
      return next;
    }

    function bind() {
      if (bound) return;
      bound = true;
      $('batchVariantsClose')?.addEventListener('click', closeModal);
      $('batchVariantsCancel')?.addEventListener('click', closeModal);
      $('batchVariantsRun')?.addEventListener('click', () => { runBatch().catch(() => {}); });
      document.querySelectorAll('[data-batch-count]').forEach(btn => {
        btn.addEventListener('click', () => {
          count = Core().clampCount(btn.dataset.batchCount);
          syncChips();
          refreshSummary(nodeById(activeNodeId));
        });
      });
      document.querySelectorAll('[data-batch-mode]').forEach(btn => {
        btn.addEventListener('click', () => {
          mode = Core().normalizeMode(btn.dataset.batchMode);
          syncChips();
          refreshSummary(nodeById(activeNodeId));
        });
      });
      document.querySelectorAll('[data-batch-style]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.batchStyle;
          if (selectedStyles.includes(id)) selectedStyles = selectedStyles.filter(item => item !== id);
          else selectedStyles = [...selectedStyles, id].slice(0, Core().MAX_COUNT);
          if (!selectedStyles.length) selectedStyles = [id];
          syncChips();
          refreshSummary(nodeById(activeNodeId));
        });
      });
      document.querySelectorAll('[data-batch-aspect]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.batchAspect;
          if (selectedAspects.includes(id)) selectedAspects = selectedAspects.filter(item => item !== id);
          else selectedAspects = [...selectedAspects, id].slice(0, Core().MAX_COUNT);
          if (!selectedAspects.length) selectedAspects = [id];
          syncChips();
          refreshSummary(nodeById(activeNodeId));
        });
      });
      $('batchVariantsUseSource')?.addEventListener('change', evt => {
        useSourceImage = Boolean(evt.target.checked);
        refreshSummary(nodeById(activeNodeId));
      });
      $('batchVariantsPrompt')?.addEventListener('input', () => {
        // Preview only — the source node is never written.
        refreshSummary(nodeById(activeNodeId));
      });
      modal()?.addEventListener('click', evt => {
        if (evt.target === modal()) closeModal();
      });
    }

    bind();

    return {
      openBatchVariants,
      closeBatchVariants: closeModal,
      pickContinue,
      pickVariantSpawn,
      regenerateAsNew,
      rerunAsNew,
      addResultNode,
      spawnRight,
      hasOutput,
      supportFor
    };
  }

  window.FutureAIBatchVariants = { create };
})();
