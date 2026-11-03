(() => {
  'use strict';

  const PROJECT_TEMPLATES = [
    {id: 'default', name: '默认画布'},
    {id: 'short-video', name: '短视频'},
    {id: 'character', name: '角色设定'},
    {id: 'image-to-image', name: '图生图'},
    {id: 'comfyui', name: 'ComfyUI 工作流'},
    {id: 'storyboard', name: '分镜'}
  ];

  function selectedProjectTemplateId(id = 'default') {
    return PROJECT_TEMPLATES.some(item => item.id === id) ? id : 'default';
  }

  window.FutureAIProjectTemplates = {
    PROJECT_TEMPLATES,
    selectedProjectTemplateId
  };
})();
