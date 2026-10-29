(function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const STORE_KEY = 'futureai.workflowLibrary.v1';
  const PRIVATE_KEYS = /^(?:apiKey|apiKeys|keyPool|ciphertext|storageDir|license|activation|secret|token)$/i;
  const ABSOLUTE_PATH = /^(?:[a-z]:[\\/]|\\\\|\/Users\/|\/home\/)/i;
  const CATEGORIES = Object.freeze([
    {id: 'all', name: '全部'},
    {id: 'image', name: '图片'},
    {id: 'video', name: '视频'},
    {id: 'commerce', name: '电商'},
    {id: 'character', name: '角色'},
    {id: 'mine', name: '我的模板'}
  ]);
  const NODE_SIZE = Object.freeze({
    prompt: {w: 320, h: 220},
    character: {w: 320, h: 220},
    image: {w: 520, h: 293},
    video: {w: 520, h: 293},
    upload: {w: 360, h: 280},
    'media-tool': {w: 420, h: 300},
    comfyui: {w: 520, h: 360}
  });

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function safeId(value, fallback = 'workflow') {
    return String(value || fallback).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || fallback;
  }

  function scrubValue(value, key = '') {
    if (PRIVATE_KEYS.test(key)) return undefined;
    if (Array.isArray(value)) return value.map(item => scrubValue(item)).filter(item => item !== undefined);
    if (value && typeof value === 'object') {
      const output = {};
      Object.entries(value).forEach(([childKey, childValue]) => {
        const clean = scrubValue(childValue, childKey);
        if (clean !== undefined) output[childKey] = clean;
      });
      return output;
    }
    if (typeof value === 'string') {
      if (ABSOLUTE_PATH.test(value) || /^file:/i.test(value)) return '';
      if (/^data:/i.test(value) && value.length > 2048) return '';
    }
    return value;
  }

  // Templates keep only how references are used (role, strength, order), never the media itself.
  const MANUAL_REF_KEY = '__manual_ref__';
  const REFERENCE_FIELDS = ['key', 'sourceNodeId', 'role', 'strength', 'order', 'frameTime', 'notes'];
  const MANUAL_REF_FIELDS = ['refUrl', 'manualRefUrl', 'manualRefMime', 'manualRefSizeBytes', 'manualRefName'];

  function portableReferences(data, ids) {
    const inTemplate = (sourceNodeId, key) => (sourceNodeId ? ids.has(sourceNodeId) : key === MANUAL_REF_KEY);
    if (Array.isArray(data.references)) {
      data.references = data.references.filter(item => item && inTemplate(String(item.sourceNodeId || ''), String(item.key || ''))).map(item => {
        const reference = {};
        REFERENCE_FIELDS.forEach(field => { if (item[field] != null && item[field] !== '') reference[field] = item[field]; });
        return reference;
      });
    }
    if (Array.isArray(data.refOrder)) data.refOrder = data.refOrder.map(String).filter(key => ids.has(key) || key === MANUAL_REF_KEY);
    MANUAL_REF_FIELDS.forEach(field => { delete data[field]; });
    return data;
  }

  function normalizeNode(node = {}, left = 0, top = 0, ids = new Set()) {
    return {
      id: String(node.id || ''),
      type: String(node.type || 'prompt'),
      x: Number(node.x || 0) - left,
      y: Number(node.y || 0) - top,
      data: portableReferences(scrubValue(clone(node.data || {})) || {}, ids)
    };
  }

  function createDefinition({
    name = '未命名工作流',
    notes = '',
    version = '1.0.0',
    category = 'image',
    nodes = [],
    edges = [],
    groups = [],
    exposed = {inputs: [], outputs: [], parameters: []}
  } = {}) {
    if (!Array.isArray(nodes) || nodes.length < 1) throw new Error('工作流至少需要一个节点');
    const ids = new Set(nodes.map(node => String(node.id)));
    const left = Math.min(...nodes.map(node => Number(node.x || 0)));
    const top = Math.min(...nodes.map(node => Number(node.y || 0)));
    const cleanNodes = nodes.map(node => normalizeNode(node, left, top, ids));
    const cleanEdges = (Array.isArray(edges) ? edges : []).filter(edge => ids.has(String(edge.from)) && ids.has(String(edge.to))).map(edge => scrubValue(clone(edge)));
    const cleanGroups = (Array.isArray(groups) ? groups : []).map(group => ({
      id: String(group.id || ''),
      name: String(group.name || '组合'),
      nodeIds: (group.nodeIds || []).map(String).filter(id => ids.has(id))
    })).filter(group => group.nodeIds.length > 1);
    const allowed = new Set(CATEGORIES.map(item => item.id).filter(id => id !== 'all' && id !== 'mine'));
    return {
      schemaVersion: SCHEMA_VERSION,
      id: `wf-${safeId(name)}-${Date.now().toString(36)}`,
      name: String(name || '未命名工作流').slice(0, 80),
      version: /^\d+\.\d+\.\d+$/.test(String(version)) ? String(version) : '1.0.0',
      notes: String(notes || '').slice(0, 500),
      category: allowed.has(String(category)) ? String(category) : 'image',
      compatibility: {minAppVersion: '3.1.0', maxSchemaVersion: SCHEMA_VERSION},
      exposed: scrubValue(clone(exposed)) || {inputs: [], outputs: [], parameters: []},
      nodes: cleanNodes,
      edges: cleanEdges,
      groups: cleanGroups,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  function normalizeDefinition(value = {}) {
    if (Number(value.schemaVersion || 1) > SCHEMA_VERSION) throw new Error(`工作流格式版本 ${value.schemaVersion} 高于当前软件支持的 ${SCHEMA_VERSION}`);
    const definition = createDefinition(value);
    definition.id = safeId(value.id || definition.id, definition.id);
    definition.createdAt = Number(value.createdAt || Date.now());
    definition.updatedAt = Number(value.updatedAt || Date.now());
    if (value.builtIn) definition.builtIn = true;
    return definition;
  }

  function instantiate(definition, {originX = 0, originY = 0, idFactory = null, imageModel = '', videoModel = ''} = {}) {
    const normalized = normalizeDefinition(definition);
    const idMap = new Map();
    normalized.nodes.forEach((node, index) => idMap.set(node.id, idFactory ? idFactory(node, index) : `wf_node_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`));
    const replaceModel = value => value === '__IMAGE_MODEL__' ? imageModel : value === '__VIDEO_MODEL__' ? videoModel : value;
    const nodes = normalized.nodes.map(node => {
      const data = clone(node.data || {});
      if (data.model) data.model = replaceModel(data.model);
      if (Array.isArray(data.references)) data.references = data.references.map(reference => {
        const sourceId = idMap.get(String(reference.sourceNodeId || '')) || '';
        return Object.assign({}, reference, {
          sourceNodeId: sourceId,
          key: sourceId || reference.key || ''
        });
      });
      if (Array.isArray(data.refOrder)) data.refOrder = data.refOrder.map(key => idMap.get(key) || key);
      const exposedParameters = (normalized.exposed?.parameters || []).filter(item => String(item.nodeId) === String(node.id));
      const exposedOutputs = (normalized.exposed?.outputs || []).filter(item => String(item.nodeId) === String(node.id));
      if (exposedParameters.length || exposedOutputs.length) {
        data.workflowExposure = {
          parameters: exposedParameters.map(item => String(item.field || '')).filter(Boolean),
          output: exposedOutputs.length > 0
        };
      }
      return {id: idMap.get(node.id), sourceId: node.id, type: node.type, x: originX + node.x, y: originY + node.y, data};
    });
    const edges = normalized.edges.map(edge => Object.assign({}, edge, {from: idMap.get(String(edge.from)), to: idMap.get(String(edge.to))}));
    const groups = normalized.groups.map((group, index) => ({
      id: `wf_group_${Date.now()}_${index}`,
      name: group.name,
      nodeIds: group.nodeIds.map(id => idMap.get(id)).filter(Boolean),
      workflowId: normalized.id,
      workflowVersion: normalized.version,
      workflowDefinition: clone(normalized),
      collapsed: false
    }));
    if (!groups.length && nodes.length > 1) groups.push({
      id: `wf_group_${Date.now()}_0`,
      name: normalized.name,
      nodeIds: nodes.map(node => node.id),
      workflowId: normalized.id,
      workflowVersion: normalized.version,
      workflowDefinition: clone(normalized),
      collapsed: false
    });
    return {definition: normalized, nodes, edges, groups, idMap};
  }

  // Image/video nodes are a fixed 520px wide; their preview height follows the aspect ratio (default 16:9).
  function mediaHeight(node) {
    const data = node.data || {};
    const text = String(data.aspect && data.aspect !== 'custom' ? data.aspect : (data.size || '16:9'));
    const match = text.match(/^(\d+(?:\.\d+)?)\s*[:x×]\s*(\d+(?:\.\d+)?)$/);
    const ratio = match && Number(match[1]) > 0 ? Number(match[2]) / Number(match[1]) : 9 / 16;
    return Math.round(520 * Math.min(2, Math.max(.3, ratio)));
  }
  function nodeSizeFor(node) {
    const size = NODE_SIZE[node.type] || NODE_SIZE.prompt;
    if (node.type === 'image' || node.type === 'video') return {w: size.w, h: mediaHeight(node)};
    return size;
  }

  function nodeBox(node) {
    const size = nodeSizeFor(node);
    return {
      left: Number(node.x || 0),
      top: Number(node.y || 0),
      right: Number(node.x || 0) + size.w,
      bottom: Number(node.y || 0) + size.h
    };
  }

  function boxesOverlap(a, b, pad = 40) {
    return !(a.right + pad <= b.left || b.right + pad <= a.left || a.bottom + pad <= b.top || b.bottom + pad <= a.top);
  }

  function definitionBounds(nodes) {
    if (!nodes.length) return {width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0};
    const boxes = nodes.map(nodeBox);
    const left = Math.min(...boxes.map(b => b.left));
    const top = Math.min(...boxes.map(b => b.top));
    const right = Math.max(...boxes.map(b => b.right));
    const bottom = Math.max(...boxes.map(b => b.bottom));
    return {left, top, right, bottom, width: right - left, height: bottom - top};
  }

  // Prefer viewport center; if that overlaps existing nodes, walk right/down until clear.
  function placementOrigin(definition, existingNodes = [], center = {x: 0, y: 0}) {
    const nodes = (definition && definition.nodes) || [];
    const bounds = definitionBounds(nodes);
    const existing = (Array.isArray(existingNodes) ? existingNodes : []).map(nodeBox);
    const startX = Number(center.x || 0) - bounds.width / 2;
    const startY = Number(center.y || 0) - bounds.height / 2;
    const stepX = Math.max(120, Math.round(bounds.width * 0.35) || 240);
    const stepY = Math.max(100, Math.round(bounds.height * 0.35) || 200);
    for (let row = 0; row < 12; row += 1) {
      for (let col = 0; col < 12; col += 1) {
        const originX = startX + col * stepX;
        const originY = startY + row * stepY;
        const candidate = {
          left: originX + bounds.left,
          top: originY + bounds.top,
          right: originX + bounds.right,
          bottom: originY + bounds.bottom
        };
        if (!existing.some(box => boxesOverlap(candidate, box))) {
          return {originX, originY, bounds};
        }
      }
    }
    return {originX: startX + existing.length * stepX, originY: startY, bounds};
  }

  function schematicSvg(definition, width = 220, height = 118) {
    const nodes = (definition && definition.nodes) || [];
    if (!nodes.length) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><rect width="100%" height="100%" rx="10" fill="#152028"/></svg>`;
    }
    const bounds = definitionBounds(nodes);
    const pad = 18;
    const scale = Math.min((width - pad * 2) / Math.max(bounds.width, 1), (height - pad * 2) / Math.max(bounds.height, 1), 1);
    const ox = (width - bounds.width * scale) / 2 - bounds.left * scale;
    const oy = (height - bounds.height * scale) / 2 - bounds.top * scale;
    const color = type => ({
      prompt: '#7dd3fc',
      character: '#c4b5fd',
      image: '#86efac',
      video: '#f9a8d4',
      upload: '#fcd34d',
      'media-tool': '#fdba74',
      comfyui: '#93c5fd'
    }[type] || '#94a3b8');
    const edges = ((definition && definition.edges) || []).map(edge => {
      const from = nodes.find(n => n.id === edge.from);
      const to = nodes.find(n => n.id === edge.to);
      if (!from || !to) return '';
      const a = nodeBox(from);
      const b = nodeBox(to);
      const x1 = ox + (a.left + a.right) / 2 * scale;
      const y1 = oy + (a.top + a.bottom) / 2 * scale;
      const x2 = ox + (b.left + b.right) / 2 * scale;
      const y2 = oy + (b.top + b.bottom) / 2 * scale;
      return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} C${((x1 + x2) / 2).toFixed(1)} ${y1.toFixed(1)}, ${((x1 + x2) / 2).toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="rgba(148,163,184,.55)" stroke-width="1.6"/>`;
    }).join('');
    const rects = nodes.map(node => {
      const box = nodeBox(node);
      const w = Math.max(18, (box.right - box.left) * scale);
      const h = Math.max(14, (box.bottom - box.top) * scale);
      const x = ox + box.left * scale;
      const y = oy + box.top * scale;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${color(node.type)}" fill-opacity=".88"/>`;
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><rect width="100%" height="100%" rx="10" fill="#121a21"/>${edges}${rects}</svg>`;
  }

  function loadLibrary(storage = window.localStorage) {
    try {
      const value = JSON.parse(storage.getItem(STORE_KEY) || '[]');
      return Array.isArray(value) ? value.map(normalizeDefinition) : [];
    } catch {
      return [];
    }
  }

  function saveLibrary(items, storage = window.localStorage) {
    const normalized = (Array.isArray(items) ? items : []).map(normalizeDefinition).slice(0, 100);
    storage.setItem(STORE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function upsertLibraryItem(items, definition) {
    const normalized = normalizeDefinition(definition);
    const list = (Array.isArray(items) ? items : []).filter(item => item.id !== normalized.id);
    list.unshift(normalized);
    return list.slice(0, 100);
  }

  function deleteLibraryItem(items, id) {
    return (Array.isArray(items) ? items : []).filter(item => item.id !== id);
  }

  function simpleTemplate(id, name, category, nodes, edges, notes) {
    const definition = createDefinition({name, category, nodes, edges, notes, version: '1.0.0'});
    definition.id = id;
    definition.createdAt = 0;
    definition.updatedAt = 0;
    definition.builtIn = true;
    return definition;
  }

  // Layout: image/video nodes use the normal 520px node with the default 16:9 preview (portrait only where the
  // template needs it); text nodes are vertically centred on the node they feed so wires run straight.
  const BUILT_INS = Object.freeze([
    simpleTemplate('builtin-txt2img', '文生图基础', 'image', [
      {id: 'prompt', type: 'prompt', x: 0, y: 36, data: {title: '提示词', prompt: '【主题】一只漂浮在云端的白猫\n【风格】日系动画、干净线条、柔和光影\n【构图】居中半身、浅景深\n【避免】文字、水印、畸变手部'}},
      {id: 'image', type: 'image', x: 420, y: 0, data: {title: '生成图', prompt: '', model: '__IMAGE_MODEL__', resolution: '1K', references: []}}
    ], [{from: 'prompt', fromPort: 'text', to: 'image', toPort: 'prompt'}], '提示词接到图片节点，改提示词后即可生成。'),

    simpleTemplate('builtin-product-bg', '商品图换背景', 'commerce', [
      {id: 'upload', type: 'upload', x: 0, y: 0, data: {title: '商品原图', name: '上传商品图', kind: 'image'}},
      {id: 'prompt', type: 'prompt', x: 20, y: 340, data: {title: '换背景要求', prompt: '保留商品外形、商标与透视，只替换背景为【简洁影棚白底 / 木质桌面 / 自然窗光】，柔和阴影，电商主图风格。'}},
      {id: 'image', type: 'image', x: 480, y: 134, data: {title: '换背景结果', prompt: '', model: '__IMAGE_MODEL__', resolution: '1K', references: []}}
    ], [
      {from: 'upload', fromPort: 'media', to: 'image', toPort: 'ref'},
      {from: 'prompt', fromPort: 'text', to: 'image', toPort: 'prompt'}
    ], '上传商品图 + 写换背景要求，参考图编辑出新主图。'),

    simpleTemplate('builtin-character-angles', '角色多角度', 'character', [
      {id: 'character', type: 'character', x: 0, y: 389, data: {title: '角色设定', prompt: '角色卡：姓名、年龄、发型发色、五官、服装配色、配饰、气质。保持同一角色不可变特征。'}},
      {id: 'front', type: 'image', x: 440, y: 353, data: {title: '正面', prompt: '同一角色正面半身定妆，清晰面部与服装，干净背景。', model: '__IMAGE_MODEL__', resolution: '1K', references: []}},
      {id: 'side', type: 'image', x: 1020, y: 176, data: {title: '侧面', prompt: '同一角色左侧 3/4 侧面半身，严格保持发型服装与五官一致。', model: '__IMAGE_MODEL__', resolution: '1K', references: [{sourceNodeId: 'front', role: 'character', strength: 'strong'}]}},
      {id: 'back', type: 'image', x: 1020, y: 529, data: {title: '背面', prompt: '同一角色背面半身，展示发型后脑与服装背面细节，身份一致。', model: '__IMAGE_MODEL__', resolution: '1K', references: [{sourceNodeId: 'front', role: 'character', strength: 'strong'}]}}
    ], [
      {from: 'character', fromPort: 'text', to: 'front', toPort: 'prompt'},
      {from: 'character', fromPort: 'text', to: 'side', toPort: 'prompt'},
      {from: 'character', fromPort: 'text', to: 'back', toPort: 'prompt'},
      {from: 'front', fromPort: 'image', to: 'side', toPort: 'ref'},
      {from: 'front', fromPort: 'image', to: 'back', toPort: 'ref'}
    ], '先出正面图，再作为「角色一致·强」参考生成侧面与背面。'),

    simpleTemplate('builtin-img2video', '图生视频', 'video', [
      {id: 'image', type: 'image', x: 0, y: 0, data: {title: '关键画面', prompt: '【镜头】缓慢推进的城市夜景天台，霓虹倒影，电影感。', model: '__IMAGE_MODEL__', resolution: '1K', references: []}},
      {id: 'video', type: 'video', x: 640, y: 0, data: {title: '视频', prompt: '保持主体与构图，轻微镜头推进，自然动态，无跳切。', model: '__VIDEO_MODEL__', operation: 'image-to-video', size: '1280x720', duration: '5', references: []}}
    ], [{from: 'image', fromPort: 'image', to: 'video', toPort: 'ref'}], '先出关键图，再一键转成短视频。'),

    simpleTemplate('builtin-storyboard-reel', '分镜脚本成片', 'video', [
      {id: 'script', type: 'prompt', x: 0, y: 389, data: {title: '分镜脚本', prompt: '故事：【一句话主题】\n镜头1 全景建立场景\n镜头2 中景推进动作\n镜头3 特写情绪收束\n旁白/对白可选。'}},
      {id: 'shot1', type: 'image', x: 440, y: 0, data: {title: '镜头1', prompt: '分镜1：全景建立场景，16:9，电影构图。', model: '__IMAGE_MODEL__', resolution: '1K', references: []}},
      {id: 'shot2', type: 'image', x: 440, y: 353, data: {title: '镜头2', prompt: '分镜2：中景推进动作，与上一镜连续。', model: '__IMAGE_MODEL__', resolution: '1K', references: []}},
      {id: 'shot3', type: 'image', x: 440, y: 706, data: {title: '镜头3', prompt: '分镜3：情绪特写收束，与前两镜同一世界观。', model: '__IMAGE_MODEL__', resolution: '1K', references: []}},
      {id: 'video', type: 'video', x: 1080, y: 353, data: {title: '成片视频', prompt: '用关键帧做成连贯短片，节奏平稳。', model: '__VIDEO_MODEL__', operation: 'image-to-video', size: '1280x720', duration: '5', references: []}}
    ], [
      {from: 'script', fromPort: 'text', to: 'shot1', toPort: 'prompt'},
      {from: 'script', fromPort: 'text', to: 'shot2', toPort: 'prompt'},
      {from: 'script', fromPort: 'text', to: 'shot3', toPort: 'prompt'},
      {from: 'shot2', fromPort: 'image', to: 'video', toPort: 'ref'}
    ], '一份脚本拆三个镜头图，再接到视频节点。'),

    simpleTemplate('builtin-poster', '海报设计', 'image', [
      {id: 'prompt', type: 'prompt', x: 0, y: 236, data: {title: '海报文案', prompt: '海报主题：【活动名】\n主标题：……\n副标题：……\n风格：现代极简 / 霓虹夜店 / 国潮插画\n构图留出标题安全区，竖版海报，不要乱码文字。'}},
      {id: 'poster', type: 'image', x: 420, y: 0, data: {title: '海报', prompt: '', model: '__IMAGE_MODEL__', aspect: '3:4', resolution: '1K', references: []}}
    ], [{from: 'prompt', fromPort: 'text', to: 'poster', toPort: 'prompt'}], '竖版海报：改文案与风格后直接出图。'),

    simpleTemplate('builtin-first-last', '首尾帧视频', 'video', [
      {id: 'first', type: 'image', x: 0, y: 0, data: {title: '首帧', prompt: '镜头起点画面。', model: '__IMAGE_MODEL__', resolution: '1K', references: []}},
      {id: 'last', type: 'image', x: 0, y: 353, data: {title: '尾帧', prompt: '镜头终点画面，与首帧同一场景。', model: '__IMAGE_MODEL__', resolution: '1K', references: []}},
      {id: 'video', type: 'video', x: 640, y: 176, data: {title: '首尾帧视频', prompt: '从首帧平滑过渡到尾帧。', model: '__VIDEO_MODEL__', operation: 'first-last-frame', size: '1280x720', duration: '5', references: [{sourceNodeId: 'first', role: 'first-frame'}, {sourceNodeId: 'last', role: 'last-frame'}]}}
    ], [
      {from: 'first', fromPort: 'image', to: 'video', toPort: 'ref'},
      {from: 'last', fromPort: 'image', to: 'video', toPort: 'ref'}
    ], '用首帧和尾帧控制镜头起止。'),

    simpleTemplate('builtin-character-look', '角色定妆', 'character', [
      {id: 'character', type: 'character', x: 0, y: 66, data: {title: '角色设定', prompt: '角色卡：身份、服装、发型、气质和不可变化特征。'}},
      {id: 'sheet', type: 'upload', x: 0, y: 346, data: {title: '角色参考图（可选）', name: '上传角色设定图', kind: 'image'}},
      {id: 'portrait', type: 'image', x: 420, y: 0, data: {title: '定妆图', prompt: '生成正面角色定妆图，严格保持角色设定。', model: '__IMAGE_MODEL__', aspect: '3:4', resolution: '1K', references: [{sourceNodeId: 'sheet', role: 'character', strength: 'strong'}]}}
    ], [
      {from: 'character', fromPort: 'text', to: 'portrait', toPort: 'prompt'},
      {from: 'sheet', fromPort: 'media', to: 'portrait', toPort: 'ref'}
    ], '从角色卡生成可复用定妆图；上传角色图后按「角色一致·强」保持同一人。')
  ]);

  function listByCategory(definitions, category = 'all') {
    const list = Array.isArray(definitions) ? definitions : [];
    if (!category || category === 'all') return list;
    if (category === 'mine') return list.filter(item => !item.builtIn);
    return list.filter(item => (item.category || 'image') === category || (category === 'character' && item.builtIn && String(item.id).includes('character')));
  }

  window.FutureAIWorkflowLibrary = {
    SCHEMA_VERSION,
    STORE_KEY,
    CATEGORIES,
    NODE_SIZE,
    BUILT_INS,
    scrubValue,
    createDefinition,
    normalizeDefinition,
    instantiate,
    placementOrigin,
    definitionBounds,
    nodeBox,
    schematicSvg,
    listByCategory,
    loadLibrary,
    saveLibrary,
    upsertLibraryItem,
    deleteLibraryItem
  };
})();
