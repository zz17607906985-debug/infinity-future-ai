(() => {
  'use strict';

  /**
   * Canvas layout, viewport fit, node virtualization, and groups.
   */
  function create(deps = {}) {
    const host = deps.host || {};
    const $ = deps.$;
    const esc = deps.esc;
    const toast = deps.toast;
    const MediaDimensions = deps.MediaDimensions || window.FutureAIMediaDimensions;
    const {
      clampScale,
      screenToWorldPoint,
      viewportCenter,
      zoomAroundPoint,
      visibleWorldRect
    } = deps.canvasCore || window.FutureAICanvasCore || {};
    const saveProject = deps.saveProject;
    const scheduleDrawEdges = deps.scheduleDrawEdges;
    const drawEdges = deps.drawEdges;
    const nodeDisplayTitle = deps.nodeDisplayTitle;
    const nodeSize = deps.nodeSize;
    const hydrateNode = deps.hydrateNode;
    const selectSingleNode = deps.selectSingleNode;
    const clearSelection = deps.clearSelection;
    const releaseDrags = deps.releaseDrags;
    const updateZoomLabel = deps.updateZoomLabel;
    const updateSelectionToolbar = deps.updateSelectionToolbar || (() => {});
    const renderSelection = deps.renderSelection || (() => {});
    const queueSave = deps.queueSave || (() => {});
    const runWorkflowGroup = deps.runWorkflowGroup || (() => {});
    // setCanvasProxyActive / scheduleViewportInteractionEnd / scheduleTransform / applyTransform are defined in this module body

async function autoLayout(show) {
  if (applyStructuredLayout(show)) return;
  if (await autoLayoutWithElk(show)) return;
  fallbackAutoLayout(show);
}
function layoutNodeTypeRank(node) {
  return {
    prompt: 0,
    character: 0,
    upload: 1,
    comfyui: 2,
    image: 3,
    video: 4
  }[node?.type] ?? 5;
}
function layoutNodeSort(a, b) {
  const rank = layoutNodeTypeRank(a) - layoutNodeTypeRank(b);
  if (rank) return rank;
  const title = String(nodeDisplayTitle(a) || '').localeCompare(String(nodeDisplayTitle(b) || ''), 'zh-Hans-CN');
  if (title) return title;
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}
function canvasLayoutComponents() {
  const nodeIds = [...host.nodes.keys()];
  const adjacency = new Map(nodeIds.map(id => [id, new Set()]));
  host.edges.forEach(edge => {
    if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) return;
    adjacency.get(edge.from).add(edge.to);
    adjacency.get(edge.to).add(edge.from);
  });
  const seen = new Set();
  const components = [];
  nodeIds.sort((a, b) => layoutNodeTypeRank(host.nodes.get(a)) - layoutNodeTypeRank(host.nodes.get(b)) || String(a).localeCompare(String(b))).forEach(id => {
    if (seen.has(id)) return;
    const queue = [id];
    seen.add(id);
    const component = [];
    while (queue.length) {
      const current = queue.shift();
      component.push(current);
      adjacency.get(current)?.forEach(next => {
        if (seen.has(next)) return;
        seen.add(next);
        queue.push(next);
      });
    }
    components.push(component);
  });
  return components;
}
function layoutComponent(componentIds, originX, originY, columnGap = 340, rowGap = 180) {
  const componentSet = new Set(componentIds);
  const componentNodes = componentIds.map(id => host.nodes.get(id)).filter(Boolean);
  if (!componentNodes.length) return {width: 0, height: 0};
  const outgoing = new Map(componentNodes.map(node => [node.id, []]));
  const indegree = new Map(componentNodes.map(node => [node.id, 0]));
  host.edges.forEach(edge => {
    if (!componentSet.has(edge.from) || !componentSet.has(edge.to)) return;
    outgoing.get(edge.from)?.push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) || 0) + 1);
  });
  const depth = new Map(componentNodes.map(node => [node.id, Math.max(0, layoutNodeTypeRank(node) - 1)]));
  const queue = componentNodes.filter(node => (indegree.get(node.id) || 0) === 0).sort(layoutNodeSort);
  const indegreeCopy = new Map(indegree);
  const visited = new Set();
  while (queue.length) {
    const node = queue.shift();
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    const baseDepth = depth.get(node.id) || 0;
    (outgoing.get(node.id) || []).forEach(targetId => {
      const nextDepth = Math.max(depth.get(targetId) || 0, baseDepth + 1);
      depth.set(targetId, nextDepth);
      indegreeCopy.set(targetId, Math.max(0, (indegreeCopy.get(targetId) || 0) - 1));
      if (indegreeCopy.get(targetId) === 0) {
        const targetNode = host.nodes.get(targetId);
        if (targetNode && !visited.has(targetId) && !queue.some(item => item.id === targetId)) {
          queue.push(targetNode);
          queue.sort(layoutNodeSort);
        }
      }
    });
  }
  componentNodes.forEach(node => visited.has(node.id) || depth.set(node.id, Math.max(depth.get(node.id) || 0, layoutNodeTypeRank(node))));
  const layers = new Map();
  componentNodes.forEach(node => {
    const level = Math.max(0, Math.min(8, depth.get(node.id) || 0));
    if (!layers.has(level)) layers.set(level, []);
    layers.get(level).push(node);
  });
  const orderedLayers = [...layers.keys()].sort((a, b) => a - b);
  let maxLayerHeight = 0;
  let maxLevel = 0;
  orderedLayers.forEach(level => {
    const layerNodes = layers.get(level);
    layerNodes.sort(layoutNodeSort);
    maxLevel = Math.max(maxLevel, level);
    const layerHeight = layerNodes.reduce((sum, node) => sum + nodeSize(node).height, 0) + Math.max(0, layerNodes.length - 1) * rowGap;
    maxLayerHeight = Math.max(maxLayerHeight, layerHeight);
  });
  const layerWidths = orderedLayers.map(level => {
    const layerNodes = layers.get(level);
    return Math.max(...layerNodes.map(node => nodeSize(node).width), 0);
  });
  const componentWidth = Math.max(520, (maxLevel + 1) * columnGap + 220);
  const componentHeight = Math.max(320, maxLayerHeight + 140);
  orderedLayers.forEach(level => {
    const layerNodes = layers.get(level);
    const layerHeight = layerNodes.reduce((sum, node) => sum + nodeSize(node).height, 0) + Math.max(0, layerNodes.length - 1) * rowGap;
    let cursorY = originY + Math.max(0, (componentHeight - layerHeight) / 2);
    const cursorX = originX + level * columnGap;
    layerNodes.forEach(node => {
      moveNode(node, cursorX, cursorY);
      cursorY += nodeSize(node).height + rowGap;
    });
  });
  return {width: componentWidth, height: componentHeight};
}
function applyStructuredLayout(show) {
  if (!host.nodes.size) return false;
  const components = canvasLayoutComponents();
  if (!components.length) return false;
  let cursorX = 140;
  let cursorY = 150;
  let rowHeight = 0;
  const rowGap = 220;
  const columnGap = 220;
  components.forEach(component => {
    const layout = layoutComponent(component, cursorX, cursorY);
    cursorX += layout.width + columnGap;
    rowHeight = Math.max(rowHeight, layout.height);
    if (cursorX > 2460) {
      cursorX = 140;
      cursorY += rowHeight + rowGap;
      rowHeight = 0;
    }
  });
  drawEdges();
  requestAnimationFrame(drawEdges);
  saveProject();
  if (show) toast('已按流程结构整理画布', 'success');
  return true;
}
async function autoLayoutWithElk(show) {
  const engine = window.FutureAICanvasLayout;
  if (!engine?.layout || !host.nodes.size) return false;
  try {
    const graphNodes = [...host.nodes.values()].map(node => {
      const size = nodeSize(node);
      return {
        id: node.id,
        type: node.type,
        width: size.width,
        height: size.height
      };
    });
    const graphEdges = host.edges.map((edge, index) => ({
      id: `edge-${index}`,
      from: edge.from,
      to: edge.to,
      fromPort: edge.fromPort || '',
      toPort: edge.toPort || ''
    }));
    const result = await engine.layout({
      nodes: graphNodes,
      edges: graphEdges,
      direction: 'RIGHT',
      nodeSpacing: 88,
      layerSpacing: 170
    });
    const positions = Array.isArray(result?.nodes) ? result.nodes : [];
    if (!positions.length) return false;
    const map = new Map(positions.map(item => [item.id, item]));
    host.nodes.forEach(node => {
      const pos = map.get(node.id);
      if (!pos) return;
      moveNode(node, Number(pos.x || 0) + 120, Number(pos.y || 0) + 120);
    });
    drawEdges();
    requestAnimationFrame(drawEdges);
    saveProject();
    if (show) toast('已用 ELK 智能整理画布', 'success');
    return true;
  } catch (err) {
    console.warn('ELK layout failed, fallback layout used', err);
    if (show) toast('ELK 智能整理失败，已使用基础整理', 'warn');
    return false;
  }
}
function snapLayoutValue(value) {
  return Math.round(value / 10) * 10;
}
function layoutCommit(show, message = '画布已整理') {
  drawEdges();
  requestAnimationFrame(drawEdges);
  updateSelectionToolbar();
  saveProject();
  if (show) toast(message, 'success');
}
function tidySelectedNodesByRows(targetNodes, show) {
  const sorted = targetNodes.slice().sort((a, b) => a.y - b.y || a.x - b.x || layoutNodeSort(a, b));
  const rowBreak = 150;
  const rows = [];
  sorted.forEach(node => {
    const row = rows.find(item => Math.abs(item.anchor - node.y) < rowBreak);
    if (row) {
      row.nodes.push(node);
      row.anchor = row.nodes.reduce((sum, item) => sum + item.y, 0) / row.nodes.length;
    } else {
      rows.push({anchor: node.y, nodes: [node]});
    }
  });
  rows.sort((a, b) => a.anchor - b.anchor);
  rows.forEach(row => row.nodes.sort((a, b) => a.x - b.x || layoutNodeSort(a, b)));
  const columnCount = Math.max(...rows.map(row => row.nodes.length), 1);
  const columnWidths = Array.from({length: columnCount}, (_, index) => Math.max(...rows.map(row => row.nodes[index] ? nodeSize(row.nodes[index]).width : 0), 0));
  const rowHeights = rows.map(row => Math.max(...row.nodes.map(node => nodeSize(node).height), 0));
  const minX = Math.min(...targetNodes.map(node => node.x));
  const minY = Math.min(...targetNodes.map(node => node.y));
  const columnGap = 18;
  const rowGap = 18;
  const columnX = [];
  columnWidths.reduce((cursor, width, index) => {
    columnX[index] = snapLayoutValue(cursor);
    return cursor + width + columnGap;
  }, snapLayoutValue(minX));
  let y = snapLayoutValue(minY);
  rows.forEach((row, rowIndex) => {
    row.nodes.forEach((node, columnIndex) => moveNode(node, columnX[columnIndex], y));
    y += rowHeights[rowIndex] + rowGap;
  });
  layoutCommit(show, `已整理选中节点：${targetNodes.length} 个`);
}
function tidyCanvasDepth(nodeList) {
  const targetIds = new Set(nodeList.map(node => node.id));
  const incoming = new Map(nodeList.map(node => [node.id, []]));
  const outgoing = new Map(nodeList.map(node => [node.id, []]));
  host.edges.forEach(edge => {
    if (!targetIds.has(edge.from) || !targetIds.has(edge.to)) return;
    outgoing.get(edge.from)?.push(edge.to);
    incoming.get(edge.to)?.push(edge.from);
  });
  const depth = new Map(nodeList.map(node => [node.id, Math.max(0, layoutNodeTypeRank(node) - 1)]));
  const indegree = new Map(nodeList.map(node => [node.id, incoming.get(node.id)?.length || 0]));
  const queue = nodeList.filter(node => !indegree.get(node.id)).sort((a, b) => a.x - b.x || a.y - b.y || layoutNodeSort(a, b));
  const visited = new Set();
  while (queue.length) {
    const node = queue.shift();
    if (!node || visited.has(node.id)) continue;
    visited.add(node.id);
    (outgoing.get(node.id) || []).forEach(targetId => {
      const target = host.nodes.get(targetId);
      depth.set(targetId, Math.max(depth.get(targetId) || 0, (depth.get(node.id) || 0) + 1));
      indegree.set(targetId, Math.max(0, (indegree.get(targetId) || 0) - 1));
      if (target && indegree.get(targetId) === 0) {
        queue.push(target);
        queue.sort((a, b) => a.x - b.x || a.y - b.y || layoutNodeSort(a, b));
      }
    });
  }
  nodeList.forEach(node => {
    if (visited.has(node.id)) return;
    const parents = incoming.get(node.id) || [];
    if (parents.length) depth.set(node.id, Math.max(...parents.map(id => depth.get(id) || 0)) + 1);
  });
  return depth;
}
function tidyCanvasGrid(show) {
  const selected = [...host.selectedNodes].map(id => host.nodes.get(id)).filter(Boolean);
  const targetNodes = selected.length >= 2 ? selected : [...host.nodes.values()];
  if (!targetNodes.length) return toast('画布里还没有节点', 'warn');
  if (targetNodes.length === 1) return toast('至少需要 2 个节点才能整理', 'warn');
  if (selected.length >= 2) return tidySelectedNodesByRows(targetNodes, show);
  const depth = tidyCanvasDepth(targetNodes);
  const columns = new Map();
  targetNodes.forEach(node => {
    const level = Math.max(0, Math.min(10, depth.get(node.id) || 0));
    if (!columns.has(level)) columns.set(level, []);
    columns.get(level).push(node);
  });
  const activeColumns = [...columns.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, list]) => list.sort((a, b) => a.y - b.y || a.x - b.x || layoutNodeSort(a, b)));
  const minX = snapLayoutValue(Math.min(...targetNodes.map(node => node.x), 140));
  const minY = snapLayoutValue(Math.min(...targetNodes.map(node => node.y), 160));
  const columnGap = 58;
  const rowGap = 24;
  let x = minX;
  activeColumns.forEach(column => {
    const width = Math.max(...column.map(node => nodeSize(node).width), 320);
    let y = minY;
    column.forEach(node => {
      moveNode(node, snapLayoutValue(x), snapLayoutValue(y));
      y += nodeSize(node).height + rowGap;
    });
    x += width + columnGap;
  });
  layoutCommit(show, `已一键整理画布：${targetNodes.length} 个节点`);
}
function fallbackAutoLayout(show) {
  const prompts = [...host.nodes.values()].filter(n => n.type === 'prompt' || n.type === 'character');
  const uploads = [...host.nodes.values()].filter(n => n.type === 'upload');
  const comfy = [...host.nodes.values()].filter(n => n.type === 'comfyui');
  const images = [...host.nodes.values()].filter(n => n.type === 'image');
  const videos = [...host.nodes.values()].filter(n => n.type === 'video');
  prompts.forEach((n, i) => moveNode(n, 140, 180 + i * 240));
  uploads.forEach((n, i) => moveNode(n, 460, 180 + i * 260));
  comfy.forEach((n, i) => moveNode(n, 460, 180 + uploads.length * 260 + i * 280));
  images.forEach((n, i) => moveNode(n, 820, 160 + i * 280));
  videos.forEach((n, i) => moveNode(n, 1240, 160 + i * 280));
  layoutCommit(show);
}
function fitView(show) {
  const arr = [...host.nodes.values()];
  if (!arr.length) return resetView(show);
  const minX = Math.min(...arr.map(n => n.x));
  const minY = Math.min(...arr.map(n => n.y));
  host.scale = .98;
  host.offsetX = 120 - minX * host.scale;
  host.offsetY = 180 - minY * host.scale;
  applyTransform();
  drawEdges();
  saveProject();
  if (show) toast('已适配画布内容', 'success');
}
function fitNodeIntoView(node, show = false) {
  if (!node) return;
  const canvas = $('canvas');
  const size = nodeSize(node);
  const rect = canvas.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const nodeCx = node.x + size.width / 2;
  const nodeCy = node.y + size.height / 2;
  host.offsetX = cx - nodeCx * host.scale;
  host.offsetY = cy - nodeCy * host.scale;
  applyTransform();
  drawEdges();
  if (show) toast('已居中当前节点', 'success');
}
function resetView(show) {
  host.scale = 1; host.offsetX = 96; host.offsetY = 128;
  applyTransform(); drawEdges(); saveProject();
  if (show) toast('视图已重置', 'success');
}
function moveNode(n, x, y) {
  n.x = x; n.y = y;
  n.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
}
function scheduleTransform(updateVisibility = true, updateToolbar = true) {
  if (host.transformFrame) return;
  host.transformFrame = requestAnimationFrame(() => {
    host.transformFrame = null;
    applyTransform(updateVisibility, updateToolbar);
  });
}
function applyTransform(updateVisibility = true, updateToolbar = true) {
  $('viewport').style.transform = `translate(${host.offsetX}px, ${host.offsetY}px) scale(${host.scale})`;
  $('viewport').style.setProperty('--port-inverse-scale', String(1 / Math.max(host.scale, .2)));
  $('viewport').style.setProperty('--canvas-zoom-inverse', String(1 / Math.max(host.scale, .2)));
  updateZoomLabel();
  if (updateToolbar) updateSelectionToolbar();
  if (updateVisibility) scheduleVisibilityUpdate();
  if (host.canvasProxyActive) scheduleCanvasProxyDraw();
}
function proxyNodeSize(node) {
  const width = node.type === 'image' || node.type === 'upload' ? 292 * nodeMediaAspectRatio(node) + 2
    : node.type === 'video' || node.type === 'comfyui' ? 430 : 320;
  const height = node.type === 'image' || node.type === 'upload' ? 292
    : node.type === 'video' ? 292 : node.type === 'comfyui' ? 260 : 180;
  return {width, height};
}
function nodeMediaAspectRatio(node) {
  if (!node || (node.type !== 'image' && node.type !== 'video' && node.type !== 'upload')) return 1;
  if (Number.isFinite(node.mediaNaturalRatio) && node.mediaNaturalRatio > 0) return node.mediaNaturalRatio;
  if (node.type === 'upload') return 16 / 9;
  return MediaDimensions?.mediaAspectRatio(node.data, node.type) || 1;
}
function setCanvasProxyActive(active) {
  const shouldUseProxy = !!active && host.fastCanvasMode;
  if (host.canvasProxyActive === shouldUseProxy) return;
  host.canvasProxyActive = shouldUseProxy;
  $('canvas')?.classList.toggle('proxy-active', host.canvasProxyActive);
  if (host.canvasProxyActive) scheduleCanvasProxyDraw();
  else {
    if (host.canvasProxyFrame) cancelAnimationFrame(host.canvasProxyFrame);
    host.canvasProxyFrame = null;
    const proxy = $('canvasProxyLayer');
    const ctx = proxy?.getContext?.('2d');
    if (ctx) ctx.clearRect(0, 0, proxy.width || 0, proxy.height || 0);
  }
}
function scheduleCanvasProxyDraw() {
  if (host.canvasProxyFrame) return;
  host.canvasProxyFrame = requestAnimationFrame(() => {
    host.canvasProxyFrame = null;
    drawCanvasProxy();
  });
}
function drawCanvasProxy() {
  if (!host.canvasProxyActive) return;
  const canvas = $('canvas');
  const proxy = $('canvasProxyLayer');
  if (!canvas || !proxy) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (proxy.width !== width || proxy.height !== height) {
    proxy.width = width;
    proxy.height = height;
    proxy.style.width = rect.width + 'px';
    proxy.style.height = rect.height + 'px';
  }
  const ctx = proxy.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.lineWidth = 1;
  ctx.font = '12px system-ui, sans-serif';
  host.nodes.forEach(node => {
    if (node.el?.classList.contains('search-hidden')) return;
    const size = proxyNodeSize(node);
    const x = node.x * host.scale + host.offsetX;
    const y = node.y * host.scale + host.offsetY;
    const w = Math.max(44, size.width * host.scale);
    const h = Math.max(28, size.height * host.scale);
    if (x > rect.width + 80 || y > rect.height + 80 || x + w < -80 || y + h < -80) return;
    const color = node.type === 'image' ? '#f5c842' : node.type === 'video' ? '#6ea8ff' : node.type === 'comfyui' ? '#4ade80' : '#dbe7ef';
    ctx.fillStyle = 'rgba(17, 23, 31, .78)';
    ctx.strokeStyle = color;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 7);
    else ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.stroke();
    if (host.scale > .45) {
      ctx.fillStyle = color;
      const title = String(nodeDisplayTitle(node) || '节点').slice(0, 18);
      ctx.fillText(title, x + 10, y + 20);
    }
  });
}
function scheduleViewportInteractionEnd() {
  clearTimeout(host.viewportInteractionTimer);
  host.viewportInteractionTimer = setTimeout(() => {
    host.viewportInteractionTimer = null;
    $('canvas')?.classList.remove('is-panning', 'is-zooming');
    setCanvasProxyActive(false);
    updateSelectionToolbar();
    scheduleVisibilityUpdate();
    queueSave();
  }, 140);
}
function currentWorldBounds(pad = 0) {
  const r = $('canvas').getBoundingClientRect();
  return visibleWorldRect({width: r.width, height: r.height, scale: host.scale, offsetX: host.offsetX, offsetY: host.offsetY, pad});
}
function nodeIntersectsView(node, view) {
  const size = proxyNodeSize(node);
  return node.x < view.right && node.x + size.width > view.left && node.y < view.bottom && node.y + size.height > view.top;
}
function mountNode(node) {
  if (!node?.el || node.mounted) return;
  $('viewport')?.appendChild(node.el);
  node.mounted = true;
  node.el.classList.remove('node-virtual-hidden');
}
function unmountNode(node) {
  if (!node?.el || !node.mounted) return;
  node.el.remove();
  node.mounted = false;
  node.el.classList.add('node-virtual-hidden');
}
function shouldVirtualizeNode(node, view) {
  if (!node || host.selectedNodes.has(node.id)) return false;
  if (host.dragging?.items?.some(item => item.node?.id === node.id)) return false;
  return !nodeIntersectsView(node, view);
}
function scheduleVisibilityUpdate() {
  if (host.visibilityTimer) return;
  host.visibilityTimer = requestAnimationFrame(() => {
    host.visibilityTimer = null;
    const detailView = currentWorldBounds(900);
    const renderView = currentWorldBounds(1800);
    let changed = false;
    host.nodes.forEach(node => {
      const virtualHidden = shouldVirtualizeNode(node, renderView);
      const wasMounted = !!node.mounted;
      if (virtualHidden) unmountNode(node);
      else mountNode(node);
      if (wasMounted !== !!node.mounted) changed = true;
      node.el.classList.toggle('node-offscreen', node.mounted && !nodeIntersectsView(node, detailView));
    });
    if (changed) scheduleDrawEdges();
  });
}
function groupBounds(group) {
  const items = group.nodeIds.map(id => host.nodes.get(id)).filter(Boolean);
  if (!items.length) return null;
  const pad = 28;
  const left = Math.min(...items.map(n => n.x)) - pad;
  const top = Math.min(...items.map(n => n.y)) - pad;
  const right = Math.max(...items.map(n => n.x + nodeSize(n).width)) + pad;
  const bottom = Math.max(...items.map(n => n.y + nodeSize(n).height)) + pad;
  return {left, top, width: right - left, height: bottom - top};
}
function addGroup(nodeIds, id = null, name = '', save = true, metadata = {}) {
  const unique = [...new Set(nodeIds)].filter(nodeId => host.nodes.has(nodeId));
  if (unique.length < 2) return null;
  const group = {
    id: id || 'g_' + (host.nextGroupSeq()),
    name: name || metadata.name || '组 ' + (host.groupSeq || host.groups.size + 1),
    nodeIds: unique,
    workflowId: String(metadata.workflowId || ''),
    workflowVersion: String(metadata.workflowVersion || ''),
    workflowDefinition: metadata.workflowDefinition || null,
    collapsed: Boolean(metadata.collapsed),
    el: document.createElement('div')
  };
  group.el.className = 'canvas-group';
  group.el.dataset.group = group.id;
  group.el.innerHTML = `<div class="canvas-group-label"><i class="fa-regular fa-object-group"></i><span>${esc(group.name)}</span>${group.workflowVersion ? `<em>v${esc(group.workflowVersion)}</em>` : ''}<button type="button" data-run-group="${esc(group.id)}" title="单步运行组合"><i class="fa-solid fa-play"></i></button><button type="button" data-toggle-group="${esc(group.id)}" title="展开或折叠组合"><i class="fa-solid ${group.collapsed ? 'fa-up-right-and-down-left-from-center' : 'fa-down-left-and-up-right-to-center'}"></i></button><button type="button" data-ungroup-group="${esc(group.id)}" title="解散组"><i class="fa-regular fa-object-ungroup"></i></button></div>`;
  group.el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    if (e.target.closest('[data-ungroup-group],[data-toggle-group],[data-run-group]')) return;
    selectGroupNodes(group.id);
    e.preventDefault();
    e.stopPropagation();
  });
  group.el.addEventListener('click', e => {
    const btn = e.target.closest('[data-ungroup-group]');
    const toggle = e.target.closest('[data-toggle-group]');
    const run = e.target.closest('[data-run-group]');
    if (btn) ungroupGroup(btn.dataset.ungroupGroup);
    else if (toggle) toggleGroupCollapsed(toggle.dataset.toggleGroup);
    else if (run) runWorkflowGroup(run.dataset.runGroup);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  $('viewport').appendChild(group.el);
  host.groups.set(group.id, group);
  renderGroup(group);
  if (save) saveProject();
  return group;
}
function renderGroup(group) {
  const bounds = groupBounds(group);
  if (!bounds) {
    group.el.classList.add('hidden');
    return;
  }
  group.el.classList.remove('hidden');
  group.el.classList.toggle('workflow-group', Boolean(group.workflowId || group.workflowDefinition));
  group.el.classList.toggle('collapsed', Boolean(group.collapsed));
  group.nodeIds.forEach(id => host.nodes.get(id)?.el?.classList.toggle('workflow-collapsed-node', Boolean(group.collapsed)));
  group.el.style.transform = `translate3d(${bounds.left}px, ${bounds.top}px, 0)`;
  group.el.style.width = (group.collapsed ? Math.max(280, Math.min(420, bounds.width)) : bounds.width) + 'px';
  group.el.style.height = (group.collapsed ? 76 : bounds.height) + 'px';
}
function renderGroups() {
  host.groups.forEach(renderGroup);
}
function scheduleGroupRender() {
  if (host.groupFrame) return;
  host.groupFrame = requestAnimationFrame(() => {
    host.groupFrame = null;
    if (host.dragging?.items?.length) {
      const moved = new Set(host.dragging.items.map(item => item.node.id));
      host.groups.forEach(group => {
        if (group.nodeIds.some(id => moved.has(id))) renderGroup(group);
      });
    } else {
      renderGroups();
      updateSelectionToolbar();
    }
  });
}
function groupSelectedNodes() {
  if (host.selectedNodes.size < 2) return toast('请先框选至少 2 个节点', 'warn');
  const group = addGroup([...host.selectedNodes]);
  renderSelection();
  toast(group ? '已将选中节点打组' : '打组失败', group ? 'success' : 'warn');
}
function ungroupSelectedNodes() {
  const selected = new Set(host.selectedNodes);
  let count = 0;
  host.groups.forEach(group => {
    if (group.nodeIds.some(id => selected.has(id))) {
      group.el?.remove();
      host.groups.delete(group.id);
      count++;
    }
  });
  renderSelection();
  saveProject();
  toast(count ? '已取消选中节点所在组' : '选中节点不在组内', count ? 'success' : 'warn');
}
function selectGroupNodes(groupId) {
  const group = host.groups.get(groupId);
  if (!group) return;
  host.selectedNodes.clear();
  group.nodeIds.filter(id => host.nodes.has(id)).forEach(id => host.selectedNodes.add(id));
  renderSelection();
}
function toggleGroupCollapsed(groupId) {
  const group = host.groups.get(groupId);
  if (!group) return;
  group.collapsed = !group.collapsed;
  group.el.querySelector('[data-toggle-group] i')?.classList.toggle('fa-up-right-and-down-left-from-center', group.collapsed);
  group.el.querySelector('[data-toggle-group] i')?.classList.toggle('fa-down-left-and-up-right-to-center', !group.collapsed);
  renderGroup(group);
  drawEdges();
  saveProject();
}
function ungroupGroup(groupId) {
  const group = host.groups.get(groupId);
  if (!group) return toast('组不存在或已解散', 'warn');
  group.nodeIds.filter(id => host.nodes.has(id)).forEach(id => host.selectedNodes.add(id));
  group.el?.remove();
  host.groups.delete(group.id);
  renderSelection();
  saveProject();
  toast('已解散组：' + group.name, 'success');
}
function expandNodeIdsForGroups(ids) {
  const expanded = new Set(ids);
  host.groups.forEach(group => {
    if (group.nodeIds.some(id => expanded.has(id))) group.nodeIds.forEach(id => expanded.add(id));
  });
  return expanded;
}
function removeNodeFromGroups(nodeId) {
  host.groups.forEach(group => {
    group.nodeIds = group.nodeIds.filter(id => id !== nodeId);
    if (group.nodeIds.length < 2) {
      group.el?.remove();
      host.groups.delete(group.id);
    }
  });
  scheduleGroupRender();
}
function screenToWorld(clientX, clientY) {
  const r = $('canvas').getBoundingClientRect();
  return screenToWorldPoint({clientX, clientY, rectLeft: r.left, rectTop: r.top, scale: host.scale, offsetX: host.offsetX, offsetY: host.offsetY});
}
function viewCenter() {
  const r = $('canvas').getBoundingClientRect();
  return viewportCenter({width: r.width, height: r.height, scale: host.scale, offsetX: host.offsetX, offsetY: host.offsetY});
}
    return {
      autoLayout,
      layoutNodeTypeRank,
      layoutNodeSort,
      canvasLayoutComponents,
      layoutComponent,
      applyStructuredLayout,
      autoLayoutWithElk,
      snapLayoutValue,
      layoutCommit,
      tidySelectedNodesByRows,
      tidyCanvasDepth,
      tidyCanvasGrid,
      fallbackAutoLayout,
      fitView,
      fitNodeIntoView,
      resetView,
      moveNode,
      scheduleTransform,
      applyTransform,
      proxyNodeSize,
      setCanvasProxyActive,
      scheduleCanvasProxyDraw,
      drawCanvasProxy,
      scheduleViewportInteractionEnd,
      currentWorldBounds,
      nodeIntersectsView,
      mountNode,
      unmountNode,
      shouldVirtualizeNode,
      scheduleVisibilityUpdate,
      groupBounds,
      addGroup,
      renderGroup,
      renderGroups,
      scheduleGroupRender,
      groupSelectedNodes,
      ungroupSelectedNodes,
      selectGroupNodes,
      toggleGroupCollapsed,
      ungroupGroup,
      expandNodeIdsForGroups,
      removeNodeFromGroups,
      screenToWorld,
      viewCenter
    };
  }

  window.FutureAICanvasLayout = { create };
})();
