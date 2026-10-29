(function initPromptAssistCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FutureAIPromptAssistCore = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  'use strict';

  // Prompt assist (agent17u): local structure helpers + snippets. AI optimize stays separate.
  // Honest: local tools never invent model capabilities; they only reshape text the user already owns.

  const SECTIONS = Object.freeze([
    { id: 'subject', label: '主体', placeholder: '谁 / 什么，外貌与关键特征' },
    { id: 'scene', label: '场景', placeholder: '地点、时间、环境' },
    { id: 'action', label: '动作', placeholder: '正在做什么' },
    { id: 'compose', label: '构图', placeholder: '景别、机位、构图方式' },
    { id: 'light', label: '光线', placeholder: '光线方向、氛围光' },
    { id: 'style', label: '风格', placeholder: '画风、媒介、质感' },
    { id: 'avoid', label: '避免', placeholder: '不要出现的内容' }
  ]);

  const BUILTIN_SNIPPETS = Object.freeze([
    { id: 'portrait-clean', cat: '人物', label: '干净半身人像', text: '半身人像，正面微侧，干净背景，柔和棚拍光，皮肤质感自然，高细节' },
    { id: 'full-body', cat: '人物', label: '全身立绘', text: '全身立绘，完整头到脚，居中站立，设计感轮廓，纯色或简洁背景' },
    { id: 'anime-cel', cat: '风格', label: '日系赛璐璐', text: '日系动画风格，清晰线稿，赛璐璐上色，干净高对比，现代配色，非复古' },
    { id: 'cinematic', cat: '风格', label: '电影感', text: '电影灯光，胶片质感，浅景深，戏剧性构图，氛围强烈' },
    { id: 'product', cat: '场景', label: '商品棚拍', text: '商品棚拍，干净台面，柔光箱，无杂乱反光，品牌感构图' },
    { id: 'landscape', cat: '场景', label: '空镜风景', text: '宽幅风景空镜，远近层次清晰，自然光，无人物，无文字水印' },
    { id: 'closeup', cat: '构图', label: '情绪特写', text: '面部特写，强调眼神与表情，浅景深，戏剧光影' },
    { id: 'topdown', cat: '构图', label: '俯视构图', text: '俯视机位，几何构图，空间关系清楚' },
    { id: 'no-text', cat: '避免', label: '无文字水印', text: '避免：文字、字幕、水印、logo、畸变手指、多余肢体' },
    { id: 'consistent', cat: '角色', label: '角色一致提醒', text: '保持与参考图同一角色身份、脸型、发型、服装细节一致，仅改变指定内容' }
  ]);

  const SECTION_RE = /【\s*(主体|场景|动作|构图|光线|风格|避免)\s*】/g;

  function normalizePrompt(value) {
    return String(value || '').replace(/\r\n/g, '\n').trim();
  }

  function hasSectionMarkers(prompt) {
    SECTION_RE.lastIndex = 0;
    return SECTION_RE.test(normalizePrompt(prompt));
  }

  function buildSkeleton(seed = '') {
    const base = normalizePrompt(seed);
    if (hasSectionMarkers(base)) return base;
    const lines = SECTIONS.map(section => {
      if (section.id === 'subject' && base) return `【${section.label}】${base}`;
      return `【${section.label}】`;
    });
    return lines.join('\n');
  }

  function appendToSection(prompt, sectionId, text = '') {
    const section = SECTIONS.find(item => item.id === sectionId);
    if (!section) return normalizePrompt(prompt);
    const marker = `【${section.label}】`;
    const addition = String(text || '').trim();
    const current = normalizePrompt(prompt);
    if (!current) return addition ? `${marker}${addition}` : marker;
    if (!current.includes(marker)) {
      const block = addition ? `${marker}${addition}` : marker;
      return `${current}\n${block}`;
    }
    if (!addition) return current;
    const re = new RegExp(`(【\\s*${section.label}\\s*】)([^【]*)`);
    return current.replace(re, (_, m, body) => {
      const raw = String(body || '');
      const lead = (raw.match(/^\s*/) || [''])[0];
      const trail = (raw.match(/\s*$/) || [''])[0];
      const trimmed = raw.slice(lead.length, raw.length - trail.length);
      if (!trimmed) return `${m}${addition}${trail || '\n'}`;
      if (trimmed.includes(addition)) return `${m}${lead}${trimmed}${trail}`;
      const sep = /[，。；、]$/.test(trimmed) ? '' : '，';
      return `${m}${lead}${trimmed}${sep}${addition}${trail || '\n'}`;
    });
  }

  function insertSection(prompt, sectionId, text = '') {
    return appendToSection(prompt, sectionId, text);
  }

  function catToSectionId(cat, snippetText = '') {
    const c = String(cat || '').trim();
    const bit = normalizePrompt(snippetText);
    if (/^避免[:：]/.test(bit) || c === '避免') return 'avoid';
    if (c === '风格') return 'style';
    if (c === '场景') return 'scene';
    if (c === '构图') return 'compose';
    if (c === '光线') return 'light';
    if (c === '动作') return 'action';
    if (c === '人物' || c === '角色' || c === '主体') return 'subject';
    return 'style';
  }

  function appendSnippet(prompt, snippetText, opts = {}) {
    const base = normalizePrompt(prompt);
    let bit = normalizePrompt(snippetText);
    if (!bit) return base;
    if (!base) return bit;
    if (base.includes(bit)) return base;
    if (hasSectionMarkers(base)) {
      const sectionId = opts.sectionId || catToSectionId(opts.cat, bit);
      if (sectionId === 'avoid') bit = bit.replace(/^避免[:：]\s*/, '');
      return appendToSection(base, sectionId, bit);
    }
    return `${base}${/[，。；、]$/.test(base) ? '' : '，'}${bit}`;
  }

  function analyzePrompt(prompt) {
    const text = normalizePrompt(prompt);
    const tips = [];
    if (!text) {
      return {
        empty: true,
        length: 0,
        hasStructure: false,
        missing: SECTIONS.map(s => s.label),
        tips: ['先写一句主体描述，或点「补全结构」生成填写骨架。'],
        score: 0
      };
    }
    const length = text.length;
    if (length < 12) tips.push('提示词偏短，可补充场景、构图或光线。');
    if (length > 500) tips.push('提示词较长，生成前可再精简，避免模型抓不住重点。');
    const present = new Set();
    let match;
    SECTION_RE.lastIndex = 0;
    while ((match = SECTION_RE.exec(text))) present.add(match[1]);
    const missing = SECTIONS.map(s => s.label).filter(label => !present.has(label));
    const hasStructure = present.size >= 2;
    if (!hasStructure && !/(风格|光线|构图|景别|特写|全身)/.test(text)) {
      tips.push('可点「补全结构」，按主体/场景/构图等分项填写，更容易改。');
    }
    if (!/(避免|不要|无文字|无水印)/.test(text)) tips.push('建议加上「避免」：文字、水印、畸变手指等。');
    if (/最好的模型|最强画质|100%|保证/.test(text)) {
      tips.push('接口不会因为写了“最好/保证”就变更强；写清楚画面内容更有效。');
    }
    const covered = SECTIONS.length - missing.length;
    const score = Math.max(1, Math.min(100, Math.round((Math.min(length, 160) / 160) * 50 + (covered / SECTIONS.length) * 50)));
    return { empty: false, length, hasStructure, missing, tips: tips.slice(0, 4), score };
  }

  function snippetsByCategory(list = BUILTIN_SNIPPETS) {
    const map = new Map();
    for (const item of list) {
      const cat = item.cat || '其他';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat).push(item);
    }
    return [...map.entries()].map(([cat, items]) => ({ cat, items }));
  }

  function mergeUserSnippets(userList = []) {
    const seen = new Set(BUILTIN_SNIPPETS.map(item => item.id));
    const extras = [];
    for (const raw of Array.isArray(userList) ? userList : []) {
      const id = String(raw?.id || '').trim();
      const text = normalizePrompt(raw?.text);
      if (!id || !text || seen.has(id)) continue;
      seen.add(id);
      extras.push({
        id,
        cat: String(raw.cat || '我的').slice(0, 20) || '我的',
        label: String(raw.label || id).slice(0, 40),
        text,
        user: true
      });
    }
    return [...BUILTIN_SNIPPETS, ...extras];
  }

  function recentPromptEntry(prompt, meta = {}) {
    const text = normalizePrompt(prompt);
    if (!text) return null;
    return {
      text: text.slice(0, 1200),
      at: Number(meta.at || Date.now()),
      nodeType: String(meta.nodeType || 'image').slice(0, 20),
      title: String(meta.title || '').slice(0, 80)
    };
  }

  function pushRecent(list, entry, max = 20) {
    const next = Array.isArray(list) ? list.slice() : [];
    if (!entry?.text) return next.slice(0, max);
    const filtered = next.filter(item => item && item.text !== entry.text);
    filtered.unshift(entry);
    return filtered.slice(0, max);
  }

  return {
    SECTIONS,
    BUILTIN_SNIPPETS,
    normalizePrompt,
    hasSectionMarkers,
    buildSkeleton,
    insertSection,
    appendToSection,
    catToSectionId,
    appendSnippet,
    analyzePrompt,
    snippetsByCategory,
    mergeUserSnippets,
    recentPromptEntry,
    pushRecent
  };
});
