(function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const STORE_KEY = 'futureai.workflowLibrary.v1';
  const PRIVATE_KEYS = /^(?:apiKey|apiKeys|keyPool|ciphertext|storageDir|license|activation|secret|token)$/i;
  const ABSOLUTE_PATH = /^(?:[a-z]:[\\/]|\\\\|\/Users\/|\/home\/)/i;

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

  function normalizeNode(node = {}, left = 0, top = 0) {
    return {
      id: String(node.id || ''),
      type: String(node.type || 'prompt'),
      x: Number(node.x || 0) - left,
      y: Number(node.y || 0) - top,
      data: scrubValue(clone(node.data || {})) || {}
    };
  }

  function createDefinition({name = '未命名工作流', notes = '', version = '1.0.0', nodes = [], edges = [], groups = [], exposed = {inputs: [], outputs: [], parameters: []}} = {}) {
    if (!Array.isArray(nodes) || nodes.length < 1) throw new Error('工作流至少需要一个节点');
    const ids = new Set(nodes.map(node => String(node.id)));
    const left = Math.min(...nodes.map(node => Number(node.x || 0)));
    const top = Math.min(...nodes.map(node => Number(node.y || 0)));
    const cleanNodes = nodes.map(node => normalizeNode(node, left, top));
    const cleanEdges = (Array.isArray(edges) ? edges : []).filter(edge => ids.has(String(edge.from)) && ids.has(String(edge.to))).map(edge => scrubValue(clone(edge)));
    const cleanGroups = (Array.isArray(groups) ? groups : []).map(group => ({
      id: String(group.id || ''),
      name: String(group.name || '组合'),
      nodeIds: (group.nodeIds || []).map(String).filter(id => ids.has(id))
    })).filter(group => group.nodeIds.length > 1);
    return {
      schemaVersion: SCHEMA_VERSION,
      id: `wf-${safeId(name)}-${Date.now().toString(36)}`,
      name: String(name || '未命名工作流').slice(0, 80),
      version: /^\d+\.\d+\.\d+$/.test(String(version)) ? String(version) : '1.0.0',
      notes: String(notes || '').slice(0, 500),
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

  function simpleTemplate(id, name, nodes, edges, notes) {
    const definition = createDefinition({name, nodes, edges, notes, version: '1.0.0'});
    definition.id = id;
    definition.createdAt = 0;
    definition.updatedAt = 0;
    definition.builtIn = true;
    return definition;
  }

  const BUILT_INS = Object.freeze([
    simpleTemplate('builtin-character-look', '角色定妆', [
      {id: 'character', type: 'character', x: 0, y: 70, data: {title: '角色设定', prompt: '角色卡：身份、服装、发型、气质和不可变化特征。'}},
      {id: 'portrait', type: 'image', x: 410, y: 0, data: {title: '角色定妆图', prompt: '生成正面角色定妆图，严格保持角色设定。', model: '__IMAGE_MODEL__', aspect: '3:4', resolution: '1K', references: []}}
    ], [{from: 'character', fromPort: 'text', to: 'portrait', toPort: 'prompt'}], '从角色卡生成可复用定妆资产。'),
    simpleTemplate('builtin-three-shot', '三镜头分镜', [0, 1, 2].flatMap(index => [
      {id: `p${index}`, type: 'prompt', x: 0, y: index * 260, data: {title: `镜头 ${index + 1}`, prompt: ['建立角色和场景。', '推进动作并保持连续性。', '情绪特写并完成收束。'][index]}},
      {id: `i${index}`, type: 'image', x: 410, y: index * 260, data: {title: `分镜图 ${index + 1}`, model: '__IMAGE_MODEL__', aspect: '16:9', resolution: '1K', references: []}}
    ]), [0, 1, 2].map(index => ({from: `p${index}`, fromPort: 'text', to: `i${index}`, toPort: 'prompt'})), '一次建立三个连续镜头。'),
    simpleTemplate('builtin-image-video', '图片转视频', [
      {id: 'image', type: 'image', x: 0, y: 0, data: {title: '关键画面', model: '__IMAGE_MODEL__', aspect: '16:9', resolution: '1K', references: []}},
      {id: 'video', type: 'video', x: 470, y: 0, data: {title: '单图生视频', model: '__VIDEO_MODEL__', operation: 'image-to-video', size: '1280x720', duration: '5', references: []}}
    ], [{from: 'image', fromPort: 'image', to: 'video', toPort: 'ref'}], '生成关键画面后转为视频。'),
    simpleTemplate('builtin-first-last', '首尾帧视频', [
      {id: 'first', type: 'image', x: 0, y: 0, data: {title: '首帧', model: '__IMAGE_MODEL__', aspect: '16:9', resolution: '1K', references: []}},
      {id: 'last', type: 'image', x: 0, y: 330, data: {title: '尾帧', model: '__IMAGE_MODEL__', aspect: '16:9', resolution: '1K', references: []}},
      {id: 'video', type: 'video', x: 500, y: 140, data: {title: '首尾帧视频', model: '__VIDEO_MODEL__', operation: 'first-last-frame', size: '1280x720', duration: '5', references: [{sourceNodeId: 'first', role: 'first-frame'}, {sourceNodeId: 'last', role: 'last-frame'}]}}
    ], [{from: 'first', fromPort: 'image', to: 'video', toPort: 'ref'}, {from: 'last', fromPort: 'image', to: 'video', toPort: 'ref'}], '用首帧与尾帧控制镜头起止。'),
    simpleTemplate('builtin-ad-variants', '广告变体', [
      {id: 'brief', type: 'prompt', x: 0, y: 160, data: {title: '广告简报', prompt: '产品、受众、卖点、场景、品牌语气和禁用内容。'}},
      ...[0, 1, 2].map(index => ({id: `variant${index}`, type: 'image', x: 410, y: index * 300, data: {title: `广告变体 ${index + 1}`, model: '__IMAGE_MODEL__', aspect: '4:3', resolution: '1K', references: [], variantStatus: 'unseen'}}))
    ], [0, 1, 2].map(index => ({from: 'brief', fromPort: 'text', to: `variant${index}`, toPort: 'prompt'})), '一份简报生成三条视觉分支。'),
    simpleTemplate('builtin-comic-shot', '漫剧单镜头', [
      {id: 'shot', type: 'prompt', x: 0, y: 110, data: {title: '镜头描述', prompt: '角色、动作、场景、机位、情绪、对白和时长。'}},
      {id: 'frame', type: 'image', x: 400, y: 0, data: {title: '镜头关键帧', model: '__IMAGE_MODEL__', aspect: '9:16', resolution: '1K', references: []}},
      {id: 'video', type: 'video', x: 870, y: 0, data: {title: '镜头视频', model: '__VIDEO_MODEL__', operation: 'image-to-video', size: '720x1280', duration: '5', references: []}}
    ], [{from: 'shot', fromPort: 'text', to: 'frame', toPort: 'prompt'}, {from: 'frame', fromPort: 'image', to: 'video', toPort: 'ref'}], '漫剧单镜头的描述、关键帧和视频链路。')
  ]);

  window.FutureAIWorkflowLibrary = {
    SCHEMA_VERSION,
    STORE_KEY,
    BUILT_INS,
    scrubValue,
    createDefinition,
    normalizeDefinition,
    instantiate,
    loadLibrary,
    saveLibrary,
    upsertLibraryItem
  };
})();
