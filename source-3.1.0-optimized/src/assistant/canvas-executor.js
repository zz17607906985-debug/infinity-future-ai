(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FutureAICanvasExecutor = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function ratioFromText(text) {
    return String(text || '').match(/\b(16\s*[:：]\s*9|9\s*[:：]\s*16|1\s*[:：]\s*1|4\s*[:：]\s*3|3\s*[:：]\s*4|21\s*[:：]\s*9|9\s*[:：]\s*21|19\s*[:：]\s*6|6\s*[:：]\s*19|3\s*[:：]\s*2|2\s*[:：]\s*3)\b/)?.[1]?.replace(/\s/g, '').replace('：', ':') || '16:9';
  }

  function videoSizeForRatio(ratio) {
    return ({
      '1:1': '1024x1024',
      '16:9': '1280x720',
      '9:16': '720x1280',
      '4:3': '1280x960',
      '3:4': '960x1280',
      '3:2': '1536x1024',
      '2:3': '1024x1536',
      '21:9': '1680x720',
      '9:21': '720x1680',
      '19:6': '1900x600',
      '6:19': '600x1900'
    })[ratio] || '1280x720';
  }

  function shotCount(text) {
    const value = String(text || '');
    const arabic = value.match(/(\d{1,2})\s*(?:个)?镜头/);
    if (arabic) return Math.max(1, Math.min(12, Number(arabic[1])));
    const chinese = {'一': 1, '两': 2, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10};
    const match = value.match(/([一两二三四五六七八九十])\s*(?:个)?镜头/);
    return match ? chinese[match[1]] : 3;
  }

  function buildProposal({text = '', center = {x: 0, y: 0}, selected = [], imageModel = '', videoModel = '', providers = [], budget = null} = {}) {
    const request = String(text || '').trim();
    if (!request) throw new Error('请先描述要在画布上完成的任务');
    const ratio = ratioFromText(request);
    const count = /镜头|短片|视频|分镜/.test(request) ? shotCount(request) : 1;
    const wantsVideo = /视频|短片|动起来|镜头/.test(request);
    const wantsImage = /图片|海报|定妆|分镜|镜头|短片|视频/.test(request);
    const selectedCharacter = selected.find(node => node.type === 'character');
    const actions = [];
    const previewNodes = [];
    const edges = [];
    const groupIds = [];
    for (let index = 0; index < count; index += 1) {
      const rowY = center.y + index * 320;
      const promptId = `draft-prompt-${index + 1}`;
      const imageId = `draft-image-${index + 1}`;
      const videoId = `draft-video-${index + 1}`;
      const shotPrompt = `${request}\n镜头 ${String(index + 1).padStart(2, '0')}：保持角色、服装、场景和光线连续，明确景别、动作、构图与情绪。`;
      actions.push({kind: 'addNode', tempId: promptId, nodeType: 'prompt', x: center.x - 430, y: rowY, data: {title: `镜头 ${index + 1} 指令`, prompt: shotPrompt}});
      previewNodes.push({id: promptId, type: 'prompt', x: center.x - 430, y: rowY, title: `镜头 ${index + 1} 指令`});
      groupIds.push(promptId);
      if (wantsImage) {
        actions.push({kind: 'addNode', tempId: imageId, nodeType: 'image', x: center.x, y: rowY - 70, data: {title: `镜头 ${index + 1} 画面`, prompt: shotPrompt, model: imageModel, aspect: ratio, resolution: '1K'}});
        edges.push({from: promptId, fromPort: 'text', to: imageId, toPort: 'prompt'});
        previewNodes.push({id: imageId, type: 'image', x: center.x, y: rowY - 70, title: `镜头 ${index + 1} · ${ratio}`});
        groupIds.push(imageId);
        if (selectedCharacter) edges.push({from: selectedCharacter.id, fromPort: 'text', to: imageId, toPort: 'prompt'});
      }
      if (wantsVideo) {
        actions.push({kind: 'addNode', tempId: videoId, nodeType: 'video', x: center.x + 590, y: rowY - 70, data: {title: `镜头 ${index + 1} 视频`, prompt: shotPrompt, model: videoModel, size: videoSizeForRatio(ratio), duration: '5', operation: wantsImage ? 'image-to-video' : 'text-to-video'}});
        edges.push({from: wantsImage ? imageId : promptId, fromPort: wantsImage ? 'image' : 'text', to: videoId, toPort: wantsImage ? 'ref' : 'prompt'});
        previewNodes.push({id: videoId, type: 'video', x: center.x + 590, y: rowY - 70, title: `镜头 ${index + 1} 视频`});
        groupIds.push(videoId);
      }
    }
    edges.forEach(edge => actions.push({kind: 'connect', ...edge}));
    actions.push({kind: 'group', tempIds: groupIds, name: `${count} 镜头 · ${ratio} · 画布助手`});
    actions.push({kind: 'prepareQueue', tempIds: groupIds.filter(id => /image|video/.test(id))});
    const requests = count * Number(wantsImage) + count * Number(wantsVideo);
    const providerWarnings = providers.length ? [] : ['尚未配置可用 API；可以先搭建画布，运行前再配置。'];
    if (!imageModel && wantsImage) providerWarnings.push('图片模型未确定，节点将跟随全局模型。');
    if (!videoModel && wantsVideo) providerWarnings.push('视频模型未确定，节点将跟随全局模型。');
    return {
      id: `assistant-plan-${Date.now()}`,
      request,
      ratio,
      shotCount: count,
      actions,
      previewNodes,
      requests,
      estimatedMinutes: {min: Math.max(1, requests), max: Math.max(2, requests * 4)},
      estimatedCost: budget || null,
      limitations: providerWarnings,
      hasPaidOperations: requests > 0,
      createdAt: Date.now()
    };
  }

  function create(deps = {}) {
    const $ = deps.$;
    const esc = deps.esc;
    const toast = deps.toast;
    let proposal = null;

    function clearPreview() {
      document.querySelectorAll('.canvas-assistant-ghost').forEach(element => element.remove());
    }

    function renderPreview() {
      clearPreview();
      const viewport = $('viewport');
      if (!viewport || !proposal) return;
      proposal.previewNodes.forEach(node => {
        const ghost = document.createElement('div');
        ghost.className = `canvas-assistant-ghost ghost-${node.type}`;
        ghost.style.transform = `translate3d(${node.x}px,${node.y}px,0)`;
        ghost.innerHTML = `<i class="fa-solid ${node.type === 'video' ? 'fa-video' : node.type === 'image' ? 'fa-image' : 'fa-note-sticky'}"></i><span>${esc(node.title)}</span>`;
        viewport.appendChild(ghost);
      });
    }

    function proposalHtml() {
      if (!proposal) return '<div class="canvas-assistant-empty">输入目标后先生成操作提案，确认前不会修改画布或调用 API。</div>';
      const kindLabel = {addNode: '新增节点', connect: '建立连线', group: '建立组合', prepareQueue: '准备队列'};
      return `<div class="canvas-assistant-summary">
        <strong>${proposal.shotCount} 个镜头 · ${esc(proposal.ratio)}</strong>
        <span>预计 ${proposal.requests} 次付费请求 · ${proposal.estimatedMinutes.min}-${proposal.estimatedMinutes.max} 分钟</span>
        <span>${proposal.estimatedCost ? esc(proposal.estimatedCost) : '模型价格不完整，运行时由费用保护再次确认'}</span>
      </div>
      <ol>${proposal.actions.map(action => `<li><b>${kindLabel[action.kind] || action.kind}</b><span>${esc(action.data?.title || action.name || (action.kind === 'connect' ? `${action.from} → ${action.to}` : `${action.tempIds?.length || 0} 项`))}</span></li>`).join('')}</ol>
      ${proposal.limitations.length ? `<div class="canvas-assistant-limits">${proposal.limitations.map(item => `<span><i class="fa-solid fa-circle-info"></i>${esc(item)}</span>`).join('')}</div>` : ''}`;
    }

    function render() {
      if ($('canvasAssistantPlan')) $('canvasAssistantPlan').innerHTML = proposalHtml();
      $('canvasAssistantApply')?.toggleAttribute('disabled', !proposal);
      renderPreview();
    }

    function plan() {
      try {
        proposal = buildProposal({
          text: $('canvasAssistantInput')?.value,
          center: deps.viewCenter?.() || {x: 0, y: 0},
          selected: [...(deps.selectedNodes?.() || [])].map(id => deps.nodes?.().get(id)).filter(Boolean),
          imageModel: deps.imageModel?.() || '',
          videoModel: deps.videoModel?.() || '',
          providers: deps.providers?.() || []
        });
        render();
        toast('操作提案已生成，画布仍未修改', 'success');
      } catch (error) {
        toast(error.message || String(error), 'warn');
      }
    }

    async function apply() {
      if (!proposal) return;
      const confirmed = await deps.openModal?.({title: '确认执行画布提案', text: `将一次性新增、配置并连接 ${proposal.previewNodes.length} 个节点。此操作可整体撤销；不会删除现有内容。`, okText: '确认执行', cancelText: '取消', confirm: true});
      if (!confirmed) return;
      const idMap = new Map();
      const created = [];
      for (const action of proposal.actions.filter(item => item.kind === 'addNode')) {
        const node = deps.addNode?.(action.nodeType, action.x, action.y, {...action.data, assistantOperationId: proposal.id}, null, false);
        if (node) { idMap.set(action.tempId, node.id); created.push(node); }
      }
      for (const action of proposal.actions.filter(item => item.kind === 'connect')) {
        deps.connectSilently?.(idMap.get(action.from) || action.from, action.fromPort, idMap.get(action.to) || action.to, action.toPort);
      }
      const groupAction = proposal.actions.find(item => item.kind === 'group');
      const groupIds = groupAction?.tempIds?.map(id => idMap.get(id)).filter(Boolean) || [];
      if (groupIds.length > 1) deps.addGroup?.(groupIds, null, groupAction.name, false, {assistantOperationId: proposal.id});
      created.filter(node => ['image', 'video'].includes(node.type)).forEach(node => {
        node.data.queuePrepared = true;
        node.data.assistantOperationLog = {id: proposal.id, request: proposal.request, actions: proposal.actions, executedAt: Date.now()};
        deps.hydrateNode?.(node);
      });
      deps.saveProject?.();
      clearPreview();
      toast('画布提案已作为一次事务执行，可撤销或重做', 'success');
      if ($('canvasAssistantRunPaid')?.checked && proposal.hasPaidOperations) {
        const paid = await deps.openModal?.({title: '单独确认付费运行', text: `将运行刚创建的 ${created.filter(node => ['image', 'video'].includes(node.type)).length} 个生成节点。每个节点仍会经过模型能力和预算保护。`, okText: '确认付费运行', cancelText: '只保留画布', confirm: true});
        if (paid) {
          for (const node of created) {
            if (node.type === 'image') await deps.runImage?.(node.id).catch(() => {});
            if (node.type === 'video') await deps.runVideo?.(node.id);
          }
        }
      }
      proposal = null;
      render();
    }

    function open() {
      $('canvasAssistantDrawer')?.classList.remove('hidden');
      $('canvasAssistantDrawer')?.setAttribute('aria-hidden', 'false');
      setTimeout(() => $('canvasAssistantInput')?.focus(), 0);
    }

    function close() {
      clearPreview();
      $('canvasAssistantDrawer')?.classList.add('hidden');
      $('canvasAssistantDrawer')?.setAttribute('aria-hidden', 'true');
    }

    $('canvasAssistantPlanBtn')?.addEventListener('click', plan);
    $('canvasAssistantApply')?.addEventListener('click', apply);
    $('closeCanvasAssistant')?.addEventListener('click', close);
    $('canvasAssistantInput')?.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') plan(); });
    $('canvasAssistantDrawer')?.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
    render();
    return {open, close, plan, apply, clearPreview, getProposal: () => proposal};
  }

  return {ratioFromText, shotCount, buildProposal, create};
});
