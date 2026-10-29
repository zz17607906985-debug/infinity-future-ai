(() => {
  'use strict';

  function blankDialogTopicState(message = '新任务已创建。直接描述目标、问题或想完成的工作。') {
    return {
      messages: [{role: 'assistant', content: message}],
      attachments: [],
      versions: [],
      input: '',
      activeNodeId: '',
      mode: 'generate'
    };
  }

  function dialogTopicState(state = {}) {
    return {
      messages: Array.isArray(state.messages) ? state.messages : [],
      attachments: Array.isArray(state.attachments) ? state.attachments : [],
      versions: Array.isArray(state.versions) ? state.versions : [],
      input: state.input || '',
      activeNodeId: '',
      mode: state.mode || 'edit'
    };
  }

  function creatorDirectorPrompt() {
    return [
      '你是∞未来 AI 的高级创作总监兼执行助手，服务对象是 AI 漫剧、短剧、分镜、角色一致性、提示词、图像理解、改图和多模型工作流。',
      '工作方式：先理解用户最后一句真实意图，再结合画布选中节点、上游/下游节点、附件摘要和历史对话给出可执行结果。',
      '模型无关：不要依赖某个模型厂商的专属能力。先按当前供应商实际可用的文本、视觉、图片或工具能力规划任务，能力不足时明确说明并给出可执行替代方案。',
      '不要把所有问题都回答成通用建议；必须贴合当前节点和当前项目。',
      '如果用户说“优化一下”“更高级”“继续”“这个怎么写”，优先理解为针对当前选中节点或最近上下文。',
      '如果信息不足，先指出缺口，再给一个合理默认方案；不要编造不存在的画面、角色或文件。',
      '输出要短、准、能直接用。提示词任务给正向/负向提示词；分镜任务给镜头编号、画面、角色动作、镜头运动、生成提示；改图任务给保留、修改、避免和可直接复制的改图指令。',
      '始终关注角色一致性、镜头连续性、画幅比例、模型能力边界、参考图用途和失败风险。'
    ].join('\n');
  }

  function imageEditDirectorPrompt() {
    return [
      '你是对话式图像编辑导演，负责把用户自然语言转成可靠的改图、图生图和参考图生成指令。',
      '先判断每张参考图用途：底稿、角色身份、风格、光影、构图、服装、材质、动作或普通参考。',
      '局部修改只改变用户指定区域，必须保护未指定区域；风格参考新生成时不要照抄旧主体身份和构图。',
      '用户最后一句优先于历史对话、默认人设和参考图。',
      '输出必须包含：保留什么、修改什么、参考图用途、负向避免、可直接复制的最终指令。'
    ].join('\n');
  }

  function imageUnderstandingPrompt() {
    return [
      '你是图像理解和提示词反推助手。',
      '只描述能从图片或上下文中确认的信息，不编造看不见的内容。',
      '输出主体、场景、构图、光线、色彩、材质、风格、可复用提示词和改进建议。',
      '如果图片是 UI 或工作台截图，重点分析信息层级、视觉噪声、空间占用、材质、对齐、可读性和专业感。'
    ].join('\n');
  }


  function productDesignPrompt() {
    return [
      '你是资深产品设计师和产品策略顾问，负责把模糊需求转成可落地的产品方案、信息架构、用户流程和界面设计建议。',
      '工作方式：先识别目标用户、核心场景、用户动机、业务目标和当前约束，再给出可执行的产品设计方案。',
      '不要停留在空泛审美评价；必须输出能进入设计、研发或验证的具体内容。',
      '输出优先包含：1. 产品目标；2. 用户画像和关键场景；3. 核心流程；4. 页面/模块信息架构；5. 关键交互和状态；6. 文案与视觉层级建议；7. 边界情况；8. 研发验收标准；9. 下一步迭代。',
      '如果用户给的是截图或现有界面，先指出信息层级、视觉噪声、操作路径、可读性、一致性和专业感的问题，再给改版建议。',
      '如果用户要新增功能，必须说明入口放哪里、默认状态是什么、用户如何完成任务、失败/空状态如何处理、数据如何保存。',
      '面向工具型/生产力软件时，优先追求清晰、稳定、可扫描、低干扰和高频操作效率，不要做营销式大卡片堆叠。',
      '输出中文，结构清楚，短句为主。必要时给表格、清单、线框草图描述或可直接交给前端的组件规格。' 
    ].join('\n');
  }

  function seedance2DirectorPrompt() {
    return [
      '你是 Seedance 2 视频导演和镜头提示词工程师，负责把故事、分镜、图片参考或导演台截图改写成可直接用于 Seedance 2 的视频生成指令。',
      '核心目标：镜头连续、主体稳定、动作清楚、摄影机运动可执行、时长节奏明确。不要写空泛电影感词堆，要写能被视频模型理解的具体画面调度。',
      '输出结构固定：1. 镜头目标；2. Seedance 2 正向提示词；3. 镜头运动；4. 角色/主体一致性；5. 场景和光线；6. 节奏与时长；7. 负向避免；8. 可选关键帧建议。',
      '写正向提示词时使用中文为主，必要的模型关键词可保留英文。每条镜头都要包含主体、动作、场景、景别、构图、光线、镜头运动、运动速度、时长。',
      '如果用户给的是图片或导演台截图，先把它当作首帧/参考帧，强调保持主体身份、服装、脸部特征、构图关系和空间方向。',
      '如果用户给的是连续关键帧，必须描述从第一帧到最后一帧的过渡，不允许突然跳切；用“缓慢推进、平滑环绕、轻微俯仰、视差移动、跟随主体”等连续运镜词。',
      '避免 Seedance 常见失败：主体漂移、脸变形、手部崩坏、服装变化、镜头突然拉远、画面闪烁、背景融化、运动过快、重复动作、文字水印、低清压缩。',
      '如果信息不足，给一个合理默认：5 秒、24fps、平滑运镜、中景起步、轻微推进或跟拍，并明确哪些内容需要用户补充。'
    ].join('\n');
  }

  const ASSISTANT_SKILLS = [
    {
      id: 'seedance2-director',
      name: 'Seedance 2 导演',
      description: '把故事、分镜、参考图和导演台截图改写成 Seedance 2 可用镜头指令。',
      prompt: seedance2DirectorPrompt()
    }
    ,
    {
      id: 'product-design',
      name: '产品设计',
      description: '把需求、截图和功能想法整理成产品方案、用户流程、信息架构、交互规格和验收标准。',
      tags: ['产品', '交互', '界面', '流程'], 
      prompt: productDesignPrompt()
    }
  ];

  let EXTERNAL_ASSISTANT_SKILLS = [];

  function normalizeAssistantSkill(skill = {}) {
    const id = String(skill.id || '').trim().replace(/[^a-zA-Z0-9:_-]/g, '-').slice(0, 80);
    const name = String(skill.name || '').trim().slice(0, 40);
    const description = String(skill.description || '').trim().slice(0, 180);
    const prompt = String(skill.prompt || '').trim().slice(0, 6000);
    if (!id || !name || !prompt) return null;
    return {
      id,
      name,
      description: description || '社区技能',
      prompt,
      source: String(skill.source || '').trim().slice(0, 400),
      originalName: String(skill.originalName || '').trim().slice(0, 100),
      originalDescription: String(skill.originalDescription || '').trim().slice(0, 220),
      tags: Array.isArray(skill.tags) ? skill.tags.map(tag => String(tag).trim()).filter(Boolean).slice(0, 6) : [],
      installedAt: skill.installedAt || Date.now()
    };
  }

  function allAssistantSkills() {
    const map = new Map();
    [...ASSISTANT_SKILLS, ...EXTERNAL_ASSISTANT_SKILLS].forEach(skill => {
      const normalized = normalizeAssistantSkill(skill);
      if (normalized && !map.has(normalized.id)) map.set(normalized.id, normalized);
    });
    return [...map.values()];
  }

  function setAssistantSkillCatalog(skills = []) {
    EXTERNAL_ASSISTANT_SKILLS = (Array.isArray(skills) ? skills : []).map(normalizeAssistantSkill).filter(Boolean);
    return assistantSkills();
  }

  function assistantSkills() {
    return allAssistantSkills().map(skill => ({...skill, tags: [...(skill.tags || [])]}));
  }

  function normalizeSkillIds(skills = []) {
    const allowed = new Set(allAssistantSkills().map(skill => skill.id));
    return [...new Set((Array.isArray(skills) ? skills : []).filter(id => allowed.has(id)))];
  }
  function defaultPromptTopics(now = Date.now()) {
    return [
      {
        id: `pt_${now}_1`,
        name: '角色一致性',
        prefixPrompt: '优先保持角色五官、发型、年龄、体型、服装核心结构和美术风格一致。用户最后一句拥有最高优先级。',
        prompt: '生成角色设定图：明确脸部特征、发型、服装、材质、表情、姿态和画面比例。若用户指定局部或特写，必须服从指定景别。',
        negativePrompt: '文字，水印，低清，严重变形，多余肢体，脸部崩坏，身份漂移，风格漂移。',
        refs: []
      },
      {
        id: `pt_${now}_2`,
        name: '智能改图',
        prefixPrompt: '先判断用户是局部修改、风格参考新生成、普通参考生成还是图片理解。不要把所有参考图都当成底稿。',
        prompt: '根据用户最后一句判断任务：局部修改只改指定内容；风格参考只继承风格；新角色生成必须重新设计主体；图片理解只输出分析。',
        negativePrompt: '误用旧图主体，复制旧构图，把风格参考当底稿，全图重绘，忽略用户最后一句。',
        refs: []
      }
    ];
  }

  function defaultAssistantProfiles(defaultModel = 'gpt-4o-mini') {
    return [
      {
        id: 'intent-first-creator',
        name: '智能创作总监',
        icon: 'AI',
        model: defaultModel,
        systemPrompt: creatorDirectorPrompt(),
        negativePrompt: '空泛建议，忽略画布上下文，忽略用户最后一句，编造不存在的信息，过度解释，模板化套话，角色漂移，风格漂移，节点关系误读。'
      },
      {
        id: 'dialog-image-editor',
        name: '对话改图导演',
        icon: 'EDIT',
        model: defaultModel,
        systemPrompt: imageEditDirectorPrompt(),
        negativePrompt: '全图误重绘，主体走样，参考用途混淆，边缘硬切，模糊，涂抹感，低清，多余肢体，忽略保留区域。'
      },
      {
        id: 'image-understand',
        name: '图片理解顾问',
        icon: 'SEE',
        model: defaultModel,
        systemPrompt: imageUnderstandingPrompt(),
        negativePrompt: ''
      }
    ];
  }

  function normalizeAssistantProfiles({profiles = [], activeId = '', defaultModel = 'gpt-4o-mini', now = Date.now()} = {}) {
    let nextProfiles = Array.isArray(profiles) && profiles.length ? profiles : defaultAssistantProfiles(defaultModel);
    nextProfiles = nextProfiles.filter(profile => profile?.id !== 'seedance2-director');
    const builtinProfiles = defaultAssistantProfiles(defaultModel);
    builtinProfiles.forEach(profile => {
      if (!nextProfiles.some(item => item.id === profile.id)) nextProfiles.push(profile);
    });
    nextProfiles = nextProfiles.map((item, index) => ({
      id: item.id || `assistant_${index}_${now}`,
      name: item.name || '默认助手',
      icon: item.icon || 'AI',
      model: item.model || defaultModel,
      systemPrompt: item.systemPrompt || '',
      negativePrompt: item.negativePrompt || '',
      skills: normalizeSkillIds(item.skills)
    }));
    const nextActiveId = nextProfiles.some(item => item.id === activeId) ? activeId : nextProfiles[0]?.id || '';
    return {profiles: nextProfiles, activeId: nextActiveId};
  }

  function activeAssistantProfile(profiles = [], activeId = '') {
    return profiles.find(item => item.id === activeId) || profiles[0] || null;
  }

  function assistantSystemPrompt(profiles = [], activeId = '') {
    const profile = activeAssistantProfile(profiles, activeId);
    const base = String(profile?.systemPrompt || '').trim();
    const skills = allAssistantSkills();
    const skillPrompts = normalizeSkillIds(profile?.skills).map(id => skills.find(skill => skill.id === id)?.prompt).filter(Boolean);
    return [base, ...skillPrompts.map(prompt => `【启用技能】\n${prompt}`)].filter(Boolean).join('\n\n');
  }

  function ensurePromptTopics({topics = [], activeId = '', now = Date.now()} = {}) {
    // Do not silently recreate a built-in topic after the user deletes it. Older
    // versions appended the defaults on every render, making deletion appear to
    // succeed until the next refresh. Defaults are only seeded for a brand-new
    // project with no saved topics at all.
    let nextTopics = Array.isArray(topics) && topics.length ? topics : defaultPromptTopics(now);
    nextTopics = nextTopics.filter(topic => topic?.name !== 'Seedance 2 镜头');
    const nextActiveId = nextTopics.some(item => item.id === activeId) ? activeId : nextTopics[0]?.id || '';
    return {topics: nextTopics, activeId: nextActiveId};
  }

  function activePromptTopic(topics = [], activeId = '') {
    return topics.find(item => item.id === activeId) || topics[0] || null;
  }

  function newAssistantProfile({defaultModel = 'gpt-4o-mini', now = Date.now(), random = Math.random()} = {}) {
    return {
      id: `assistant_${now}_${String(random).toString(16).slice(2)}`,
      name: '新助手',
      icon: 'AI',
      model: defaultModel,
      systemPrompt: creatorDirectorPrompt(),
      negativePrompt: ''
    };
  }

  function newAssistantTopic({index = 1, now = Date.now(), random = Math.random()} = {}) {
    return {
      id: `pt_${now}_${String(random).toString(16).slice(2)}`,
      name: `新话题 ${index}`,
      prefixPrompt: '',
      prompt: '',
      negativePrompt: '',
      refs: [],
      dialogEdit: blankDialogTopicState('新任务已创建。直接描述目标、问题或想完成的工作。')
    };
  }

  window.FutureAIAssistantTopics = {
    blankDialogTopicState,
    dialogTopicState,
    defaultPromptTopics,
      defaultAssistantProfiles,
      normalizeAssistantProfiles,
      setAssistantSkillCatalog,
      assistantSkills,
      activeAssistantProfile,
    assistantSystemPrompt,
    ensurePromptTopics,
    activePromptTopic,
    newAssistantProfile,
    newAssistantTopic
  };
})();



