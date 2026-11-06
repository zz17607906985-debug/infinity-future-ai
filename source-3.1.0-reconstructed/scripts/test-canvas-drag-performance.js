'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
assert.match(html, /id="canvasMinimap"/);
assert.match(html, /id="toggleMinimapBtn"/);
assert.match(html, /canvas\/minimap\.js/);
assert.match(app, /installCanvasMinimap\(\)/);
assert.match(styles, /\.bottom-canvas-tools \.canvas-minimap\{/);

const svg = {
  paths: [],
  replacements: 0,
  querySelectorAll: () => svg.paths,
  replaceChildren(fragment) {
    svg.paths = fragment.children;
    svg.replacements++;
  }
};
const viewport = {getBoundingClientRect: () => ({left: 0, top: 0, width: 1000, height: 800})};
const canvas = {getBoundingClientRect: () => ({left: 0, top: 0, width: 1000, height: 800})};
const document = {
  body: {style: {}},
  createDocumentFragment: () => ({children: [], appendChild(child) { this.children.push(child); }}),
  createElementNS: () => ({dataset: {}, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }}),
  querySelectorAll: () => []
};
const elements = {edges: svg, viewport, canvas};
const nodes = new Map();
let geometryReads = 0;
for (let index = 0; index < 80; index++) {
  const node = {id: `n${index}`, x: index * 10, y: index * 5, type: 'prompt', mounted: true};
  const port = io => ({
    classList: {add() {}},
    getBoundingClientRect() {
      geometryReads++;
      return {left: node.x + (io === 'out' ? 100 : 0), top: node.y + 20, width: 0, height: 0};
    }
  });
  node.el = {
    offsetWidth: 100, offsetHeight: 80,
    classList: {add() {}, contains: () => false},
    querySelector: selector => port(selector.includes('data-io="out"') ? 'out' : 'in'),
    setPointerCapture() {}
  };
  nodes.set(node.id, node);
}
const host = {
  nodes, groups: new Map(), selectedNodes: new Set(['n0']),
  edges: Array.from({length: 79}, (_, index) => ({
    from: `n${index}`, to: `n${index + 1}`, fromPort: 'out', toPort: 'in'
  })),
  scale: 1
};
const context = {window: {}, document, performance, requestAnimationFrame: fn => fn()};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'src', 'canvas', 'runtime.js'), 'utf8'), context);
const runtime = context.window.FutureAICanvasRuntime.create({
  host, $: id => elements[id],
  canvasEdges: {
    portCenterFromRects: ({portRect}) => ({x: portRect.left, y: portRect.top}),
    fallbackPortCenter: () => ({x: 0, y: 0}),
    edgePathD: (a, b) => `${a.x},${a.y}-${b.x},${b.y}`,
    segmentIntersectsView: () => true,
    edgeClassName: () => 'edge'
  },
  currentWorldBounds: () => ({left: -100, top: -100, right: 2000, bottom: 2000}),
  releaseDrags: () => {},
  expandNodeIdsForGroups: ids => ids
});

runtime.drawEdges();
assert.equal(svg.replacements, 1);
const initialFirstPath = svg.paths[0].attributes.d;
const initialSecondPath = svg.paths[1].attributes.d;
const initialGeometryReads = geometryReads;
runtime.beginNodeDrag(nodes.get('n0'), {clientX: 0, clientY: 0}, 1);
assert.ok(geometryReads > initialGeometryReads, 'port anchors are measured once at drag start');
const dragGeometryReads = geometryReads;
nodes.get('n0').x = 30;
nodes.get('n0').y = 40;
runtime.scheduleDrawEdges();
assert.equal(svg.replacements, 1, 'drag must not rebuild the full SVG');
assert.equal(geometryReads, dragGeometryReads, 'drag updates must not read live layout');
assert.notEqual(svg.paths[0].attributes.d, initialFirstPath, 'connected edge follows the dragged node');
assert.equal(svg.paths[1].attributes.d, initialSecondPath, 'unrelated edge remains untouched');
host.dragging = null;
runtime.drawEdges();
assert.equal(svg.replacements, 2, 'release performs a complete edge refresh');

const minimapListeners = new Map();
const panelClasses = new Set(['hidden']);
const panel = {
  classList: {
    contains: name => panelClasses.has(name),
    toggle: (name, active) => active ? panelClasses.add(name) : panelClasses.delete(name)
  },
  setAttribute() {},
  addEventListener: (name, handler) => minimapListeners.set(`panel:${name}`, handler)
};
const mapCanvas = {
  clientWidth: 200, clientHeight: 128,
  addEventListener: (name, handler) => minimapListeners.set(name, handler),
  setPointerCapture() {},
  getBoundingClientRect: () => ({left: 0, top: 0}),
  getContext: () => ({
    setTransform() {}, clearRect() {}, fillRect() {}, strokeRect() {}, save() {}, restore() {}
  })
};
const minimapContext = {
  window: {devicePixelRatio: 1},
  document: {body: {}},
  getComputedStyle: () => ({getPropertyValue: () => '#4fd6e8'}),
  performance: {now: () => 1000},
  setTimeout: callback => callback(),
  requestAnimationFrame: callback => callback()
};
vm.createContext(minimapContext);
vm.runInContext(fs.readFileSync(path.join(root, 'src', 'canvas', 'minimap.js'), 'utf8'), minimapContext);
let center = null;
const minimap = minimapContext.window.FutureAICanvasMinimap.create({
  panel, canvas: mapCanvas,
  getView: () => ({nodes, scale: 1, offsetX: 0, offsetY: 0, canvasRect: {width: 1000, height: 800}}),
  nodeSize: () => ({width: 100, height: 80}),
  setViewCenter: (x, y) => { center = {x, y}; }
});
minimap.setEnabled(true);
assert.equal(panelClasses.has('hidden'), false, 'minimap is visible when enabled');
minimapListeners.get('pointerdown')({
  button: 0, pointerId: 1, clientX: 100, clientY: 64,
  preventDefault() {}, stopPropagation() {}
});
assert.ok(center && Math.abs(center.x - 500) < 1 && Math.abs(center.y - 400) < 1, 'map center pans to world center');
minimap.setEnabled(false);
assert.equal(panelClasses.has('hidden'), true, 'minimap can be hidden');

let proxyDraws = 0;
let proxyRectReads = 0;
let viewportTransformWrites = 0;
let viewportVariableWrites = 0;
let clock = 1000;
const frames = [];
const timers = [];
let nextFrame = 0;
const proxyCanvas = {
  style: {},
  getContext: () => ({
    setTransform() {}, clearRect() { proxyDraws++; },
    beginPath() {}, roundRect() {}, rect() {}, fill() {}, stroke() {}, fillText() {}
  })
};
const panCanvas = {
  classList: {add() {}, remove() {}, toggle() {}},
  getBoundingClientRect() {
    proxyRectReads++;
    return {width: 1000, height: 800};
  }
};
const panViewport = {style: {
  set transform(value) {
    viewportTransformWrites++;
    this.currentTransform = value;
  },
  setProperty() { viewportVariableWrites++; }
}};
const panHost = {
  nodes: new Map([['one', {type: 'prompt', x: 10, y: 20, el: {classList: {contains: () => false}}}]]),
  selectedNodes: new Set(), scale: 1, offsetX: 0, offsetY: 0, fastCanvasMode: true
};
const panContext = {
  window: {devicePixelRatio: 1}, performance: {now: () => clock},
  requestAnimationFrame: fn => { const id = ++nextFrame; frames.push({id, fn}); return id; },
  cancelAnimationFrame: id => { const index = frames.findIndex(frame => frame.id === id); if (index >= 0) frames.splice(index, 1); },
  setTimeout: fn => { timers.push(fn); return timers.length; },
  clearTimeout: () => {}
};
vm.createContext(panContext);
vm.runInContext(fs.readFileSync(path.join(root, 'src', 'canvas', 'layout.js'), 'utf8'), panContext);
const layout = panContext.window.FutureAICanvasLayout.create({
  host: panHost, $: id => ({canvas: panCanvas, canvasProxyLayer: proxyCanvas, viewport: panViewport})[id],
  updateZoomLabel() {}, nodeDisplayTitle: () => 'Node'
});
const flushFrames = () => { while (frames.length) frames.shift().fn(); };
layout.setCanvasProxyActive(true);
assert.equal(proxyDraws, 1, 'proxy starts with one snapshot');
assert.equal(viewportTransformWrites, 0, 'opening proxy does not transform the real viewport');
for (let x = 1; x <= 40; x++) {
  panHost.offsetX = x * 4;
  layout.applyTransform(false, false);
}
assert.equal(proxyDraws, 1, 'short pan reuses the bitmap snapshot');
assert.equal(proxyRectReads, 1, 'short pan does not force a layout read per frame');
assert.equal(viewportTransformWrites, 0, 'pan does not transform the hidden viewport');
assert.equal(viewportVariableWrites, 0, 'pan does not cascade viewport CSS variables');
assert.match(proxyCanvas.style.transform, /translate3d\(160px, 0px, 0\)/);
panHost.scale = 1.2;
layout.applyTransform(false, false);
assert.match(proxyCanvas.style.transform, /scale\(1\.2\)/, 'zoom scales the proxy');
assert.equal(viewportTransformWrites, 0, 'zoom leaves the hidden viewport untouched');
panHost.offsetX = 400;
layout.applyTransform(false, false);
assert.equal(timers.length, 1, 'long pan schedules one throttled refresh');
clock += 120;
timers.shift()();
flushFrames();
assert.equal(proxyDraws, 2, 'long pan refreshes after crossing the buffer');
panHost.offsetX = 450;
layout.scheduleTransform(false, false);
layout.setCanvasProxyActive(false);
flushFrames();
assert.equal(viewportTransformWrites, 1, 'release commits the real viewport exactly once');
assert.equal(viewportVariableWrites, 2, 'release commits the zoom variables exactly once');
assert.match(panViewport.style.currentTransform, /translate\(450px, 0px\) scale\(1\.2\)/);
assert.equal(panHost.canvasProxySnapshot, null);

const normalDraws = proxyDraws;
for (let x = 0; x < 40; x++) {
  panHost.offsetX += 4;
  layout.applyTransform(false, false);
}
assert.equal(viewportTransformWrites, 41, 'normal pan moves the full viewport');
assert.equal(viewportVariableWrites, 2, 'normal pan does not recalculate inherited zoom variables');
assert.equal(proxyDraws, normalDraws, 'normal pan never replaces nodes with the proxy');
panHost.scale = 1.3;
layout.applyTransform(false, false);
assert.equal(viewportVariableWrites, 4, 'normal zoom updates inherited variables once');
assert.match(styles, /\.canvas\.is-panning \.viewport,[\s\S]*?will-change:transform!important/);
assert.match(styles, /\.node\{[\s\S]*?will-change:auto;/);
assert.doesNotMatch(styles, /(?<!fast-canvas-mode )\.canvas\.is-panning \.node(?:,|\s*\{)/);
assert.doesNotMatch(styles, /(?<!fast-canvas-mode )\.canvas\.is-panning \.edge(?:,|\s*\{)/);
assert.match(styles, /\.canvas\.is-dragging-node \.node\.drag-active\{[\s\S]*?transition:none!important/);

console.log('Canvas drag and pan performance tests passed.');
