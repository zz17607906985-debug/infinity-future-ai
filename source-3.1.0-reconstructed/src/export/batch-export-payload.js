(() => {
  'use strict';

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function prepareNodeForDelivery(node = {}) {
    const output = clone(node) || {};
    const data = output.data || {};
    const variants = Array.isArray(data.variants) ? data.variants : [];
    if (variants.length) {
      const approved = variants.filter(item => item?.status === 'approved' && item?.url);
      const approvedUrls = approved.map(item => item.url);
      data.variants = approved;
      data.urls = approvedUrls;
      data.url = approvedUrls[0] || '';
      data.deliveryBlocked = approvedUrls.length === 0;
      if (Array.isArray(data.provenanceRecords)) data.provenanceRecords = data.provenanceRecords.filter(item => approvedUrls.includes(item?.url));
    }
    output.data = data;
    return output;
  }

  function buildBatchExportPayload({
    storageDir = '',
    currentProjectId = '',
    projects = [],
    canvas = {},
    selectedNodes = [],
    nodes = new Map(),
    history = [],
    settingsSummary = {}
  } = {}) {
    const project = projects.find(item => item.id === currentProjectId) || {};
    const selectedNodeIds = [...selectedNodes];
    const selectedNodeSet = new Set(selectedNodeIds);
    const canvasForDelivery = clone(canvas) || {};
    canvasForDelivery.nodes = (Array.isArray(canvasForDelivery.nodes) ? canvasForDelivery.nodes : []).map(prepareNodeForDelivery);
    const selectedForDelivery = selectedNodeIds.map(id => nodes.get(id)).filter(Boolean).map(node => prepareNodeForDelivery({id: node.id, type: node.type, x: node.x, y: node.y, data: node.data}));
    const allDeliveryNodes = canvasForDelivery.nodes;
    const blockedCandidateNodes = allDeliveryNodes.filter(node => node.data?.deliveryBlocked).length;
    const provenance = allDeliveryNodes.flatMap(node => (Array.isArray(node.data?.provenanceRecords) ? node.data.provenanceRecords : []).map(record => ({...record, nodeId: node.id, nodeType: node.type})));
    return {
      storageDir,
      currentProjectId,
      project: {
        id: project.id || '',
        name: project.name || '未命名项目',
        templateId: project.templateId || canvas.templateId || 'default',
        createdAt: project.createdAt || 0,
        updatedAt: Date.now()
      },
      canvas: canvasForDelivery,
      selectedNodeIds,
      selectedNodes: selectedForDelivery,
      history: history.filter(item => !item.projectId || item.projectId === currentProjectId),
      provenance,
      settingsSummary: {
        ...settingsSummary,
        selectedCount: selectedNodeSet.size,
        blockedCandidateNodes
      }
    };
  }

  window.FutureAIBatchExportPayload = {
    prepareNodeForDelivery,
    buildBatchExportPayload
  };
})();
