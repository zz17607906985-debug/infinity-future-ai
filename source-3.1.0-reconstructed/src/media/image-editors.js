(() => {
  'use strict';

  /** Image editors domain: Fabric + Cropper (state private). */
  function create(deps = {}) {
    const $ = deps.$;
    const toast = deps.toast;
    const ensureVendor = deps.ensureVendor;
    const getNode = deps.getNode;
    const nodeDisplayTitle = deps.nodeDisplayTitle;
    const persistMediaUrl = deps.persistMediaUrl;
    const hydrateNode = deps.hydrateNode;
    const saveProject = deps.saveProject;
    const rememberImageNodeVersion = deps.rememberImageNodeVersion;
    const applyImageNodeUrl = deps.applyImageNodeUrl;

    let fabricEditorCanvas = null;
    let fabricEditorNodeId = '';
    let fabricEditorHistory = [];
    let fabricEditorRestoring = false;
    let cropperInstance = null;
    let cropperNodeId = '';
    let cropperScaleX = 1;
    let cropperScaleY = 1;

function resetFabricEditorCanvas(width = 1024, height = 768) {
  if (fabricEditorCanvas) fabricEditorCanvas.dispose();
  const canvasEl = $('fabricEditorCanvas');
  if (!canvasEl || !window.fabric) return null;
  canvasEl.width = width;
  canvasEl.height = height;
  fabricEditorCanvas = new fabric.Canvas(canvasEl, {
    preserveObjectStacking: true,
    selection: true,
    backgroundColor: '#11161a'
  });
  fabricEditorCanvas.freeDrawingBrush = new fabric.PencilBrush(fabricEditorCanvas);
  syncFabricBrush();
  fabricEditorCanvas.on('object:added', rememberFabricState);
  fabricEditorCanvas.on('object:modified', rememberFabricState);
  fabricEditorCanvas.on('object:removed', rememberFabricState);
  fabricEditorHistory = [];
  return fabricEditorCanvas;
}

function syncFabricBrush() {
  if (!fabricEditorCanvas?.freeDrawingBrush) return;
  fabricEditorCanvas.freeDrawingBrush.color = $('fabricEditorColor')?.value || '#ffcc33';
  fabricEditorCanvas.freeDrawingBrush.width = Number($('fabricEditorStroke')?.value || 4);
}

function setFabricEditorStatus(message) {
  const status = $('fabricEditorStatus');
  if (status) status.textContent = message;
}

function rememberFabricState() {
  if (fabricEditorRestoring || !fabricEditorCanvas) return;
  const json = JSON.stringify(fabricEditorCanvas.toDatalessJSON(['selectable']));
  if (fabricEditorHistory[fabricEditorHistory.length - 1] !== json) fabricEditorHistory.push(json);
  if (fabricEditorHistory.length > 40) fabricEditorHistory.shift();
}

function imageUrlToFabricImage(url) {
  return new Promise((resolve, reject) => {
    const options = /^https?:|^data:|^blob:/i.test(String(url || '')) ? {crossOrigin: 'anonymous'} : {};
    fabric.Image.fromURL(url, img => img ? resolve(img) : reject(new Error('图片加载失败')), options);
  });
}

async function openFabricEditor(node) {
  if (!node || node.type !== 'image') return;
  const url = node.data.url || (Array.isArray(node.data.urls) ? node.data.urls[0] : '');
  if (!url) return toast('这个图片节点还没有图片，先生成或上传一张图。', 'warn');
  if (!(await ensureVendor('fabric', '高级图片编辑器'))) return;
  if (!window.fabric) return toast('高级图片编辑器没有加载成功，请重启软件后再试。', 'error');
  fabricEditorNodeId = node.id;
  $('fabricEditorTitle').textContent = nodeDisplayTitle(node);
  $('fabricEditorModal').classList.remove('hidden');
  setFabricEditorStatus('正在载入图片...');
  try {
    const img = await imageUrlToFabricImage(url);
    const maxWidth = Math.min(1280, Math.max(720, window.innerWidth - 160));
    const maxHeight = Math.min(820, Math.max(480, window.innerHeight - 230));
    const naturalWidth = Math.max(img.width || 1024, 1);
    const naturalHeight = Math.max(img.height || 768, 1);
    const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight, 1);
    const width = Math.max(Math.round(naturalWidth * scale), 320);
    const height = Math.max(Math.round(naturalHeight * scale), 240);
    const canvas = resetFabricEditorCanvas(width, height);
    if (!canvas) return;
    img.set({left: 0, top: 0, selectable: false, evented: false});
    img.scaleToWidth(width);
    if ((img.getScaledHeight?.() || height) < height) img.scaleToHeight(height);
    canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas), {originX: 'left', originY: 'top'});
    setFabricTool('select');
    rememberFabricState();
    setFabricEditorStatus('已载入。可添加文字、形状、箭头和画笔，保存后会更新当前图片节点。');
  } catch (err) {
    console.error('fabric editor open failed', err);
    setFabricEditorStatus('图片载入失败，请确认素材仍可访问。');
    toast('图片编辑器打开失败：' + (err?.message || err), 'error');
  }
}

function closeFabricEditor() {
  $('fabricEditorModal')?.classList.add('hidden');
  fabricEditorNodeId = '';
  if (fabricEditorCanvas) {
    fabricEditorCanvas.dispose();
    fabricEditorCanvas = null;
  }
  fabricEditorHistory = [];
}

function setFabricTool(tool) {
  if (!fabricEditorCanvas) return;
  document.querySelectorAll('[data-fabric-tool]').forEach(btn => btn.classList.toggle('active', btn.dataset.fabricTool === tool));
  fabricEditorCanvas.isDrawingMode = tool === 'draw';
  fabricEditorCanvas.selection = tool === 'select';
  if (tool === 'text') addFabricText();
  if (tool === 'rect') addFabricRect();
  if (tool === 'circle') addFabricCircle();
  if (tool === 'arrow') addFabricArrow();
  syncFabricBrush();
}

function fabricColor() {
  return $('fabricEditorColor')?.value || '#ffcc33';
}

function fabricStrokeWidth() {
  return Number($('fabricEditorStroke')?.value || 4);
}

function addFabricText() {
  const text = new fabric.IText('双击输入文字', {
    left: 80, top: 70, fill: fabricColor(), fontSize: 36, fontWeight: 800,
    fontFamily: 'Microsoft YaHei, Noto Sans SC, sans-serif', stroke: 'rgba(0,0,0,.45)', strokeWidth: 1
  });
  fabricEditorCanvas.add(text).setActiveObject(text);
  fabricEditorCanvas.renderAll();
  setFabricTool('select');
}

function addFabricRect() {
  const rect = new fabric.Rect({left: 90, top: 90, width: 220, height: 140, fill: 'rgba(255,204,51,.18)', stroke: fabricColor(), strokeWidth: fabricStrokeWidth(), rx: 4, ry: 4});
  fabricEditorCanvas.add(rect).setActiveObject(rect);
  fabricEditorCanvas.renderAll();
  setFabricTool('select');
}

function addFabricCircle() {
  const circle = new fabric.Circle({left: 110, top: 90, radius: 74, fill: 'rgba(255,204,51,.14)', stroke: fabricColor(), strokeWidth: fabricStrokeWidth()});
  fabricEditorCanvas.add(circle).setActiveObject(circle);
  fabricEditorCanvas.renderAll();
  setFabricTool('select');
}

function addFabricArrow() {
  const color = fabricColor();
  const width = fabricStrokeWidth();
  const line = new fabric.Line([0, 0, 180, 0], {left: 120, top: 130, stroke: color, strokeWidth: width, originX: 'center', originY: 'center'});
  const head = new fabric.Triangle({left: 300, top: 130, width: width * 5, height: width * 6, fill: color, angle: 90, originX: 'center', originY: 'center'});
  const arrow = new fabric.Group([line, head], {left: 120, top: 130});
  fabricEditorCanvas.add(arrow).setActiveObject(arrow);
  fabricEditorCanvas.renderAll();
  setFabricTool('select');
}

function onFabricEditorClick(e) {
  const tool = e.target.closest('[data-fabric-tool]')?.dataset.fabricTool;
  if (tool) return setFabricTool(tool);
  const action = e.target.closest('[data-fabric-action]')?.dataset.fabricAction;
  if (!action || !fabricEditorCanvas) return;
  if (action === 'delete') return deleteFabricSelection();
  if (action === 'front') return fabricEditorCanvas.getActiveObject()?.bringToFront(), fabricEditorCanvas.renderAll(), rememberFabricState();
  if (action === 'back') return fabricEditorCanvas.getActiveObject()?.sendBackwards(), fabricEditorCanvas.renderAll(), rememberFabricState();
  if (action === 'undo') return undoFabricEditor();
  if (action === 'clear') return clearFabricObjects();
}

function deleteFabricSelection() {
  const active = fabricEditorCanvas?.getActiveObjects?.() || [];
  active.forEach(obj => fabricEditorCanvas.remove(obj));
  fabricEditorCanvas.discardActiveObject().renderAll();
  rememberFabricState();
}

function clearFabricObjects() {
  if (!fabricEditorCanvas) return;
  fabricEditorCanvas.getObjects().forEach(obj => fabricEditorCanvas.remove(obj));
  fabricEditorCanvas.renderAll();
  rememberFabricState();
}

function undoFabricEditor() {
  if (!fabricEditorCanvas || fabricEditorHistory.length < 2) return;
  fabricEditorHistory.pop();
  const previous = fabricEditorHistory[fabricEditorHistory.length - 1];
  fabricEditorRestoring = true;
  fabricEditorCanvas.loadFromJSON(previous, () => {
    fabricEditorRestoring = false;
    fabricEditorCanvas.renderAll();
  });
}

async function saveFabricEditor() {
  if (!fabricEditorCanvas || !fabricEditorNodeId) return;
  const node = getNode(fabricEditorNodeId);
  if (!node) return closeFabricEditor();
  try {
    setFabricEditorStatus('正在保存到图片节点...');
    const dataUrl = fabricEditorCanvas.toDataURL({format: 'png', multiplier: 1});
    const url = await persistMediaUrl(dataUrl, `fabric_edit_${Date.now()}`, 'png');
    rememberImageNodeVersion(node, '高级编辑前');
    applyImageNodeUrl(node, url);
    hydrateNode(node);
    saveProject();
    closeFabricEditor();
    toast('图片已保存回当前节点', 'success');
  } catch (err) {
    console.error('fabric editor save failed', err);
    setFabricEditorStatus('保存失败：' + (err?.message || err));
    toast('图片编辑保存失败：' + (err?.message || err), 'error');
  }
}

function setCropperStatus(message) {
  const status = $('cropperStatus');
  if (status) status.textContent = message;
}

async function openCropperEditor(node) {
  if (!node || node.type !== 'image') return;
  const url = node.data.url || (Array.isArray(node.data.urls) ? node.data.urls[0] : '');
  if (!url) return toast('这个图片节点还没有图片，先生成或上传一张图。', 'warn');
  if (!(await ensureVendor('cropper', '图片裁剪器'))) return;
  if (!window.Cropper) return toast('图片裁剪器没有加载成功，请重启软件后再试。', 'error');
  closeFabricEditor();
  cropperNodeId = node.id;
  cropperScaleX = 1;
  cropperScaleY = 1;
  $('cropperTitle').textContent = nodeDisplayTitle(node);
  const image = $('cropperImage');
  image.onload = () => initCropperInstance();
  image.onerror = () => {
    setCropperStatus('图片载入失败，请确认素材仍可访问。');
    toast('图片裁剪器打开失败', 'error');
  };
  $('cropperModal').classList.remove('hidden');
  setCropperStatus('正在载入图片...');
  image.src = url;
}

function initCropperInstance() {
  if (cropperInstance) cropperInstance.destroy();
  cropperInstance = new Cropper($('cropperImage'), {
    viewMode: 1,
    autoCropArea: 0.86,
    responsive: true,
    background: false,
    movable: true,
    zoomable: true,
    rotatable: true,
    scalable: true,
    ready() {
      setCropperRatio('free');
      setCropperStatus('拖动裁剪框调整构图，选择比例后保存回当前图片节点。');
    }
  });
}

function closeCropperEditor() {
  $('cropperModal')?.classList.add('hidden');
  if (cropperInstance) {
    cropperInstance.destroy();
    cropperInstance = null;
  }
  const image = $('cropperImage');
  if (image) {
    image.onload = null;
    image.onerror = null;
    image.removeAttribute('src');
  }
  cropperNodeId = '';
  cropperScaleX = 1;
  cropperScaleY = 1;
}

function setCropperRatio(value) {
  if (!cropperInstance) return;
  const ratio = value === 'free' ? NaN : Number(value);
  cropperInstance.setAspectRatio(Number.isFinite(ratio) ? ratio : NaN);
  document.querySelectorAll('[data-crop-ratio]').forEach(btn => btn.classList.toggle('active', btn.dataset.cropRatio === String(value)));
}

function onCropperEditorClick(e) {
  const ratio = e.target.closest('[data-crop-ratio]')?.dataset.cropRatio;
  if (ratio) return setCropperRatio(ratio);
  const action = e.target.closest('[data-crop-action]')?.dataset.cropAction;
  if (!action || !cropperInstance) return;
  if (action === 'rotate-left') return cropperInstance.rotate(-90);
  if (action === 'rotate-right') return cropperInstance.rotate(90);
  if (action === 'flip-x') {
    cropperScaleX *= -1;
    return cropperInstance.scaleX(cropperScaleX);
  }
  if (action === 'flip-y') {
    cropperScaleY *= -1;
    return cropperInstance.scaleY(cropperScaleY);
  }
  if (action === 'reset') {
    cropperScaleX = 1;
    cropperScaleY = 1;
    cropperInstance.reset();
    return setCropperRatio('free');
  }
}

async function saveCropperEditor() {
  if (!cropperInstance || !cropperNodeId) return;
  const node = getNode(cropperNodeId);
  if (!node) return closeCropperEditor();
  try {
    setCropperStatus('正在保存裁剪结果...');
    const canvas = cropperInstance.getCroppedCanvas({fillColor: '#000', imageSmoothingEnabled: true, imageSmoothingQuality: 'high'});
    if (!canvas) throw new Error('无法生成裁剪结果');
    const dataUrl = canvas.toDataURL('image/png');
    const url = await persistMediaUrl(dataUrl, `crop_edit_${Date.now()}`, 'png');
    rememberImageNodeVersion(node, '裁剪前');
    applyImageNodeUrl(node, url);
    hydrateNode(node);
    saveProject();
    closeCropperEditor();
    toast('裁剪结果已保存回当前节点', 'success');
  } catch (err) {
    console.error('cropper save failed', err);
    setCropperStatus('保存失败：' + (err?.message || err));
    toast('裁剪保存失败：' + (err?.message || err), 'error');
  }
}

    return {
      openFabricEditor,
      closeFabricEditor,
      onFabricEditorClick,
      saveFabricEditor,
      syncFabricBrush,
      openCropperEditor,
      closeCropperEditor,
      onCropperEditorClick,
      saveCropperEditor
    };
  }

  window.FutureAIImageEditors = { create };
})();
