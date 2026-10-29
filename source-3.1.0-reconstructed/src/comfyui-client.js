(() => {
  'use strict';

  const {API_TIMEOUTS, fetchJsonWithRetry, wait} = window.FutureAICanvasAIClient;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  function normalizeComfyUrl(url) {
    return String(url || 'http://127.0.0.1:8188').trim().replace(/\/+$/, '');
  }

  function parseComfyWorkflow(text) {
    const workflow = typeof text === 'string' ? JSON.parse(text) : text;
    if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) throw new Error('workflow JSON 必须是对象');
    if (Array.isArray(workflow.nodes)) throw new Error('请导入 ComfyUI API 格式 workflow，不是界面导出的 graph 格式');
    return workflow.prompt && typeof workflow.prompt === 'object' ? workflow.prompt : workflow;
  }

  function parseComfyWorkflowSafe(text) {
    try { return parseComfyWorkflow(text); } catch { return null; }
  }

  function prepareComfyWorkflow(workflowText, values) {
    const workflow = structuredClone(parseComfyWorkflow(workflowText));
    let textIndex = 0;
    for (const node of Object.values(workflow)) {
      if (!node || typeof node !== 'object') continue;
      const type = String(node.class_type || '');
      node.inputs = node.inputs && typeof node.inputs === 'object' ? node.inputs : {};
      if (type === 'CLIPTextEncode' && 'text' in node.inputs) {
        node.inputs.text = textIndex === 0 ? values.prompt : values.negative || node.inputs.text || '';
        textIndex += 1;
      }
      if (type === 'EmptyLatentImage') {
        if ('width' in node.inputs) node.inputs.width = values.width;
        if ('height' in node.inputs) node.inputs.height = values.height;
      }
      if ((type === 'KSampler' || type === 'RandomNoise') && values.seed !== '') {
        if ('seed' in node.inputs) node.inputs.seed = Number(values.seed) || 0;
        if ('noise_seed' in node.inputs) node.inputs.noise_seed = Number(values.seed) || 0;
      }
    }
    return workflow;
  }

  async function safeJson(res) {
    try { return await res.json(); } catch { return {}; }
  }

  async function submitComfyWorkflow(baseUrl, workflow) {
    const res = await fetchJsonWithRetry(baseUrl + '/prompt', {timeoutMs: API_TIMEOUTS.comfy,
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({prompt: workflow, client_id: 'future-ai-canvas-desktop'})
    });
    const data = await safeJson(res);
    if (!res.ok || !data.prompt_id) throw new Error(data.error?.message || data.message || JSON.stringify(data));
    return data;
  }

  async function pollComfyHistory(baseUrl, promptId) {
    if (!promptId) throw new Error('ComfyUI 没有返回 prompt_id');
    for (let i = 0; i < 400; i++) {
      const res = await fetchJsonWithRetry(baseUrl + '/history/' + encodeURIComponent(promptId), {timeoutMs: API_TIMEOUTS.comfy, cache: 'no-store', retries: 0});
      if (res.ok) {
        const data = await safeJson(res);
        const images = extractComfyImages(data, promptId);
        if (images.length) return images;
      }
      await wait(1500);
    }
    throw new Error('等待 ComfyUI 输出超时');
  }

  function extractComfyImages(historyData, promptId) {
    const root = historyData?.[promptId] || historyData;
    const outputs = root?.outputs || {};
    const images = [];
    Object.values(outputs).forEach(output => {
      (output?.images || []).forEach(image => {
        if (image?.filename) images.push(image);
      });
    });
    return images;
  }

  function comfyViewUrl(baseUrl, image) {
    const params = new URLSearchParams({
      filename: image.filename,
      type: image.type || 'output'
    });
    if (image.subfolder) params.set('subfolder', image.subfolder);
    return baseUrl + '/view?' + params.toString();
  }

  function comfyWorkflowMapHtml(workflowText) {
    if (!workflowText.trim()) return '<span>未导入 workflow</span>';
    try {
      const workflow = parseComfyWorkflow(workflowText);
      const items = Object.entries(workflow).slice(0, 18).map(([id, node]) => {
        const type = esc(node?.class_type || 'Unknown');
        const label = esc(node?._meta?.title || id);
        return `<span><strong>${esc(id)}</strong>${type}<em>${label}</em></span>`;
      });
      return items.length ? items.join('') : '<span>workflow 没有可显示节点</span>';
    } catch (err) {
      return `<span class="error">${esc(err.message || String(err))}</span>`;
    }
  }

  window.FutureAICanvasComfyUIClient = {
    normalizeComfyUrl,
    parseComfyWorkflow,
    parseComfyWorkflowSafe,
    prepareComfyWorkflow,
    submitComfyWorkflow,
    pollComfyHistory,
    extractComfyImages,
    comfyViewUrl,
    comfyWorkflowMapHtml
  };
})();
