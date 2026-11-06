'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function target(node = false) {
  return {closest: selector => node && (selector.includes('.node') || selector.includes('.port')) ? {} : null};
}
function surface() {
  const listeners = new Map();
  const classes = new Set();
  return {
    listeners,
    classList: {
      add: name => classes.add(name),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name)
    },
    addEventListener: (name, fn) => listeners.set(name, fn),
    setPointerCapture: () => {},
    getBoundingClientRect: () => ({left: 0, top: 0})
  };
}
function fire(surface, name, values = {}) {
  let prevented = false;
  surface.listeners.get(name)?.({
    target: target(),
    button: 0,
    pointerId: 1,
    clientX: 100,
    clientY: 100,
    buttons: 1,
    shiftKey: false,
    preventDefault: () => { prevented = true; },
    ...values
  });
  return prevented;
}

const canvas = surface();
const document = surface();
document.querySelector = () => null;
const window = surface();
const state = {activeWorkspace: 'canvas', fastCanvasMode: false, scale: 1, offsetX: 0, offsetY: 0};
let menu = 0;
let cleared = 0;
let selections = 0;
let scheduledTransforms = 0;
let immediateTransforms = 0;
const context = {window, document, setTimeout, console};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'canvas', 'events.js'), 'utf8'), context);
context.window.FutureAICanvasEvents.create({
  $: id => id === 'canvas' ? canvas : null,
  state,
  clearSelection: () => { cleared++; },
  releaseDrags: () => { state.panning = null; },
  showNodeTypeMenu: () => { menu++; },
  updateSelectionBox: () => {},
  finishSelection: () => { selections++; state.selecting = null; },
  isCanvasMenuBlockedTarget: () => false,
  zoomAroundPoint: (viewport, point, scale) => ({...viewport, scale}),
  scheduleTransform: () => { scheduledTransforms++; },
  applyTransform: () => { immediateTransforms++; }
}).bindCanvas();

fire(canvas, 'pointerdown', {button: 2, buttons: 2});
assert.equal(state.panning, undefined, 'right click must not start a drag');
fire(canvas, 'contextmenu');
assert.equal(menu, 1, 'right click on empty canvas opens node menu');
fire(canvas, 'contextmenu', {target: target(true)});
assert.equal(menu, 1, 'node context menu must not be replaced');

fire(document, 'keydown', {code: 'Space'});
assert.equal(state.spacePanning, true);
fire(canvas, 'pointerdown', {target: target(true)});
assert.ok(state.panning, 'Space drag pans even when started over a node');
assert.equal(cleared, 0, 'Space drag preserves selection');
fire(document, 'pointermove', {clientX: 135, clientY: 120});
assert.equal(state.offsetX, 35);
assert.equal(state.offsetY, 20);
assert.equal(immediateTransforms, 1, 'normal pan updates the viewport immediately');
assert.equal(scheduledTransforms, 0, 'normal pan does not wait for the next animation frame');
fire(document, 'pointerup');
fire(document, 'keyup', {code: 'Space'});
assert.equal(state.spacePanning, false);
state.fastCanvasMode = true;
fire(canvas, 'pointerdown', {button: 1, buttons: 4, target: target(true)});
fire(document, 'pointermove', {clientX: 120, clientY: 100, buttons: 4});
assert.equal(scheduledTransforms, 1, 'fast mode keeps its coalesced proxy update');
assert.equal(immediateTransforms, 1, 'fast mode does not update the full viewport');
fire(document, 'pointerup');
state.fastCanvasMode = false;

fire(canvas, 'pointerdown', {button: 1, buttons: 4, target: target(true)});
assert.ok(state.panning, 'middle button pans');
fire(document, 'pointerup');
fire(canvas, 'pointerdown', {shiftKey: true});
assert.ok(state.selecting, 'Shift drag starts marquee selection');
fire(document, 'pointerup', {shiftKey: true});
assert.equal(selections, 1);
fire(canvas, 'wheel', {deltaY: -1});
assert.ok(state.scale > 1, 'wheel zooms canvas');

const runtime = fs.readFileSync(path.join(__dirname, '..', 'src', 'canvas', 'runtime.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
assert.match(app, /canvasRuntime:\s*\{\s*host:\s*\{[\s\S]*?get spacePanning\(\) \{ return spacePanning; \}/);
assert.match(runtime, /if \(host\.spacePanning\) return;/);
assert.match(runtime, /if \(e\.shiftKey \|\| e\.ctrlKey \|\| e\.metaKey\) \{[\s\S]*?host\.selectedNodes\.add\(node\.id\)/);
assert.match(runtime, /if \(\(e\.shiftKey \|\| e\.ctrlKey \|\| e\.metaKey\)[\s\S]*?\) return;\s*closeNodeContextMenu\(\)/);
console.log('Canvas gesture tests passed: right-click menu, Space/middle pan, additive selection, and zoom.');
