(() => {
  'use strict';

  function create(deps = {}) {
    const Core = () => deps.Core || window.FutureAIPromptAssistCore;
    const $ = deps.$ || (id => document.getElementById(id));
    const toast = deps.toast || (() => {});
    const esc = deps.esc || (value => String(value ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])));
    const getStore = deps.getStore || (() => null);
    const setStore = deps.setStore || (() => false);
    const optimizePrompt = deps.optimizePrompt || null;

    let activeNodeId = '';
    let draft = '';
    let userSnippets = [];

    function recentKey() { return 'futureai.promptAssist.recent'; }
    function loadRecent() {
      const value = getStore(recentKey(), []);
      return Array.isArray(value) ? value : [];
    }
    function saveRecent(list) { setStore(recentKey(), list.slice(0, 20)); }

    async function refreshUserSnippets() {
      try {
        if (window.promptSnippetBridge?.list) {
          userSnippets = await window.promptSnippetBridge.list() || [];
        }
      } catch (err) {
        userSnippets = [];
        console.warn('[prompt-assist] list snippets', err);
      }
      return userSnippets;
    }

    function modal() { return $('promptAssistModal'); }
    function draftBox() { return $('promptAssistDraft'); }
    function tipBox() { return $('promptAssistTips'); }
    function snipBox() { return $('promptAssistSnippets'); }
    function recentBox() { return $('promptAssistRecent'); }
    function statusBox() { return $('promptAssistStatus'); }

    function setStatus(text) {
      if (statusBox()) statusBox().textContent = text || '';
    }

    function syncAnalysis() {
      const core = Core();
      if (!core) return;
      const analysis = core.analyzePrompt(draft);
      const tipEl = tipBox();
      if (!tipEl) return;
      const missing = analysis.missing?.length ? `可补：${analysis.missing.slice(0, 4).join('、')}` : '结构较完整';
      const tips = (analysis.tips || []).map(t => `<li>${esc(t)}</li>`).join('') || '<li>看起来可以开始生成了。</li>';
      tipEl.innerHTML = `<div class="prompt-assist-score">完整度 ${esc(analysis.score)} · ${esc(missing)} · ${esc(analysis.length)} 字</div><ul>${tips}</ul>`;
    }

    function renderSnippets() {
      const core = Core();
      const box = snipBox();
      if (!core || !box) return;
      const groups = core.snippetsByCategory(core.mergeUserSnippets(userSnippets));
      box.innerHTML = groups.map(group => `
        <div class="prompt-assist-group">
          <strong>${esc(group.cat)}</strong>
          <div class="prompt-assist-chips">
            ${group.items.map(item => `<button type="button" class="prompt-assist-chip" data-snip-id="${esc(item.id)}" title="${esc(item.text)}">${esc(item.label)}${item.user ? ' ·我的' : ''}</button>`).join('')}
          </div>
        </div>`).join('');
    }

    function renderRecent() {
      const box = recentBox();
      if (!box) return;
      const list = loadRecent();
      box.innerHTML = list.length
        ? list.map((item, index) => `<button type="button" class="prompt-assist-recent" data-recent-index="${index}" title="${esc(item.text)}"><span>${esc((item.text || '').slice(0, 48))}${(item.text || '').length > 48 ? '…' : ''}</span><small>${esc(item.nodeType || '')}</small></button>`).join('')
        : '<p class="prompt-assist-empty">还没有最近用过的提示词</p>';
    }

    function renderSections() {
      const core = Core();
      const box = $('promptAssistSections');
      if (!core || !box) return;
      box.innerHTML = core.SECTIONS.map(section =>
        `<button type="button" class="prompt-assist-section" data-section-id="${esc(section.id)}" title="${esc(section.placeholder)}"><i class="fa-solid fa-plus"></i>${esc(section.label)}</button>`
      ).join('');
    }

    function readDraftFromUi() {
      draft = draftBox()?.value || '';
      syncAnalysis();
    }

    function writeDraft(value) {
      draft = Core()?.normalizePrompt(value) || String(value || '');
      if (draftBox()) draftBox().value = draft;
      syncAnalysis();
    }

    function openForNode(node) {
      if (!node) return toast('请先选中一个节点', 'warn');
      activeNodeId = node.id;
      writeDraft(node.data?.prompt || '');
      renderSections();
      refreshUserSnippets().then(() => { renderSnippets(); renderRecent(); });
      const title = $('promptAssistTitle');
      if (title) title.textContent = node.type === 'video' ? '提示词辅助 · 视频' : node.type === 'prompt' || node.type === 'character' ? '提示词辅助 · 文本' : '提示词辅助';
      setStatus('本地辅助不消耗额度；「AI 优化」会调用聊天模型。');
      modal()?.classList.remove('hidden');
      modal()?.setAttribute('aria-hidden', 'false');
      draftBox()?.focus();
    }

    function close() {
      modal()?.classList.add('hidden');
      modal()?.setAttribute('aria-hidden', 'true');
      activeNodeId = '';
    }

    function applyToNode() {
      const node = deps.getNode?.(activeNodeId);
      if (!node) return toast('节点已不存在', 'warn');
      readDraftFromUi();
      const text = Core()?.normalizePrompt(draft) || draft.trim();
      if (!text) return toast('提示词不能为空', 'warn');
      node.data.prompt = text;
      deps.hydrateNode?.(node);
      deps.saveProject?.();
      const entry = Core()?.recentPromptEntry(text, { nodeType: node.type, title: node.data?.title || '' });
      if (entry) saveRecent(Core().pushRecent(loadRecent(), entry));
      toast('已写回提示词', 'success');
      close();
    }

    function onSkeleton() {
      readDraftFromUi();
      writeDraft(Core().buildSkeleton(draft));
      setStatus('已插入结构骨架，按项填写即可。');
    }

    function onSection(id) {
      readDraftFromUi();
      writeDraft(Core().insertSection(draft, id));
    }

    function onSnippet(id) {
      const core = Core();
      const all = core.mergeUserSnippets(userSnippets);
      const item = all.find(s => s.id === id);
      if (!item) return;
      readDraftFromUi();
      writeDraft(core.appendSnippet(draft, item.text, { cat: item.cat }));
      setStatus(`已插入：${item.label}`);
    }

    function onRecent(index) {
      const item = loadRecent()[Number(index)];
      if (!item?.text) return;
      writeDraft(item.text);
      setStatus('已载入最近提示词');
    }

    async function onSaveSnippet() {
      readDraftFromUi();
      const text = Core()?.normalizePrompt(draft) || '';
      if (!text) return toast('请先写一段要收藏的提示词', 'warn');
      if (!window.promptSnippetBridge?.save) return toast('当前环境无法保存便携片段', 'warn');
      const label = (text.slice(0, 18).replace(/\n/g, ' ') || '我的片段').trim();
      try {
        await window.promptSnippetBridge.save({ label, cat: '我的', text });
        await refreshUserSnippets();
        renderSnippets();
        toast('已保存到软件目录 prompts（可随文件夹带走）', 'success');
      } catch (err) {
        toast('保存失败：\n' + (err.message || err), 'error');
      }
    }

    async function onAiOptimize() {
      if (!optimizePrompt || !activeNodeId) return toast('当前无法调用 AI 优化', 'warn');
      readDraftFromUi();
      const node = deps.getNode?.(activeNodeId);
      if (!node) return;
      node.data.prompt = Core()?.normalizePrompt(draft) || draft;
      deps.hydrateNode?.(node);
      await optimizePrompt(activeNodeId);
      writeDraft(node.data.prompt || '');
      setStatus('AI 优化完成（已消耗聊天额度）。可再点「写回节点」。');
    }

    function bind() {
      $('closePromptAssist')?.addEventListener('click', close);
      $('promptAssistApply')?.addEventListener('click', applyToNode);
      $('promptAssistSkeleton')?.addEventListener('click', onSkeleton);
      $('promptAssistSaveSnippet')?.addEventListener('click', onSaveSnippet);
      $('promptAssistOptimize')?.addEventListener('click', () => { onAiOptimize().catch(err => toast('优化失败：\n' + (err.message || err), 'error')); });
      draftBox()?.addEventListener('input', readDraftFromUi);
      snipBox()?.addEventListener('click', e => {
        const btn = e.target.closest('[data-snip-id]');
        if (btn) onSnippet(btn.dataset.snipId);
      });
      $('promptAssistSections')?.addEventListener('click', e => {
        const btn = e.target.closest('[data-section-id]');
        if (btn) onSection(btn.dataset.sectionId);
      });
      recentBox()?.addEventListener('click', e => {
        const btn = e.target.closest('[data-recent-index]');
        if (btn) onRecent(btn.dataset.recentIndex);
      });
      modal()?.addEventListener('click', e => { if (e.target === modal()) close(); });
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && modal() && !modal().classList.contains('hidden')) {
          e.preventDefault();
          close();
        }
      });
    }

    bind();

    return {
      bind,
      openForNode,
      close,
      refreshUserSnippets,
      analyzePrompt: (prompt) => Core()?.analyzePrompt(prompt),
      buildSkeleton: (prompt) => Core()?.buildSkeleton(prompt)
    };
  }

  window.FutureAIPromptAssist = { create };
})();
