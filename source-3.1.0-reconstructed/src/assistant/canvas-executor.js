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
      kind: 'build',
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

  const LAYOUTS = ['grid', 'type', 'group', 'order', 'tidy', 'align-left', 'align-top', 'distribute-h', 'distribute-v'];
  const LAYOUT_LABELS = {
    grid: '网格排列', type: '按类型分行', group: '按组合分行', order: '按创建顺序', tidy: '消除重叠',
    'align-left': '左对齐', 'align-top': '顶部对齐', 'distribute-h': '水平等距分布', 'distribute-v': '垂直等距分布'
  };
  const ALIGN_LAYOUTS = new Set(['align-left', 'align-top', 'distribute-h', 'distribute-v']);
  const MEDIA_TYPES = ['image', 'video'];
  const GAP = 48;

  // The chat model only picks one of these actions; the executor computes every change locally.
  const INTENT_PROMPT = [
    '你是无限画布的操作规划器。只输出一个 JSON 对象，不要解释。',
    '格式：{"action":"build|arrange|export|snapshot|batch_generate","scope":"selection|all","layout":"' + LAYOUTS.join('|') + '","format":"folder|zip","mediaTypes":["image","video"],"count":2}',
    'build：新建节点/镜头/短片/分镜/生成流程。',
    'arrange：整理、排整齐、对齐、分布、按类型或组合排列、消除重叠，只移动已有节点。layout：网格=grid，按类型=type，按组合=group，按创建顺序=order，消除重叠=tidy，左对齐=align-left，顶部对齐=align-top，水平分布=distribute-h，垂直分布=distribute-v；未指明用 grid。',
    'export：导出、保存、打包图片或视频文件。format：提到 zip/压缩/打包用 zip，否则 folder。mediaTypes：只提图片用 ["image"]，只提视频用 ["video"]，否则两者都要。',
    'snapshot：导出画布快照 PNG（整板或选中区域的俯视图），不是导出单个媒体文件。',
    'batch_generate：为选中（或指定数量）的图片节点排队生成变体；count 为每个源图的变体数（1-8，默认 2）。',
    'scope：用户说“这些/选中/所选”且有选中节点时用 selection；说“全部/整个画布/所有”用 all；未说明时有选中用 selection，否则 all。'
  ].join('\n');

  function intentFromText(text, {hasSelection = false} = {}) {
    const value = String(text || '');
    const wantsAll = /全部|整个|所有|全画布|whole|all/i.test(value);
    const scope = hasSelection && !wantsAll ? 'selection' : 'all';
    if (/批量(?:生成)?变体|变体\s*\d|batch[_\s-]?generate|generate\s*variants?/i.test(value)) {
      const countMatch = value.match(/(\d+)\s*张|变体\s*(\d+)|count\s*[=:]\s*(\d+)/i);
      const count = Math.min(Math.max(Number((countMatch || []).slice(1).find(Boolean) || 2) || 2, 1), 8);
      return {action: 'batch_generate', scope: hasSelection ? 'selection' : scope, count};
    }
    if (/快照|截图画布|导出画布|画布PNG|canvas\s*snapshot|snapshot/i.test(value)) {
      return {action: 'snapshot', scope};
    }
    if (/导出|另存|保存到|打包|export/i.test(value)) {
      const image = /图片|图像|照片|画面|image/i.test(value);
      const video = /视频|短片|video/i.test(value);
      return {action: 'export', scope, format: /zip|压缩|打包/i.test(value) ? 'zip' : 'folder', mediaTypes: image === video ? MEDIA_TYPES : [image ? 'image' : 'video']};
    }
    if (/排(?:整齐|列|版|好|一下)|整理|对齐|分布|布局|摆放|网格|重叠|tidy|arrange|align/i.test(value)) {
      const layout = /左对齐/.test(value) ? 'align-left'
        : /(?:顶部?|上)对齐/.test(value) ? 'align-top'
          : /(?:水平|横向)(?:等距)?分布/.test(value) ? 'distribute-h'
            : /(?:垂直|纵向)(?:等距)?分布/.test(value) ? 'distribute-v'
              : /重叠|叠在一起/.test(value) ? 'tidy'
                : /类型|分类/.test(value) ? 'type'
                  : /组合|分组|按组/.test(value) ? 'group'
                    : /顺序|创建|先后/.test(value) ? 'order' : 'grid';
      return {action: 'arrange', scope, layout};
    }
    return {action: 'build', scope};
  }

  function normalizeIntent(raw, fallback) {
    if (!raw || !['build', 'arrange', 'export', 'snapshot', 'batch_generate'].includes(raw.action)) return fallback;
    const scope = raw.scope === 'selection' || raw.scope === 'all' ? raw.scope : fallback.scope;
    if (raw.action === 'arrange') return {action: 'arrange', scope, layout: LAYOUTS.includes(raw.layout) ? raw.layout : 'grid'};
    if (raw.action === 'export') {
      const mediaTypes = (Array.isArray(raw.mediaTypes) ? raw.mediaTypes : []).filter(type => MEDIA_TYPES.includes(type));
      return {action: 'export', scope, format: raw.format === 'zip' ? 'zip' : 'folder', mediaTypes: mediaTypes.length ? [...new Set(mediaTypes)] : MEDIA_TYPES};
    }
    if (raw.action === 'snapshot') return {action: 'snapshot', scope};
    if (raw.action === 'batch_generate') {
      const count = Math.min(Math.max(Number(raw.count) || fallback.count || 2, 1), 8);
      return {action: 'batch_generate', scope, count};
    }
    return {action: 'build', scope};
  }

  function typeRank(type) {
    return {prompt: 0, character: 0, upload: 1, comfyui: 2, image: 3, video: 4}[type] ?? 5;
  }

  function placeRows(rows, origin) {
    const placed = [];
    let y = origin.y;
    rows.forEach(row => {
      let x = origin.x;
      row.forEach(item => {
        placed.push({id: item.id, x, y});
        x += item.width + GAP;
      });
      y += Math.max(...row.map(item => item.height)) + GAP;
    });
    return placed;
  }

  function placeGrid(items, origin) {
    const columns = Math.max(1, Math.ceil(Math.sqrt(items.length)));
    const widths = Array.from({length: columns}, (_, column) => Math.max(0, ...items.filter((_, index) => index % columns === column).map(item => item.width)));
    const placed = [];
    let y = origin.y;
    for (let start = 0; start < items.length; start += columns) {
      const row = items.slice(start, start + columns);
      let x = origin.x;
      row.forEach((item, column) => {
        placed.push({id: item.id, x, y});
        x += widths[column] + GAP;
      });
      y += Math.max(...row.map(item => item.height)) + GAP;
    }
    return placed;
  }

  function overlaps(a, b) {
    return a.x < b.x + b.width + GAP && b.x < a.x + a.width + GAP && a.y < b.y + b.height + GAP && b.y < a.y + a.height + GAP;
  }

  function untangle(items) {
    const placed = [];
    [...items].sort((a, b) => a.y - b.y || a.x - b.x).forEach(item => {
      const box = {...item};
      let hit = placed.find(other => overlaps(box, other));
      while (hit) {
        box.x = hit.x + hit.width + GAP;
        hit = placed.find(other => overlaps(box, other));
      }
      placed.push(box);
    });
    return placed.map(({id, x, y}) => ({id, x, y}));
  }

  function distribute(items, axis) {
    const size = axis === 'x' ? 'width' : 'height';
    const sorted = [...items].sort((a, b) => a[axis] - b[axis]);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const used = sorted.reduce((sum, item) => sum + item[size], 0);
    const gap = Math.max(GAP, (last[axis] + last[size] - first[axis] - used) / (sorted.length - 1));
    let cursor = first[axis];
    return sorted.map(item => {
      const position = {id: item.id, x: item.x, y: item.y, [axis]: cursor};
      cursor += item[size] + gap;
      return position;
    });
  }

  /** items: [{id, type, x, y, width, height, seq, groupId}] -> [{id, x, y}] */
  function arrangePositions(items, layout) {
    if (!items.length) return [];
    const origin = {x: Math.min(...items.map(item => item.x)), y: Math.min(...items.map(item => item.y))};
    const reading = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
    if (layout === 'tidy') return untangle(items);
    if (layout === 'align-left') return items.map(item => ({id: item.id, x: origin.x, y: item.y}));
    if (layout === 'align-top') return items.map(item => ({id: item.id, x: item.x, y: origin.y}));
    if (layout === 'distribute-h') return distribute(items, 'x');
    if (layout === 'distribute-v') return distribute(items, 'y');
    if (layout === 'order') return placeGrid([...items].sort((a, b) => a.seq - b.seq), origin);
    if (layout === 'type' || layout === 'group') {
      const keyOf = item => layout === 'type' ? `${typeRank(item.type)}:${item.type || ''}` : item.groupId || '\uffff';
      const rows = new Map();
      [...reading].sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0)).forEach(item => {
        const key = keyOf(item);
        rows.set(key, [...(rows.get(key) || []), item]);
      });
      return placeRows([...rows.values()], origin);
    }
    return placeGrid(reading, origin);
  }

  function buildArrangeProposal({request = '', layout = 'grid', scope = 'all', items = []} = {}) {
    if (ALIGN_LAYOUTS.has(layout) && items.length < 2) throw new Error('对齐和分布至少需要选中两个节点');
    if (!items.length) throw new Error('画布上没有可整理的节点');
    const byId = new Map(items.map(item => [item.id, item]));
    const moves = arrangePositions(items, layout)
      .map(target => ({id: target.id, from: {x: byId.get(target.id).x, y: byId.get(target.id).y}, to: {x: Math.round(target.x), y: Math.round(target.y)}}))
      .filter(move => move.from.x !== move.to.x || move.from.y !== move.to.y);
    return {
      kind: 'arrange',
      id: `assistant-arrange-${Date.now()}`,
      request,
      layout,
      scope,
      nodeCount: items.length,
      moves,
      previewNodes: moves.map(move => ({id: move.id, type: byId.get(move.id).type, x: move.to.x, y: move.to.y, width: byId.get(move.id).width, height: byId.get(move.id).height, title: byId.get(move.id).title || move.id})),
      limitations: moves.length ? [] : ['节点已经是这个排列，无需移动。'],
      createdAt: Date.now()
    };
  }

  /** outputs come from the review/delivery modules: [{nodeId, title, mediaType, sourceUrl}] */
  function buildExportProposal({request = '', scope = 'all', format = 'folder', mediaTypes = MEDIA_TYPES, outputs = []} = {}) {
    const wanted = outputs.filter(item => mediaTypes.includes(item.mediaType));
    const local = wanted.filter(item => /^file:/i.test(item.sourceUrl || ''));
    if (!wanted.length) throw new Error(`${scope === 'selection' ? '选中的节点' : '画布'}里没有可导出的${mediaTypes.length === 1 ? (mediaTypes[0] === 'image' ? '图片' : '视频') : '图片或视频'}`);
    const skipped = wanted.length - local.length;
    return {
      kind: 'export',
      id: `assistant-export-${Date.now()}`,
      request,
      scope,
      format,
      mediaTypes,
      items: local.map(item => ({nodeId: item.nodeId, title: item.title, mediaType: item.mediaType, sourceUrl: item.sourceUrl})),
      previewNodes: [],
      limitations: [
        ...(skipped ? [`${skipped} 个产出还没有保存到本地，本次跳过。`] : []),
        ...(local.length ? [] : ['没有已保存到本地的媒体可以导出。'])
      ],
      createdAt: Date.now()
    };
  }

  function buildSnapshotProposal({request = '', scope = 'all', nodeCount = 0} = {}) {
    if (!nodeCount) throw new Error(`${scope === 'selection' ? '选中范围' : '画布'}里没有可导出快照的节点`);
    return {
      kind: 'snapshot',
      id: `assistant-snapshot-${Date.now()}`,
      request,
      scope,
      nodeCount,
      previewNodes: [],
      limitations: ['将渲染节点俯视图为 PNG，并保存到本地媒体目录（或你选择的路径）。'],
      createdAt: Date.now()
    };
  }

  function buildBatchGenerateProposal({request = '', scope = 'selection', count = 2, nodes = []} = {}) {
    const images = (nodes || []).filter(node => node?.type === 'image');
    if (!images.length) throw new Error(`${scope === 'selection' ? '选中范围' : '画布'}里没有可生成变体的图片节点`);
    const n = Math.min(Math.max(Number(count) || 2, 1), 8);
    return {
      kind: 'batch_generate',
      id: `assistant-batch-gen-${Date.now()}`,
      request,
      scope,
      count: n,
      nodeCount: images.length,
      items: images.map(node => ({id: node.id, title: node.data?.title || node.id})),
      previewNodes: images.slice(0, 12).map(node => ({
        id: node.id,
        type: 'image',
        x: node.x,
        y: node.y,
        width: node.width || 280,
        height: node.height || 280,
        title: `${node.data?.title || '图片'} ×${n}`
      })),
      limitations: [
        `将为 ${images.length} 个图片节点各排队生成 ${n} 张变体（走现有生成队列）。`,
        '不会删除现有节点；费用保护与模型能力检查仍生效。'
      ],
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
        if (node.width) Object.assign(ghost.style, {width: `${node.width}px`, height: `${node.height}px`});
        ghost.innerHTML = `<i class="fa-solid ${node.type === 'video' ? 'fa-video' : node.type === 'image' ? 'fa-image' : 'fa-note-sticky'}"></i><span>${esc(node.title)}</span>`;
        viewport.appendChild(ghost);
      });
    }

    function limitsHtml() {
      return proposal.limitations.length ? `<div class="canvas-assistant-limits">${proposal.limitations.map(item => `<span><i class="fa-solid fa-circle-info"></i>${esc(item)}</span>`).join('')}</div>` : '';
    }

    function proposalHtml() {
      if (!proposal) return '<div class="canvas-assistant-empty">输入目标后先生成操作提案，确认前不会修改画布、写入文件或调用 API。<br>例如：把这些图排整齐 · 导出画布快照 · 导出选中的图片</div>';
      const scopeLabel = proposal.scope === 'selection' ? '选中节点' : '整个画布';
      if (proposal.kind === 'arrange') {
        return `<div class="canvas-assistant-summary"><strong>${LAYOUT_LABELS[proposal.layout]} · ${scopeLabel}</strong><span>${proposal.nodeCount} 个节点，其中 ${proposal.moves.length} 个会移动；虚线框为新位置</span><span>确认后作为一次修改，可一步撤销</span></div>${limitsHtml()}`;
      }
      if (proposal.kind === 'export') {
        return `<div class="canvas-assistant-summary"><strong>导出${proposal.mediaTypes.length === 1 ? (proposal.mediaTypes[0] === 'image' ? '图片' : '视频') : '图片和视频'} · ${scopeLabel}</strong><span>${proposal.items.length} 个文件 · ${proposal.format === 'zip' ? '打包为 ZIP' : '复制到文件夹'}</span><span>确认后选择保存位置，才会写入文件</span></div>
        <ol>${proposal.items.map(item => `<li><b>${item.mediaType === 'video' ? '视频' : '图片'}</b><span>${esc(item.title)}</span></li>`).join('')}</ol>${limitsHtml()}`;
      }
      if (proposal.kind === 'snapshot') {
        return `<div class="canvas-assistant-summary"><strong>画布快照 PNG · ${scopeLabel}</strong><span>${proposal.nodeCount} 个节点将绘制到一张图</span><span>确认后保存到本地媒体目录</span></div>${limitsHtml()}`;
      }
      if (proposal.kind === 'batch_generate') {
        return `<div class="canvas-assistant-summary"><strong>批量生成变体 · ${scopeLabel}</strong><span>${proposal.nodeCount} 个图片节点 × 各 ${proposal.count} 张</span><span>确认后加入生成队列，不立即改动画布结构</span></div>
        <ol>${proposal.items.map(item => `<li><b>图片</b><span>${esc(item.title)}</span></li>`).join('')}</ol>${limitsHtml()}`;
      }
      const kindLabel = {addNode: '新增节点', connect: '建立连线', group: '建立组合', prepareQueue: '准备队列'};
      return `<div class="canvas-assistant-summary">
        <strong>${proposal.shotCount} 个镜头 · ${esc(proposal.ratio)}</strong>
        <span>预计 ${proposal.requests} 次付费请求 · ${proposal.estimatedMinutes.min}-${proposal.estimatedMinutes.max} 分钟</span>
        <span>${proposal.estimatedCost ? esc(proposal.estimatedCost) : '模型价格不完整，运行时由费用保护再次确认'}</span>
      </div>
      <ol>${proposal.actions.map(action => `<li><b>${kindLabel[action.kind] || action.kind}</b><span>${esc(action.data?.title || action.name || (action.kind === 'connect' ? `${action.from} → ${action.to}` : `${action.tempIds?.length || 0} 项`))}</span></li>`).join('')}</ol>
      ${limitsHtml()}`;
    }

    function render() {
      if ($('canvasAssistantPlan')) $('canvasAssistantPlan').innerHTML = proposalHtml();
      $('canvasAssistantApply')?.toggleAttribute('disabled', !proposal || (proposal.kind === 'arrange' && !proposal.moves.length) || (proposal.kind === 'export' && !proposal.items.length) || (proposal.kind === 'snapshot' && !proposal.nodeCount) || (proposal.kind === 'batch_generate' && !proposal.nodeCount));
      renderPreview();
    }

    async function planIntent(text, hasSelection) {
      const fallback = intentFromText(text, {hasSelection});
      if (!deps.planWithChatModel) return fallback;
      try {
        const intent = normalizeIntent(await deps.planWithChatModel({system: INTENT_PROMPT, user: JSON.stringify({request: text, selectedCount: hasSelection ? deps.selectedNodes().size : 0})}), fallback);
        return hasSelection ? intent : {...intent, scope: 'all'};
      } catch (error) {
        console.warn('canvas assistant planner fallback', error);
        return fallback;
      }
    }

    function scopedNodes(scope) {
      const all = [...deps.nodes().values()];
      if (scope !== 'selection') return all;
      const selected = deps.selectedNodes();
      return all.filter(node => selected.has(node.id));
    }

    async function plan() {
      const text = String($('canvasAssistantInput')?.value || '').trim();
      try {
        if (!text) throw new Error('请先描述要在画布上完成的任务');
        const selection = deps.selectedNodes?.() || new Set();
        const intent = await planIntent(text, selection.size > 0);
        if (intent.action === 'arrange') {
          proposal = buildArrangeProposal({request: text, layout: intent.layout, scope: intent.scope, items: deps.layoutItems(scopedNodes(intent.scope))});
        } else if (intent.action === 'export') {
          proposal = buildExportProposal({request: text, scope: intent.scope, format: intent.format, mediaTypes: intent.mediaTypes, outputs: deps.mediaOutputs(scopedNodes(intent.scope))});
        } else if (intent.action === 'snapshot') {
          proposal = buildSnapshotProposal({request: text, scope: intent.scope, nodeCount: scopedNodes(intent.scope).length});
        } else if (intent.action === 'batch_generate') {
          proposal = buildBatchGenerateProposal({request: text, scope: intent.scope, count: intent.count, nodes: scopedNodes(intent.scope)});
        } else {
          proposal = buildProposal({
            text,
            center: deps.viewCenter?.() || {x: 0, y: 0},
            selected: [...selection].map(id => deps.nodes?.().get(id)).filter(Boolean),
            imageModel: deps.imageModel?.() || '',
            videoModel: deps.videoModel?.() || '',
            providers: deps.providers?.() || []
          });
        }
        render();
        toast('操作提案已生成，画布仍未修改', 'success');
      } catch (error) {
        toast(error.message || String(error), 'warn');
      }
    }

    async function applyArrange() {
      const confirmed = await deps.openModal?.({title: '确认整理画布', text: `将按“${LAYOUT_LABELS[proposal.layout]}”移动 ${proposal.moves.length} 个节点，不会新增或删除内容。整理后可一步撤销。`, okText: '确认整理', cancelText: '取消', confirm: true});
      if (!confirmed) return false;
      deps.moveNodes(proposal.moves.map(move => ({id: move.id, ...move.to})));
      clearPreview();
      toast('画布已整理，可撤销', 'success');
      return true;
    }

    async function applyExport() {
      const confirmed = await deps.openModal?.({title: '确认导出', text: `将导出 ${proposal.items.length} 个文件${proposal.format === 'zip' ? '，打包为一个 ZIP' : '到你选择的文件夹'}。下一步选择保存位置后才会写入。`, okText: '选择位置并导出', cancelText: '取消', confirm: true});
      if (!confirmed) return false;
      const result = await deps.exportMedia({format: proposal.format, items: proposal.items});
      if (!result) return false;
      toast(`已导出 ${result.count} 个文件${result.failed ? `，${result.failed} 个失败` : ''}`, result.failed ? 'warn' : 'success');
      return true;
    }

    async function applySnapshot() {
      const confirmed = await deps.openModal?.({title: '确认导出画布快照', text: `将把${proposal.scope === 'selection' ? '选中的' : '全部'} ${proposal.nodeCount} 个节点渲染为一张 PNG。`, okText: '导出快照', cancelText: '取消', confirm: true});
      if (!confirmed) return false;
      if (typeof deps.exportCanvasSnapshot !== 'function') throw new Error('画布快照功能不可用');
      const result = await deps.exportCanvasSnapshot({scope: proposal.scope});
      if (!result) return false;
      toast(`快照已保存${result.fileName ? '：' + result.fileName : ''}`, 'success');
      return true;
    }

    async function applyBatchGenerate({silent = false} = {}) {
      if (!silent) {
        const confirmed = await deps.openModal?.({
          title: '确认批量生成变体',
          text: `将为 ${proposal.nodeCount} 个图片节点各排队生成 ${proposal.count} 张变体（共约 ${proposal.nodeCount * proposal.count} 次生成请求）。`,
          okText: '加入队列',
          cancelText: '取消',
          confirm: true
        });
        if (!confirmed) return false;
      }
      if (typeof deps.generateImageKeepingOriginal !== 'function') throw new Error('生成队列不可用');
      const count = Math.min(4, Math.max(1, Number(proposal.count) || 2));
      let queued = 0;
      for (const item of proposal.items) {
        const node = deps.nodes?.().get(item.id);
        if (!node || node.type !== 'image') continue;
        // Same rule as the node button: a node with a picture keeps it, the variants land on a new node to its right.
        await deps.generateImageKeepingOriginal(node, {count}).catch(() => {});
        queued += 1;
      }
      deps.saveProject?.();
      toast(`已为 ${queued} 个图片节点排队生成变体`, 'success');
      return true;
    }

    async function applyBuild() {
      const confirmed = await deps.openModal?.({title: '确认执行画布提案', text: `将一次性新增、配置并连接 ${proposal.previewNodes.length} 个节点。此操作可整体撤销；不会删除现有内容。`, okText: '确认执行', cancelText: '取消', confirm: true});
      if (!confirmed) return false;
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
      return true;
    }

    async function apply() {
      if (!proposal) return;
      try {
        const done = await (
          proposal.kind === 'arrange' ? applyArrange()
          : proposal.kind === 'export' ? applyExport()
          : proposal.kind === 'snapshot' ? applySnapshot()
          : proposal.kind === 'batch_generate' ? applyBatchGenerate()
          : applyBuild()
        );
        if (!done) return;
      } catch (error) {
        toast(error.message || String(error), 'error');
        return;
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
    async function runDirect({request = '', selection = [], batch = null, autoConfirm = true} = {}) {
      const text = String(request || '').trim();
      if (!text && !batch?.op) throw new Error('画布请求为空');
      const selected = new Set(Array.isArray(selection) ? selection.map(String) : []);
      if (selected.size && deps.selectedNodes) {
        const live = deps.selectedNodes();
        live.clear?.();
        selected.forEach(id => live.add?.(id));
      }
      let intent;
      if (batch?.op) {
        const op = String(batch.op).toLowerCase();
        const scope = selected.size ? 'selection' : 'all';
        if (op === 'batch_generate') intent = {action: 'batch_generate', scope, count: batch.count || 2};
        else if (op === 'arrange') intent = {action: 'arrange', scope, layout: batch.layout || 'grid'};
        else if (op === 'export') intent = {action: 'export', scope, format: batch.format || 'folder', mediaTypes: ['image', 'video']};
        else if (op === 'snapshot') intent = {action: 'snapshot', scope};
        else intent = intentFromText(text || op, {hasSelection: !!selected.size});
      } else {
        intent = await planIntent(text, selected.size > 0);
      }
      if (intent.action === 'arrange') {
        proposal = buildArrangeProposal({request: text, layout: intent.layout, scope: intent.scope, items: deps.layoutItems(scopedNodes(intent.scope))});
      } else if (intent.action === 'export') {
        proposal = buildExportProposal({request: text, scope: intent.scope, format: intent.format, mediaTypes: intent.mediaTypes, outputs: deps.mediaOutputs(scopedNodes(intent.scope))});
      } else if (intent.action === 'snapshot') {
        proposal = buildSnapshotProposal({request: text, scope: intent.scope, nodeCount: scopedNodes(intent.scope).length});
      } else if (intent.action === 'batch_generate') {
        proposal = buildBatchGenerateProposal({request: text, scope: intent.scope, count: intent.count, nodes: scopedNodes(intent.scope)});
      } else {
        proposal = buildProposal({
          text,
          center: deps.viewCenter?.() || {x: 0, y: 0},
          selected: [...selected].map(id => deps.nodes?.().get(id)).filter(Boolean),
          imageModel: deps.imageModel?.() || '',
          videoModel: deps.videoModel?.() || '',
          providers: deps.providers?.() || []
        });
      }
      const snap = proposal;
      let done = false;
      if (autoConfirm) {
        if (proposal.kind === 'arrange') {
          deps.moveNodes(proposal.moves.map(move => ({id: move.id, ...move.to})));
          done = true;
        } else if (proposal.kind === 'export') {
          const result = await deps.exportMedia({format: proposal.format, items: proposal.items});
          done = !!result;
        } else if (proposal.kind === 'snapshot') {
          const result = await deps.exportCanvasSnapshot({scope: proposal.scope});
          done = !!result;
        } else if (proposal.kind === 'batch_generate') {
          done = await applyBatchGenerate({silent: true});
        } else {
          done = await applyBuild();
        }
      } else {
        done = await apply();
      }
      proposal = null;
      clearPreview();
      render();
      return {ok: !!done, kind: snap?.kind, request: text, batch: batch || null, nodeCount: snap?.nodeCount, count: snap?.count};
    }

    return {open, close, plan, apply, clearPreview, getProposal: () => proposal, runDirect};
  }

  return {INTENT_PROMPT, LAYOUTS, ratioFromText, shotCount, buildProposal, intentFromText, normalizeIntent, arrangePositions, buildArrangeProposal, buildExportProposal, buildSnapshotProposal, buildBatchGenerateProposal, create};
});
