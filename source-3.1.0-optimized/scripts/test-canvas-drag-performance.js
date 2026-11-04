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

console.log('Canvas drag performance tests passed.');
