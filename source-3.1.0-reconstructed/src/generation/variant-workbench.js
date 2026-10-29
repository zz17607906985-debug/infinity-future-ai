(function () {
  'use strict';

  function create(deps = {}) {
    const $ = deps.$;
    const esc = deps.esc;
    const toast = deps.toast;
    const safeMediaUrl = deps.safeMediaUrl;
    const VariantManager = deps.VariantManager || window.FutureAIVariantManager;
    const Provenance = deps.Provenance || window.FutureAIProvenance;
    let activeNodeId = '';
    let compareMode = 'grid';
    let syncingVideo = false;
    let branchRunning = false;

    function hostNodes() { return deps.nodes?.() || new Map(); }
    function hostEdges() { return deps.edges?.() || []; }
    function activeNode() { return hostNodes().get(activeNodeId) || null; }

    function candidateNodes() {
      return [...hostNodes().values()].filter(node => ['image', 'video'].includes(node.type) && VariantManager.variants(node.data).length);
    }

    function selectedCandidateNode() {
      const selected = [...(deps.selectedNodes?.() || [])].map(id => hostNodes().get(id)).find(node => ['image', 'video'].includes(node?.type));
      return selected || activeNode() || candidateNodes()[0] || null;
    }

    function downstreamImpact(nodeId) {
      const seen = new Set();
      const queue = [nodeId];
      const affected = [];
      while (queue.length) {
        const source = queue.shift();
        for (const edge of hostEdges()) {
          if (edge.from !== source && edge.source !== source && edge.fromNodeId !== source) continue;
          const targetId = edge.to || edge.target || edge.toNodeId;
          if (!targetId || seen.has(targetId)) continue;
          seen.add(targetId);
          queue.push(targetId);
          const target = hostNodes().get(targetId);
          if (target?.data?.url || target?.data?.urls?.length) affected.push(target);
        }
      }
      return affected;
    }

    function nodeOptionsHtml() {
      return candidateNodes().map(node => `<option value="${esc(node.id)}" ${node.id === activeNodeId ? 'selected' : ''}>${esc(deps.nodeTitle?.(node) || node.data?.title || (node.type === 'video' ? '视频节点' : '图片节点'))}</option>`).join('');
    }

    function detailLine(label, value) {
      if (value == null || value === '') return '';
      return `<span><b>${esc(label)}</b>${esc(value)}</span>`;
    }

    function variantCard(item, node) {
      const mediaUrl = safeMediaUrl(item.url);
      const media = item.error
        ? `<div class="variant-error"><i class="fa-solid fa-triangle-exclamation"></i><span>${esc(item.error)}</span></div>`
        : item.mediaType === 'video'
          ? `<video src="${esc(mediaUrl)}" controls playsinline preload="metadata" data-variant-video></video>`
          : `<button type="button" class="variant-image-open" data-open-variant="${esc(item.id)}"><img src="${esc(mediaUrl)}" alt="候选图片"></button>`;
      const statusOptions = VariantManager.STATUSES.map(status => `<option value="${status}" ${item.status === status ? 'selected' : ''}>${esc(VariantManager.STATUS_LABELS[status])}</option>`).join('');
      const cost = item.estimatedCost?.amount != null ? `${item.estimatedCost.amount} ${item.estimatedCost.currency || ''}` : '';
      const provenance = (Array.isArray(node.data?.provenanceRecords) ? node.data.provenanceRecords : []).find(record => record?.url === item.url) || {};
      const reviewComments = (Array.isArray(node.data?.reviewComments) ? node.data.reviewComments : []).filter(comment => comment?.outputUrl === item.url || (provenance.outputId && comment?.outputId === provenance.outputId));
      const reviewHtml = reviewComments.length ? `<div class="variant-review-comments"><strong><i class="fa-solid fa-comments"></i> 审阅意见 ${reviewComments.length}</strong>${reviewComments.slice(-4).map(comment => `<p data-review-type="${esc(comment.type || 'comment')}">${comment.timeSeconds == null ? '' : `<time>${esc(Number(comment.timeSeconds).toFixed(2))}s</time>`}${esc(comment.text || '')}</p>`).join('')}</div>` : '';
      return `<article class="variant-card" data-variant-id="${esc(item.id)}" data-status="${esc(item.status)}">
        <div class="variant-media">${media}</div>
        <div class="variant-card-head"><select data-variant-status="${esc(item.id)}">${statusOptions}</select><button type="button" class="icon-btn" data-variant-replace="${esc(item.id)}" title="设为节点当前输出"><i class="fa-solid fa-trophy"></i></button></div>
        <div class="variant-details">
          ${detailLine('模型', item.model || '未记录')}
          ${detailLine('参数', Object.entries(item.parameters || {}).filter(([, value]) => value !== '' && value != null && !Array.isArray(value)).map(([key, value]) => `${key}:${value}`).join(' · '))}
          ${detailLine('耗时', item.elapsedMs ? `${(item.elapsedMs / 1000).toFixed(1)} 秒` : '')}
          ${detailLine('费用', cost)}
          ${detailLine('时长', item.actualDuration != null ? `${item.actualDuration.toFixed?.(2) || item.actualDuration} 秒` : '')}
        </div>
        ${reviewHtml}
      </article>`;
    }

    function render() {
      const node = activeNode();
      const select = $('variantNodeSelect');
      if (select) select.innerHTML = nodeOptionsHtml() || '<option value="">暂无候选版本</option>';
      const list = $('variantWorkbenchList');
      if (!list) return;
      if (!node) {
        list.innerHTML = '<div class="variant-empty">先生成图片或视频，候选结果会在这里集中对比。</div>';
        return;
      }
      VariantManager.ensureCurrentOutput(node.data, node.type);
      const variants = VariantManager.variants(node.data);
      list.className = `variant-workbench-list mode-${compareMode}`;
      list.innerHTML = variants.map(item => variantCard(item, node)).join('') || '<div class="variant-empty">当前节点还没有候选版本。</div>';
      document.querySelectorAll('[data-variant-mode]').forEach(button => button.classList.toggle('active', button.dataset.variantMode === compareMode));
      const impact = downstreamImpact(node.id);
      if ($('variantImpactSummary')) $('variantImpactSummary').textContent = impact.length ? `更换胜出版本会影响 ${impact.length} 个已有下游输出，旧结果会保留。` : '当前没有已生成的下游输出。';
      bindVideoSync();
      fillBranchDefaults(node);
    }

    function fillBranchDefaults(node) {
      const defaults = {
        variantBranchModels: node.data.model || '',
        variantBranchPrompts: node.data.prompt || '',
        variantBranchSeeds: node.type === 'image' ? (node.data.seed || '') : '',
        variantBranchAspects: node.type === 'image' ? (node.data.aspect || '') : '',
        variantBranchDurations: node.type === 'video' ? (node.data.duration || '') : ''
      };
      Object.entries(defaults).forEach(([id, value]) => {
        const input = $(id);
        if (input && !input.dataset.touched) input.value = value;
      });
      $('variantBranchSeeds')?.closest('label')?.classList.toggle('hidden', node.type !== 'image');
      $('variantBranchAspects')?.closest('label')?.classList.toggle('hidden', node.type !== 'image');
      $('variantBranchDurations')?.closest('label')?.classList.toggle('hidden', node.type !== 'video');
    }

    function bindVideoSync() {
      const videos = [...document.querySelectorAll('#variantWorkbenchList [data-variant-video]')];
      const sync = (source, kind) => {
        if (syncingVideo) return;
        syncingVideo = true;
        for (const video of videos) {
          if (video === source) continue;
          if (kind === 'time' && Number.isFinite(source.currentTime) && Math.abs(video.currentTime - source.currentTime) > .04) video.currentTime = Math.min(source.currentTime, video.duration || source.currentTime);
          if (kind === 'play') video.play().catch(() => {});
          if (kind === 'pause') video.pause();
        }
        syncingVideo = false;
      };
      videos.forEach(video => {
        video.addEventListener('play', () => sync(video, 'play'));
        video.addEventListener('pause', () => sync(video, 'pause'));
        video.addEventListener('seeked', () => sync(video, 'time'));
      });
    }

    function open(nodeId = '') {
      const node = nodeId ? hostNodes().get(nodeId) : selectedCandidateNode();
      if (node) activeNodeId = node.id;
      const drawer = $('variantWorkbenchDrawer');
      drawer?.classList.remove('hidden');
      drawer?.setAttribute('aria-hidden', 'false');
      render();
      setTimeout(() => $('variantNodeSelect')?.focus(), 0);
    }

    function close() {
      $('variantWorkbenchDrawer')?.classList.add('hidden');
      $('variantWorkbenchDrawer')?.setAttribute('aria-hidden', 'true');
      pauseAll();
    }

    function pauseAll() {
      document.querySelectorAll('#variantWorkbenchList video').forEach(video => video.pause());
    }

    async function replaceVariant(variantId) {
      const node = activeNode();
      if (!node) return;
      const impact = downstreamImpact(node.id);
      if (impact.length) {
        const ok = await deps.openModal?.({
          title: '确认更换上游版本',
          text: `已有 ${impact.length} 个下游节点生成过内容。更换后旧输出不会删除，但下游需要重新确认或重新生成。`,
          okText: '保留旧结果并更换',
          cancelText: '取消',
          confirm: true
        });
        if (!ok) return;
      }
      const result = VariantManager.replaceWithVariant(node.data, variantId);
      node.data.downstreamImpact = impact.map(item => ({nodeId: item.id, outputUrl: item.data.url || '', detectedAt: Date.now()}));
      Provenance?.updateApproval(node.data, result.winner.url, result.winner.status);
      deps.hydrateNode?.(node);
      deps.refreshDownstream?.(node.id);
      deps.saveProject?.();
      toast('已替换为胜出版本，可使用撤销恢复', 'success');
      render();
    }

    function setVariantStatus(variantId, status) {
      const node = activeNode();
      if (!node) return;
      const item = VariantManager.setStatus(node.data, variantId, status);
      if (item?.url) Provenance?.updateApproval(node.data, item.url, status);
      deps.saveProject?.();
      render();
    }

    function lineValues(id) {
      return String($(id)?.value || '').split(/\r?\n|[,，]/).map(value => value.trim()).filter(Boolean);
    }

    function referenceSets(node) {
      const refs = Array.isArray(node.data.references) ? node.data.references.filter(item => item?.url) : [];
      if (!refs.length || $('variantBranchReferenceMode')?.value !== 'each') return [refs];
      return refs.map(item => [item]);
    }

    async function runBranches() {
      if (branchRunning) return;
      const node = activeNode();
      if (!node) return toast('请选择图片或视频节点', 'warn');
      const specs = VariantManager.branchSpecs({
        models: lineValues('variantBranchModels'),
        prompts: lineValues('variantBranchPrompts'),
        seeds: lineValues('variantBranchSeeds'),
        aspects: lineValues('variantBranchAspects'),
        durations: lineValues('variantBranchDurations'),
        referenceSets: referenceSets(node),
        max: Math.max(1, Math.min(12, Number($('variantBranchMax')?.value || 6)))
      });
      const ok = await deps.openModal?.({title: '创建候选分支', text: `将顺序运行 ${specs.length} 个候选请求。每个请求都会经过费用保护，完成结果不会覆盖旧版本。`, okText: '开始生成', cancelText: '取消', confirm: true});
      if (!ok) return;
      const original = JSON.parse(JSON.stringify(node.data));
      branchRunning = true;
      $('variantRunBranches')?.setAttribute('disabled', 'disabled');
      let completed = 0;
      try {
        for (const spec of specs) {
          if (spec.model) node.data.model = spec.model;
          if (spec.prompt) node.data.prompt = spec.prompt;
          if (node.type === 'image' && spec.seed) node.data.seed = spec.seed;
          if (node.type === 'image' && spec.aspect) node.data.aspect = spec.aspect;
          if (node.type === 'video' && spec.duration) node.data.duration = spec.duration;
          if (Array.isArray(spec.references)) node.data.references = spec.references;
          deps.hydrateNode?.(node);
          const success = node.type === 'video' ? await deps.runVideo?.(node.id) : await deps.runImage?.(node.id);
          if (success !== false) completed += 1;
          render();
        }
      } finally {
        const variants = node.data.variants || [];
        const provenanceRecords = node.data.provenanceRecords || [];
        Object.assign(node.data, original, {variants, provenanceRecords});
        deps.hydrateNode?.(node);
        deps.saveProject?.();
        branchRunning = false;
        $('variantRunBranches')?.removeAttribute('disabled');
      }
      toast(`候选分支完成：${completed}/${specs.length}`, completed ? 'success' : 'warn');
      render();
    }

    function stepVideo(direction) {
      const videos = [...document.querySelectorAll('#variantWorkbenchList [data-variant-video]')];
      const source = videos[0];
      if (!source) return;
      source.pause();
      source.currentTime = Math.max(0, Math.min(source.duration || Infinity, source.currentTime + direction / 30));
      videos.slice(1).forEach(video => { video.pause(); video.currentTime = source.currentTime; });
    }

    function bind() {
      $('closeVariantWorkbench')?.addEventListener('click', close);
      $('variantNodeSelect')?.addEventListener('change', event => { activeNodeId = event.target.value; render(); });
      document.querySelectorAll('[data-variant-mode]').forEach(button => button.addEventListener('click', () => { compareMode = button.dataset.variantMode; render(); }));
      $('variantFramePrev')?.addEventListener('click', () => stepVideo(-1));
      $('variantFrameNext')?.addEventListener('click', () => stepVideo(1));
      $('variantRunBranches')?.addEventListener('click', runBranches);
      ['variantBranchModels', 'variantBranchPrompts', 'variantBranchSeeds', 'variantBranchAspects', 'variantBranchDurations'].forEach(id => $(id)?.addEventListener('input', event => { event.target.dataset.touched = '1'; }));
      $('variantWorkbenchList')?.addEventListener('change', event => {
        const select = event.target.closest('[data-variant-status]');
        if (select) setVariantStatus(select.dataset.variantStatus, select.value);
      });
      $('variantWorkbenchList')?.addEventListener('click', event => {
        const replace = event.target.closest('[data-variant-replace]');
        const openButton = event.target.closest('[data-open-variant]');
        if (replace) replaceVariant(replace.dataset.variantReplace);
        if (openButton) {
          const item = VariantManager.variants(activeNode()?.data || {}).find(value => value.id === openButton.dataset.openVariant);
          if (item?.url) deps.openMedia?.(item.url, 'image');
        }
      });
      $('variantWorkbenchDrawer')?.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
    }

    bind();
    return {open, close, render, downstreamImpact, runBranches};
  }

  window.FutureAIVariantWorkbench = {create};
})();
