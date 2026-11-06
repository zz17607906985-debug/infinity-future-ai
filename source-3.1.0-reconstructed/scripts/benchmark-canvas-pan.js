'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');

const [appDir, fixtureRoot, localAppData, portText, viewMode, experiment] = process.argv.slice(2);
const port = Number(portText || 9335);
if (!appDir || !fixtureRoot || !localAppData) throw new Error('Usage: node scripts/benchmark-canvas-pan.js <app-dir> <fixture-root> <local-appdata> [port]');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function connect(port) {
  let target;
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      target = (await response.json()).find(item => item.type === 'page' && item.url.includes('app.asar/src/index.html'));
      if (target) break;
    } catch {}
    await sleep(200);
  }
  if (!target) throw new Error('Candidate window did not start');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, {once: true}); ws.addEventListener('error', reject, {once: true}); });
  let nextId = 0;
  const pending = new Map();
  ws.addEventListener('message', event => {
    const packet = JSON.parse(event.data);
    if (!pending.has(packet.id)) return;
    const {resolve, reject} = pending.get(packet.id);
    pending.delete(packet.id);
    packet.error ? reject(new Error(packet.error.message)) : resolve(packet.result);
  });
  return {
    send(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out (id ${id})`)); }, 10000);
        pending.set(id, {resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); }});
        ws.send(JSON.stringify({id, method, params}));
      });
    },
    close() { ws.close(); }
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function main() {
  const candidates = await Promise.all((await fs.readdir(appDir)).filter(name => name.endsWith('.exe')).map(async name => ({name, size: (await fs.stat(path.join(appDir, name))).size})));
  const executable = candidates.find(item => item.size > 100000000);
  if (!executable) throw new Error('App executable not found');
  const userData = path.join(localAppData, 'InfinityFutureAI', 'user-data');
  await fs.mkdir(userData, {recursive: true});
  await fs.writeFile(path.join(userData, 'allowed-storage-roots.json'), JSON.stringify([fixtureRoot]));
  const child = spawn(path.join(appDir, executable.name), [`--remote-debugging-port=${port}`], {cwd: appDir, env: {...process.env, LOCALAPPDATA: localAppData}, stdio: 'ignore', windowsHide: false});
  let cdp;
  try {
    console.error('benchmark: connecting');
    cdp = await connect(port);
    await cdp.send('Runtime.enable');
    console.error('benchmark: waiting for project home');
    for (let i = 0; i < 100; i++) {
      const state = await evaluate(cdp, `(() => {const card = [...document.querySelectorAll('#projectGrid .project-card')].find(item => item.textContent.includes('个节点')); return {card: !!card, nodes: document.querySelectorAll('.node').length, homeHidden: document.querySelector('#projectHome')?.classList.contains('hidden')};})()`);
      if (state.card || state.nodes) break;
      await sleep(200);
    }
    await evaluate(cdp, `localStorage.setItem('futureai.fastCanvasMode', 'off'); document.querySelector('#projectGrid .project-card')?.click(); true`);
    console.error('benchmark: waiting for nodes');
    let nodeCount = 0;
    for (let i = 0; i < 120; i++) {
      nodeCount = await evaluate(cdp, `document.querySelectorAll('#viewport .node').length`);
      if (nodeCount > 0) break;
      await sleep(200);
    }
    if (!nodeCount) throw new Error('Project did not mount visible nodes');
    if (viewMode === 'fit' || viewMode === 'zoomout') {
      await evaluate(cdp, `document.querySelector('#fitView')?.click(); true`);
      await sleep(800);
      nodeCount = await evaluate(cdp, `document.querySelectorAll('#viewport .node').length`);
    }
    if (viewMode === 'zoomout') {
      const center = await evaluate(cdp, `(() => {const r=document.querySelector('#canvas').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
      for (let i = 0; i < 4; i++) await cdp.send('Input.dispatchMouseEvent', {type: 'mouseWheel', x: center.x, y: center.y, deltaY: 120, deltaX: 0});
      await sleep(800);
      nodeCount = await evaluate(cdp, `document.querySelectorAll('#viewport .node').length`);
    }
    if (experiment === 'small-edges') {
      await evaluate(cdp, `(() => {const edges=document.querySelector('#edges'); edges.setAttribute('width','1'); edges.setAttribute('height','1'); edges.style.setProperty('width','1px','important'); edges.style.setProperty('height','1px','important'); edges.style.setProperty('overflow','visible','important'); return true;})()`);
    }
    if (experiment === 'rapid-no-shadows') {
      await evaluate(cdp, `(() => {const style=document.createElement('style');style.textContent='#canvas .node,#canvas .node *{box-shadow:none!important;text-shadow:none!important;filter:none!important}';document.head.append(style);return true})()`);
    }
    console.error(`benchmark: panning with ${nodeCount} nodes`);
    // The interaction remains in normal mode; record the same mouse path on each build.
    const start = await evaluate(cdp, `(() => {const el = document.querySelector('#canvas'), r = el.getBoundingClientRect(); for (const f of [[.5,.5],[.2,.2],[.8,.2],[.2,.8],[.8,.8],[.5,.12],[.5,.88]]) {const x=r.left+r.width*f[0], y=r.top+r.height*f[1], hit=document.elementFromPoint(x,y); if (hit?.closest('#canvas') && !hit.closest('.node,.canvas-rail,.bottom-canvas-tools,.canvas-minimap')) return {x,y};} return null;})()`);
    if (!start) throw new Error('No blank canvas area for benchmark');
    const transformBefore = await evaluate(cdp, `document.querySelector('#viewport').style.transform`);
    const rapid = experiment === 'rapid' || experiment === 'rapid-no-shadows';
    const movementPath = rapid
      ? Array.from({length: 6 * 24}, (_, index) => {
        const phase = index % 24;
        return phase < 12 ? -180 + (phase + 1) * 30 : 180 - (phase - 11) * 30;
      })
      : Array.from({length: 90}, (_, index) => (index + 1) * 4);
    await sleep(400);
    await cdp.send('Performance.enable');
    const before = await cdp.send('Performance.getMetrics');
    const started = performance.now();
    await evaluate(cdp, `(() => {window.__panFrames=[];window.__panSamples=[];window.__panEvents=[];window.__panRecording=true;window.__panInputX=${start.x};window.__panOriginX=${start.x};const translateX=()=>Number(document.querySelector('#viewport').style.transform.split('(')[1]?.split('px')[0]);window.__panOriginTransformX=translateX();document.addEventListener('pointermove',window.__panOnMove=e=>{if(window.__panRecording){window.__panInputX=e.clientX;window.__panEvents.push({t:performance.now(),x:e.clientX-window.__panOriginX})}},{capture:true});requestAnimationFrame(function tick(t){if(!window.__panRecording)return;window.__panFrames.push(t);const x=translateX();if(Number.isFinite(x))window.__panSamples.push({t,input:window.__panInputX-window.__panOriginX,actual:x-window.__panOriginTransformX});requestAnimationFrame(tick)});return true})()`);
    await cdp.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: start.x, y: start.y, buttons: 0});
    await cdp.send('Input.dispatchMouseEvent', {type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1});
    const moves = [];
    for (let i = 0; i < movementPath.length; i++) {
      const sent = cdp.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: start.x + movementPath[i], y: start.y + (rapid ? 0 : (i + 1) * 2), button: 'left', buttons: 1});
      if (rapid) { moves.push(sent); await sleep(5); }
      else { await sent; await sleep(16); }
    }
    await Promise.all(moves);
    await sleep(48);
    await evaluate(cdp, `window.__panRecording=false;document.removeEventListener('pointermove',window.__panOnMove,true);true`);
    await cdp.send('Input.dispatchMouseEvent', {type: 'mouseReleased', x: start.x + movementPath.at(-1), y: start.y + (rapid ? 0 : 180), button: 'left', buttons: 0, clickCount: 1});
    await sleep(100);
    const elapsedMs = Math.round(performance.now() - started);
    const after = await cdp.send('Performance.getMetrics');
    const metric = (snapshot, name) => snapshot.metrics.find(item => item.name === name)?.value || 0;
    console.error('benchmark: collecting results');
    const result = await evaluate(cdp, `(() => {window.__panRecording=false;const times=window.__panFrames, intervals=times.slice(1).map((t,i)=>t-times[i]).filter(ms=>ms>0).sort((a,b)=>a-b), samples=window.__panSamples, events=window.__panEvents, eventIntervals=events.slice(1).map((e,i)=>e.t-events[i].t).sort((a,b)=>a-b), lag=samples.map(s=>Math.abs(s.input-s.actual)).sort((a,b)=>a-b);let reversals=0,lastDirection=0;for(let i=1;i<events.length;i++){const direction=Math.sign(events[i].x-events[i-1].x);if(direction&&lastDirection&&direction!==lastDirection)reversals++;if(direction)lastDirection=direction}return {nodes:document.querySelectorAll('.node').length, fastMode:localStorage.getItem('futureai.fastCanvasMode'), frameCount:intervals.length, medianMs:intervals[Math.floor(intervals.length*.5)]||0, p95Ms:intervals[Math.floor(intervals.length*.95)]||0, over33ms:intervals.filter(ms=>ms>33).length, inputEvents:events.length, reversals, inputDurationMs:Math.round((events.at(-1)?.t||0)-(events[0]?.t||0)), medianInputIntervalMs:eventIntervals[Math.floor(eventIntervals.length*.5)]||0, p95LagPx:lag[Math.floor(lag.length*.95)]||0, maxLagPx:lag.at(-1)||0, lastInputPx:samples.at(-1)?.input, lastActualPx:samples.at(-1)?.actual, heapMiB:Math.round((performance.memory?.usedJSHeapSize||0)/1048576), previewImages:[...document.querySelectorAll('.node img')].filter(img=>img.currentSrc.includes('canvas-previews')).length, visibleImages:[...document.querySelectorAll('.node img')].filter(img=>img.getClientRects().length).length};})()`);
    const transformAfter = await evaluate(cdp, `document.querySelector('#viewport').style.transform`);
    if (transformBefore === transformAfter && !rapid) throw new Error('Benchmark did not pan the viewport');
    if (rapid && (result.reversals < 8 || result.lastActualPx == null)) throw new Error(`Rapid pan did not deliver enough reversals: ${JSON.stringify(result)}`);
    console.log(JSON.stringify({...result, viewMode: viewMode || 'initial', experiment: experiment || 'none', transformBefore, transformAfter, elapsedMs, taskMs: Math.round((metric(after, 'TaskDuration') - metric(before, 'TaskDuration')) * 1000), scriptMs: Math.round((metric(after, 'ScriptDuration') - metric(before, 'ScriptDuration')) * 1000), layoutCount: metric(after, 'LayoutCount') - metric(before, 'LayoutCount'), recalcStyleCount: metric(after, 'RecalcStyleCount') - metric(before, 'RecalcStyleCount')}, null, 2));
  } finally {
    cdp?.close();
    if (child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {windowsHide: true, stdio: 'ignore'});
  }
}

main().catch(error => {console.error(error); process.exitCode = 1;});
