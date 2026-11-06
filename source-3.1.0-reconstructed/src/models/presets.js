(() => {
  'use strict';

  const MODEL_PRESETS = [
    {id: 'openai-compatible', label: 'OpenAI 兼容', apiUrl: 'https://api.openai.com/v1', imageModel: 'gpt-image2', videoModel: 'sora-2', chatModel: 'gpt-4o-mini', hint: '适合 OpenAI 或完全兼容 /v1 接口的服务。'},
    {id: 'siliconflow', label: '硅基流动', apiUrl: 'https://api.siliconflow.cn/v1', imageModel: 'black-forest-labs/FLUX.1-schnell', videoModel: 'Wan-AI/Wan2.1-T2V-14B', chatModel: 'Qwen/Qwen2.5-72B-Instruct', hint: '填入硅基流动 API Key 后可导入平台模型列表。'},
    {id: 'volcengine', label: '火山', apiUrl: 'https://ark.cn-beijing.volces.com/api/v3', imageModel: 'doubao-seedream-3-0-t2i-250415', videoModel: 'doubao-seedance-1-0-lite-t2v-250428', chatModel: 'doubao-1-5-pro-32k-250115', hint: '适合火山方舟 OpenAI-compatible 网关。'},
    {id: 'tongyi', label: '通义', apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', imageModel: 'wanx2.1-t2i-turbo', videoModel: 'wan2.1-t2v-turbo', chatModel: 'qwen-plus', hint: '适合通义千问 DashScope 兼容模式。'},
    {id: 'comfyui-local', label: 'ComfyUI 本地', apiUrl: 'http://127.0.0.1:8188', comfyUrl: 'http://127.0.0.1:8188', imageModel: 'ComfyUI', videoModel: 'ComfyUI', chatModel: 'qwen-plus', hint: '用于本地 ComfyUI 工作流。API Key 不会被填写或修改。'},
    {id: 'custom', label: '自定义 OpenAI-compatible', apiUrl: 'https://api.example.com/v1', imageModel: 'gpt-image2', videoModel: 'omni-flash', chatModel: 'gpt-4o-mini', hint: '保留为自定义兼容服务，请按实际供应商修改地址和模型名。'}
  ];

  function defaultEsc(value) {
    return String(value ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function modelPresetOptionsHtml(active = 'openai-compatible', esc = defaultEsc) {
    return MODEL_PRESETS.map(item => `<option value="${esc(item.id)}" ${item.id === active ? 'selected' : ''}>${esc(item.label)}</option>`).join('');
  }

  function currentModelPreset(id = 'openai-compatible') {
    return MODEL_PRESETS.find(item => item.id === id) || MODEL_PRESETS[0];
  }

  window.FutureAIModelPresets = {
    MODEL_PRESETS,
    modelPresetOptionsHtml,
    currentModelPreset
  };
})();
