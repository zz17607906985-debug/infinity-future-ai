(() => {
  'use strict';

  function buildActions(deps = {}) {
    const {
      setActiveWorkspace,
      openShortWorkbench,
      createAssistantTopic,
      addPromptAtCenter,
      addImageAtCenter,
      addUploadAtCenter,
      addVideoAtCenter,
      addComfyUIAtCenter,
      openSettings,
      pauseQueue,
      retryFailedQueue,
      fitView,
      openCanvasSearch,
      selectedNodes,
      duplicateNodes,
      toggleShortcutHelp,
      toast
    } = deps;
    return [
      {id: 'workspace-assistant', icon: 'fa-comments', title: '打开∞ 灵枢万象', hint: '项目对话 / 自主执行 / 图片理解', run: () => setActiveWorkspace('assistant')},
      {id: 'workspace-canvas', icon: 'fa-infinity', title: '打开无限画布', hint: '节点编排与素材生产', run: () => setActiveWorkspace('canvas')},
      {id: 'workspace-music', icon: 'fa-music', title: '打开媒体中心', hint: '音乐 / 视频 / 电视直播', run: () => setActiveWorkspace('music')},
      {id: 'workspace-short', icon: 'fa-circle-play', title: '打开 AI 漫剧工作台', hint: '构思、分镜、资产、视频', run: openShortWorkbench},
      {id: 'new-topic', icon: 'fa-plus', title: '新建灵枢任务', hint: '在∞ 灵枢万象里开始一轮新对话', run: () => { setActiveWorkspace('assistant'); createAssistantTopic(); }},
      {id: 'add-prompt', icon: 'fa-note-sticky', title: '创建提示词节点', hint: '在画布中心添加文本节点', run: () => { setActiveWorkspace('canvas'); addPromptAtCenter(); }},
      {id: 'add-image', icon: 'fa-image', title: '创建图片节点', hint: '生成图像 / 图生图', run: () => { setActiveWorkspace('canvas'); addImageAtCenter(); }},
      {id: 'add-upload', icon: 'fa-upload', title: '上传素材节点', hint: '导入图片或视频作为素材', run: () => { setActiveWorkspace('canvas'); addUploadAtCenter(); }},
      {id: 'add-video', icon: 'fa-video', title: '创建视频节点', hint: '文生视频 / 图生视频', run: () => { setActiveWorkspace('canvas'); addVideoAtCenter(); }},
      {id: 'add-comfyui', icon: 'fa-diagram-project', title: '创建 ComfyUI 节点', hint: '导入 workflow 后在画布运行', run: () => { setActiveWorkspace('canvas'); addComfyUIAtCenter(); }},
      {id: 'settings', icon: 'fa-gear', title: '打开设置', hint: 'API、模型、本地存储', run: openSettings},
      {id: 'search-canvas', icon: 'fa-magnifying-glass', title: '搜索画布节点', hint: '按名称、提示词、模型或标签搜索', run: () => { setActiveWorkspace('canvas'); requestAnimationFrame(openCanvasSearch); }},
      {id: 'pause-queue', icon: 'fa-pause', title: '暂停生成队列', hint: '保留当前排队任务，可随时继续', run: pauseQueue},
      {id: 'retry-failed-queue', icon: 'fa-rotate-right', title: '重试失败任务', hint: '只重试已经失败的排队任务', run: retryFailedQueue},
      {id: 'fit-view', icon: 'fa-maximize', title: '适配画布视图', hint: '把画布内容放回视野（Shift+1）', run: () => fitView(true)},
      {id: 'duplicate-selected', icon: 'fa-copy', title: '复制选中节点', hint: '复制当前选中的画布节点（Ctrl/Cmd+D）', run: () => { if (!selectedNodes.size) return toast('请先选中要复制的节点', 'warn'); duplicateNodes([...selectedNodes]); }},
      {id: 'shortcut-help', icon: 'fa-keyboard', title: '快捷键', hint: '查看画布快捷键（?）', run: () => { setActiveWorkspace('canvas'); requestAnimationFrame(() => toggleShortcutHelp(true)); }}
    ];
  }

  function filterActions(actions, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return actions;
    return actions.filter(item => `${item.title} ${item.hint} ${item.id}`.toLowerCase().includes(q));
  }

  window.FutureAICommandPalette = { buildActions, filterActions };
})();
