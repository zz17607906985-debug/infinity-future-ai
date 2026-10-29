(() => {
  'use strict';

  const latestContextPattern = /上一张|上传|刚才|刚生成|最新|当前图|这张|这个图|这幅图|继续|接着|沿用|保持|基于|根据上面|上面的|参考上面|按上面|同一角色|这个角色|这个人物|这套设定|这个风格|美术风格|画风|风格|光影|色彩|氛围|质感/i;
  const editPattern = /修改|改成|改为|调整|局部|重绘|修复|修正|去掉|去除|不要|减少|增加|添加|换成|替换|保留.*改|只改|改一下|脸|表情|发型|服装|衣服|背景|颜色|姿势|道具|瑕疵/i;
  const stylePattern = /根据上面的美术风格|按上面的美术风格|参考上面的美术风格|美术风格|画风|风格|光影|色彩|氛围|质感|笔触|渲染|材质/i;
  const newSubjectPattern = /其他角色|另一个角色|新角色|不同角色|生成一个|画一个|做一个|设计一个|换一个角色|新的主体|新主体|其他人物|另一个人物/i;
  const understandPattern = /分析|理解|描述|反推|识别|看图|评价|这是什么|提取提示词|拆解|总结|帮我看/i;
  const generationPattern = /生成|画|做|设计|创作|出图|改图|修改|重绘|换成|融合|参考/i;

  function shouldUseLatestContextImage(text) {
    const s = String(text || '').trim();
    if (!s) return false;
    return latestContextPattern.test(s) || editPattern.test(s);
  }

  function generationReferenceUrls({userText = '', explicitRefs = [], latestRef = null} = {}) {
    const urls = explicitRefs.map(item => typeof item === 'string' ? item : item?.url).filter(Boolean);
    const latestUrl = typeof latestRef === 'string' ? latestRef : latestRef?.url;
    if (!latestUrl || !shouldUseLatestContextImage(userText)) return urls;
    if (urls.includes(latestUrl)) return urls;
    return [...urls, latestUrl].filter(Boolean);
  }

  function messageRunKind(text, refUrls = []) {
    const s = String(text || '');
    if (refUrls.length && understandPattern.test(s) && !generationPattern.test(s)) return 'understand';
    if (generationPattern.test(s) || editPattern.test(s) || stylePattern.test(s) || newSubjectPattern.test(s)) return 'image';
    return 'chat';
  }

  function referenceIntent(text, refs = []) {
    const s = String(text || '');
    if (!refs.length) return 'none';
    if (stylePattern.test(s) && newSubjectPattern.test(s)) return 'style';
    if (editPattern.test(s) && !newSubjectPattern.test(s)) return 'edit';
    if (understandPattern.test(s) && !generationPattern.test(s)) return 'understand';
    return 'reference';
  }

  function referenceInstructions(intent, refs = []) {
    if (!refs.length) {
      return '当前没有可用参考图。请直接根据用户最后一句文字生成，并让模型结合上下文自主判断主体、风格、构图和画幅。';
    }
    if (intent === 'edit') {
      return '参考图中与用户最后一句相关的图片可作为当前底稿。只修改用户明确要求修改的内容；除用户明确要求外，人物身份、年龄、性别、脸型、五官、发型、服装、姿势、构图、镜头、场景、光线和画风应保持一致。不要把局部修改理解成重新生成新角色或新场景。';
    }
    if (intent === 'style') {
      return '参考图只提供美术风格、画风、光影、色彩、材质、氛围和质感。不要复制参考图的人物身份、脸型、服装、姿势或构图；必须按用户的新主体、新角色或新场景重新设计画面。';
    }
    if (intent === 'understand') {
      return '参考图用于理解和分析。请输出可复用的主体、风格、构图、光线、色彩、材质、可改动点和后续生成建议。';
    }
    return '参考图用途不要预设死。让模型结合上下文自主判断：如果用户要求修改，就把相关参考图当底稿；如果用户要求按风格生成新内容，就只继承风格；如果用户指定多张图分别参考画面、服装、姿势、光影或风格，就逐项遵守，不要混淆。';
  }

  window.FutureAIAssistantAttachments = {
    shouldUseLatestContextImage,
    generationReferenceUrls,
    messageRunKind,
    referenceIntent,
    referenceInstructions
  };
})();
