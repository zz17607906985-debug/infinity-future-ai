(function () {
  'use strict';

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function cleanReferences(value) {
    return (Array.isArray(value) ? value : []).map(item => ({
      assetId: String(item?.assetId || ''),
      sourceNodeId: String(item?.sourceNodeId || ''),
      role: String(item?.role || 'reference'),
      order: Number(item?.order || 0),
      weight: Number(item?.weight ?? 1),
      frameTime: item?.frameTime == null ? null : Number(item.frameTime),
      notes: String(item?.notes || '')
    }));
  }

  function normalizeRecord(value = {}, index = 0) {
    const generatedAt = Number(value.generatedAt || Date.now());
    return {
      outputId: String(value.outputId || `output-${generatedAt}-${index}-${Math.random().toString(36).slice(2, 7)}`),
      url: String(value.url || ''),
      mediaType: ['image', 'video', 'audio'].includes(value.mediaType) ? value.mediaType : 'image',
      providerId: String(value.providerId || ''),
      providerName: String(value.providerName || ''),
      modelId: String(value.modelId || ''),
      capabilityProfileVersion: Number(value.capabilityProfileVersion || 1),
      requestProtocol: String(value.requestProtocol || ''),
      prompt: String(value.prompt || ''),
      parameters: clone(value.parameters || {}),
      references: cleanReferences(value.references),
      requested: clone(value.requested || {}),
      actual: clone(value.actual || {}),
      transformations: (Array.isArray(value.transformations) ? value.transformations : []).map(item => clone(item)),
      estimatedCost: value.estimatedCost == null ? null : clone(value.estimatedCost),
      approvalStatus: String(value.approvalStatus || 'unseen'),
      deliveryBatch: String(value.deliveryBatch || ''),
      generatedAt,
      fileHash: String(value.fileHash || ''),
      relativePath: String(value.relativePath || ''),
      licenseNotes: String(value.licenseNotes || '')
    };
  }

  function records(data = {}) {
    return (Array.isArray(data.provenanceRecords) ? data.provenanceRecords : []).map(normalizeRecord).filter(item => item.url);
  }

  function recordNodeOutputs(data = {}, outputs = []) {
    const list = records(data);
    const incoming = Array.isArray(outputs) ? outputs : [outputs];
    for (const [index, raw] of incoming.entries()) {
      const item = normalizeRecord(raw, index);
      if (!item.url) continue;
      const existing = list.find(value => value.url === item.url);
      if (existing) Object.assign(existing, item, {outputId: existing.outputId, transformations: existing.transformations});
      else list.unshift(item);
    }
    if (data.approval?.status === 'approved' && data.approval?.outputUrl && incoming.some(item => item?.url && item.url !== data.approval.outputUrl)) {
      data.approval = {...data.approval, status: 'invalidated', invalidatedAt: Date.now(), reason: '产出已更新，需要重新确认'};
    }
    data.provenanceRecords = list.slice(0, 100);
    return data.provenanceRecords;
  }

  function addTransformation(data = {}, url, transformation = {}) {
    const list = records(data);
    const item = list.find(value => value.url === url);
    if (!item) return null;
    item.transformations.push(Object.assign({at: Date.now(), kind: 'local-edit'}, clone(transformation)));
    item.approvalStatus = 'invalidated';
    if (data.approval?.status === 'approved' && data.approval?.outputUrl === url) {
      data.approval = {...data.approval, status: 'invalidated', invalidatedAt: Date.now(), reason: '已通过的产出发生本地修改，需要重新确认'};
    }
    data.provenanceRecords = list;
    return item;
  }

  function updateApproval(data = {}, url, status, batch = '') {
    const list = records(data);
    const item = list.find(value => value.url === url);
    if (!item) return null;
    item.approvalStatus = String(status || 'unseen');
    item.deliveryBatch = String(batch || item.deliveryBatch || '');
    data.provenanceRecords = list;
    return item;
  }

  function manifestFromNodes(nodes = []) {
    const output = [];
    for (const node of Array.isArray(nodes) ? nodes : []) {
      for (const record of records(node?.data || {})) {
        output.push(Object.assign({nodeId: String(node?.id || ''), nodeType: String(node?.type || '')}, clone(record)));
      }
    }
    return output.sort((a, b) => a.generatedAt - b.generatedAt);
  }

  window.FutureAIProvenance = {
    normalizeRecord,
    records,
    recordNodeOutputs,
    addTransformation,
    updateApproval,
    manifestFromNodes
  };
})();
