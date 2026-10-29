'use strict';

const DEFAULT_LIMIT = 18;

const CURATED_SKILLS = Object.freeze([
  {
    id: 'market-storyboard-director',
    name: '分镜导演',
    description: '把剧情拆成镜头表、景别、动作、画面重点和生成提示词。',
    tags: ['分镜', '镜头', '漫剧'],
    source: '内置精选',
    prompt: '你是 AI 漫剧分镜导演。把用户的剧情或节点上下文拆成可执行分镜：镜头编号、时长、景别、主体动作、表情、构图、镜头运动、画面提示词、负向避免。优先保证镜头连续、角色一致和生成可落地。'
  },
  {
    id: 'market-character-consistency',
    name: '角色一致性审查',
    description: '检查角色五官、服装、年龄、材质、风格和跨镜头一致性风险。',
    tags: ['角色', '一致性', '审查'],
    source: '内置精选',
    prompt: '你是角色一致性审查助手。分析当前角色设定、参考图和提示词，指出身份漂移风险，并给出统一五官、发型、服装、材质、年龄、体型、色彩和负向提示词。输出要能直接复制到图像/视频节点。'
  },
  {
    id: 'market-prompt-polisher',
    name: '提示词精修',
    description: '把口语需求整理成结构化正向/负向提示词，适合图片和视频节点。',
    tags: ['提示词', '优化', '节点'],
    source: '内置精选',
    prompt: '你是提示词精修助手。把用户自然语言改写成清晰、可执行的正向提示词和负向提示词。必须包含主体、动作、场景、构图、光线、风格、材质、比例、参考图用途和避免项；不要堆空泛形容词。'
  },
  {
    id: 'market-canvas-planner',
    name: '画布流程规划',
    description: '根据项目目标规划节点、资产、连线和下一步执行顺序。',
    tags: ['画布', '流程', '规划'],
    source: '内置精选',
    prompt: '你是无限画布流程规划师。根据项目摘要和选中节点，规划接下来应该创建哪些节点、如何连线、哪些素材进入资产库、先做哪一步验证。输出要短、按优先级排列，并指出缺失信息。'
  }
]);

function humanizeSkillName(name = '') {
  const text = String(name || '').replace(/[-_]+/g, ' ').trim();
  const lower = text.toLowerCase();
  const parts = [];
  if (/bilingual|translate|translation|i18n|paper/.test(lower)) parts.push('双语翻译');
  if (/paper|reading|read/.test(lower)) parts.push('论文阅读');
  if (/podcast|audio|voice/.test(lower)) parts.push('播客制作');
  if (/agile|development|coding|code|workflow/.test(lower)) parts.push('开发流程');
  if (/prompt/.test(lower)) parts.push('提示词');
  if (/image|vision|photo/.test(lower)) parts.push('图像');
  if (/video|director|storyboard|film/.test(lower)) parts.push('视频导演');
  if (/security|audit/.test(lower)) parts.push('安全审查');
  if (/research|market/.test(lower)) parts.push('研究');
  if (/content|writing|article|blog/.test(lower)) parts.push('内容写作');
  const label = parts.length ? [...new Set(parts)].join(' / ') : text.replace(/\b(skill|workflow|agent|hub|repo)\b/ig, '').trim();
  return (label || text || '社区技能').slice(0, 40);
}

function translateSkillDescription(name = '', description = '') {
  const raw = `${name} ${description}`.toLowerCase();
  const abilities = [];
  if (/bilingual|translate|translation|chinese|english/.test(raw)) abilities.push('中英文翻译和双语整理');
  if (/paper|academic|reading|research/.test(raw)) abilities.push('论文阅读、资料提炼和研究摘要');
  if (/podcast|audio|voice|spotify|youtube/.test(raw)) abilities.push('播客选题、脚本、发布流程和内容复用');
  if (/agile|development|coding|code|requirements|clarification/.test(raw)) abilities.push('软件开发流程、需求澄清和代码任务拆解');
  if (/prompt|llm|chatgpt|agent/.test(raw)) abilities.push('提示词、Agent 工作流和自动化协作');
  if (/image|vision|photo|video|storyboard|director/.test(raw)) abilities.push('图像、视频、分镜和导演类创作');
  if (/security|audit|review/.test(raw)) abilities.push('安全审查、风险检查和质量把关');
  if (/content|writing|article|blog|social/.test(raw)) abilities.push('内容写作、文章结构和多平台发布');
  if (!abilities.length) abilities.push('把该仓库的工作流整理成可在当前项目中启用的助手技能');
  const note = String(description || '').trim();
  return `作用：${[...new Set(abilities)].join('；')}。${note ? `原说明：${note.slice(0, 120)}` : ''}`.slice(0, 260);
}

function marketSkillInstallNote(skill = {}) {
  return `下载后会加入本地技能库，可给当前助手开启。来源：${skill.source || '社区搜索'}。`;
}

function skillMarketPromptFromRepository(item = {}) {
  const originalName = String(item.name || item.full_name || '社区技能').replace(/[-_]/g, ' ').slice(0, 80);
  const name = humanizeSkillName(originalName);
  const description = translateSkillDescription(originalName, item.description || '');
  return [
    `你是「${name}」技能。`,
    description,
    `原始名称：${originalName}。`,
    '结合当前助手身份、用户最后一句、画布上下文和选中节点，输出可直接执行的中文结果。',
    '不要泛泛介绍仓库；要把能力转化为当前项目可用的提示词、检查清单或下一步操作。'
  ].join('\n');
}

function normalizeMarketSkill(item = {}, source = 'GitHub') {
  const fullName = String(item.full_name || item.name || '').trim();
  const originalName = String(item.name || fullName || '社区技能').replace(/[-_]/g, ' ').slice(0, 80);
  const idSource = fullName || String(item.html_url || item.url || originalName || 'community-skill');
  const slug = idSource.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'community-skill';
  const name = humanizeSkillName(originalName);
  const description = translateSkillDescription(originalName, item.description || '');
  const tags = ['社区', '已翻译', source].concat(String(item.language || '').trim() ? [item.language] : []).slice(0, 6);
  return {
    id: `market-${slug}`,
    name,
    description,
    originalName,
    originalDescription: String(item.description || '').slice(0, 220),
    source: item.html_url || item.url || source,
    stars: Number(item.stargazers_count || 0),
    tags,
    installNote: marketSkillInstallNote({ source: item.html_url || item.url || source }),
    prompt: skillMarketPromptFromRepository(item)
  };
}

function expandedSkillMarketQueries(query = '') {
  const text = String(query || '').trim().toLowerCase();
  const mapped = [];
  const dictionary = [
    [/导演|分镜|镜头|视频/, 'video director storyboard camera shot prompt'],
    [/角色|一致|人设/, 'character consistency persona image prompt'],
    [/提示词|咒语|prompt/, 'prompt engineering agent skill'],
    [/翻译|双语|中文|英文/, 'translation bilingual paper reading skill'],
    [/论文|阅读|研究/, 'paper reading research summarization skill'],
    [/代码|开发|编程/, 'coding development workflow agent skill'],
    [/安全|审查|审核/, 'security review audit skill'],
    [/内容|写作|文章|营销/, 'content writing marketing workflow skill']
  ];
  dictionary.forEach(([pattern, value]) => { if (pattern.test(text)) mapped.push(value); });
  const base = text || 'AI agent skill';
  return [...new Set([
    `${base} SKILL.md agent workflow`,
    ...mapped.map(item => `${item} SKILL.md`),
    ...mapped.map(item => `${item} codex skills`),
    'agent skills SKILL.md codex claude cursor',
    'AI agent workflows SKILL.md repository'
  ])].slice(0, 6);
}

function normalizeCodeSearchSkill(item = {}) {
  const repo = item.repository || {};
  return normalizeMarketSkill({
    name: repo.name || item.name || 'SKILL.md',
    full_name: repo.full_name || item.path || item.name,
    description: repo.description || `包含 ${item.path || 'SKILL.md'} 的社区技能文件`,
    html_url: item.html_url || repo.html_url,
    stargazers_count: repo.stargazers_count || 0,
    language: repo.language || ''
  }, 'GitHub 代码');
}

async function searchSkillMarket(payload = {}, options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : DEFAULT_LIMIT;
  const curatedSkills = Array.isArray(options.curatedSkills) ? options.curatedSkills : CURATED_SKILLS;
  const fetchImpl = Object.prototype.hasOwnProperty.call(options, 'fetchImpl') ? options.fetchImpl : globalThis.fetch;
  const query = String(payload.query || '').trim().slice(0, 80);
  const local = curatedSkills.filter(skill => !query || `${skill.name} ${skill.description} ${(skill.tags || []).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const results = [...local];
  const diagnostics = [];
  if (typeof fetchImpl === 'function') {
    for (const searchText of expandedSkillMarketQueries(query)) {
      const remoteQuery = encodeURIComponent(searchText);
      try {
        const repoResponse = await fetchImpl(`https://api.github.com/search/repositories?q=${remoteQuery}&sort=stars&order=desc&per_page=8`, {
          headers: {Accept: 'application/vnd.github+json', 'User-Agent': 'FutureAI-Skill-Market'}
        });
        diagnostics.push(`仓库搜索 ${repoResponse.status}`);
        if (repoResponse.ok) {
          const data = await repoResponse.json();
          (data.items || []).map(item => normalizeMarketSkill(item)).forEach(skill => {
            if (!results.some(existing => existing.id === skill.id)) results.push(skill);
          });
        }
        const codeResponse = await fetchImpl(`https://api.github.com/search/code?q=${encodeURIComponent(`${searchText} filename:SKILL.md`)}&per_page=6`, {
          headers: {Accept: 'application/vnd.github+json', 'User-Agent': 'FutureAI-Skill-Market'}
        });
        diagnostics.push(`代码搜索 ${codeResponse.status}`);
        if (codeResponse.ok) {
          const data = await codeResponse.json();
          (data.items || []).map(item => normalizeCodeSearchSkill(item)).forEach(skill => {
            if (!results.some(existing => existing.id === skill.id)) results.push(skill);
          });
        }
      } catch (error) {
        diagnostics.push(`远程失败：${error?.message || error}`);
      }
      if (results.length >= limit) break;
    }
  } else {
    diagnostics.push('当前运行环境没有 fetch');
  }
  const remoteCount = Math.max(0, results.length - local.length);
  return {
    query,
    source: remoteCount ? 'github+curated' : 'curated',
    remoteCount,
    localCount: local.length,
    diagnostics: diagnostics.slice(-8),
    skills: results.slice(0, limit)
  };
}

module.exports = {
  CURATED_SKILLS,
  DEFAULT_LIMIT,
  expandedSkillMarketQueries,
  humanizeSkillName,
  normalizeCodeSearchSkill,
  normalizeMarketSkill,
  searchSkillMarket,
  skillMarketPromptFromRepository,
  translateSkillDescription
};
