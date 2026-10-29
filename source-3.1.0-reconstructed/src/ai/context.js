(() => {
  'use strict';

  function nodeTitle(node) {
    return node?.data?.title || node?.data?.name || node?.type || node?.id || 'node';
  }

  function nodePrompt(node) {
    return String(node?.data?.prompt || node?.data?.text || '').trim();
  }

  function compactNode(node) {
    if (!node) return null;
    const data = node.data || {};
    return {
      id: node.id,
      type: node.type,
      title: nodeTitle(node),
      prompt: nodePrompt(node),
      model: data.model || data.workflowName || '',
      provider: data.providerId || data.provider || '',
      status: data.status || data.state || '',
      hasImage: Boolean(data.url || data.imageUrl || data.previewUrl),
      tags: Array.isArray(data.tags) ? data.tags.slice(0, 6) : []
    };
  }

  function nodeMap(snapshot) {
    return new Map((snapshot.nodes || []).map(node => [node.id, node]));
  }

  function upstreamConnections(snapshot, nodeId) {
    const nodes = nodeMap(snapshot);
    return (snapshot.edges || [])
      .filter(edge => edge.to === nodeId)
      .map(edge => ({edge, node: compactNode(nodes.get(edge.from))}))
      .filter(item => item.node);
  }

  function downstreamConnections(snapshot, nodeId) {
    const nodes = nodeMap(snapshot);
    return (snapshot.edges || [])
      .filter(edge => edge.from === nodeId)
      .map(edge => ({edge, node: compactNode(nodes.get(edge.to))}))
      .filter(item => item.node);
  }

  function getSelectedContext(snapshot, targetNodeId = '') {
    const selectedIds = new Set(snapshot.selectedNodeIds || []);
    const nodes = nodeMap(snapshot);
    const ids = targetNodeId && selectedIds.has(targetNodeId) ? [targetNodeId] : [...selectedIds];
    return ids.map(id => {
      const node = compactNode(nodes.get(id));
      if (!node) return null;
      return {
        node,
        upstream: upstreamConnections(snapshot, id),
        downstream: downstreamConnections(snapshot, id)
      };
    }).filter(Boolean);
  }

  function getTypeCounts(snapshot) {
    return (snapshot.nodes || []).reduce((acc, node) => {
      const type = node?.type || 'unknown';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});
  }

  function getFullCanvasSummary(snapshot, maxNodes = 12) {
    const nodes = (snapshot.nodes || []).slice(0, maxNodes).map(compactNode).filter(Boolean);
    return {
      projectName: snapshot.projectName || '未命名项目',
      nodeCount: (snapshot.nodes || []).length,
      edgeCount: (snapshot.edges || []).length,
      selectedCount: (snapshot.selectedNodeIds || []).length,
      typeCounts: getTypeCounts(snapshot),
      selected: getSelectedContext(snapshot).slice(0, 6),
      nodes
    };
  }

  function formatNodeLine(node) {
    const parts = [`${node.title}(${node.type})`];
    if (node.prompt) parts.push(`提示词: ${node.prompt.slice(0, 180)}`);
    if (node.model) parts.push(`模型: ${node.model}`);
    if (node.provider) parts.push(`厂商: ${node.provider}`);
    if (node.status) parts.push(`状态: ${node.status}`);
    if (node.hasImage) parts.push('含图片/预览');
    if (node.tags?.length) parts.push(`标签: ${node.tags.join(', ')}`);
    return '- ' + parts.join(' | ');
  }

  function buildPromptContext(snapshot, options = {}) {
    const mode = options.mode || 'image';
    const targetNodeId = options.targetNodeId || '';
    const selected = getSelectedContext(snapshot, targetNodeId);
    if (!selected.length) return '';
    const lines = [
      '【画布上下文】',
      `项目名称: ${snapshot.projectName || '未命名项目'}`,
      `生成模式: ${mode}`,
      '当前选中节点:'
    ];
    selected.forEach(item => {
      lines.push(formatNodeLine(item.node));
      if (item.upstream.length) {
        lines.push('  上游连接:');
        item.upstream.slice(0, 6).forEach(up => lines.push('  ' + formatNodeLine(up.node)));
      }
      if (item.downstream.length) {
        lines.push('  下游连接:');
        item.downstream.slice(0, 6).forEach(down => lines.push('  ' + formatNodeLine(down.node)));
      }
    });
    lines.push('请只把这些信息作为一致性和上下文参考，不要把“画布上下文”字样写进画面。');
    return lines.join('\n');
  }

  window.FutureAICanvasContext = {
    getSelectedContext,
    getFullCanvasSummary,
    buildPromptContext,
    upstreamConnections,
    downstreamConnections
  };
})();
