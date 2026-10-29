(() => {
  'use strict';

  const MODE_OPTIONS = [
    ['readonly', '只读'],
    ['workspace', '工作区可写'],
    ['full', '完全访问']
  ];
  const WEEKDAYS = [
    ['1', '周一'], ['2', '周二'], ['3', '周三'], ['4', '周四'], ['5', '周五'], ['6', '周六'], ['0', '周日']
  ];

  function detectParams(promptText) {
    const found = [];
    const seen = new Set();
    const re = /\{\{\s*([\w\u4e00-\u9fff-]+)\s*\}\}/g;
    let match;
    while ((match = re.exec(String(promptText || '')))) {
      if (seen.has(match[1])) continue;
      seen.add(match[1]);
      found.push({ key: match[1], label: match[1], default: '' });
    }
    return found;
  }

  function renderPromptLocal(promptText, params, values) {
    const map = Object.create(null);
    for (const param of params || []) map[param.key] = param.default ?? '';
    for (const [key, value] of Object.entries(values || {})) map[key] = String(value ?? '');
    return String(promptText || '').replace(/\{\{\s*([\w\u4e00-\u9fff-]+)\s*\}\}/g, (_, key) => (key in map ? map[key] : `{{${key}}}`));
  }

  // Codex can only be the backend when the CLI was detected. codexCli === null/undefined means detection
  // has not finished yet, so keep the saved choice until we know.
  function resolveBackend(saved, codexCli) {
    const wanted = saved === 'codex' ? 'codex' : 'builtin';
    if (wanted === 'codex' && codexCli && !codexCli.ok) return { backend: 'builtin', fellBack: true };
    return { backend: wanted, fellBack: false };
  }

  function defaultSettings(raw = {}) {
    const steps = Math.round(Number(raw.maxSteps));
    const mode = ['readonly', 'workspace', 'full'].includes(raw.mode) ? raw.mode : 'workspace';
    const scheduleMode = ['readonly', 'workspace', 'full'].includes(raw.scheduleMode) ? raw.scheduleMode : 'workspace';
    const ttlHours = Number(raw.approvalTtlHours);
    return {
      backend: raw.backend === 'codex' ? 'codex' : 'builtin',
      mode,
      scheduleMode,
      workspace: String(raw.workspace || ''),
      fastModel: String(raw.fastModel || '').trim().slice(0, 200),
      maxSteps: Number.isFinite(steps) && steps >= 1 ? Math.min(steps, 1000) : 300,
      emergencyHotkey: String(raw.emergencyHotkey || 'CommandOrControl+Alt+Shift+S'),
      approvalTtlHours: Number.isFinite(ttlHours) && ttlHours >= 1 ? Math.min(ttlHours, 168) : 24,
      maxConcurrent: (() => { const n = Math.round(Number(raw.maxConcurrent)); return Number.isFinite(n) && n >= 1 ? Math.min(n, 8) : 3; })()
      // No per-category rules: the mode decides everything (old saved overrides are dropped here).
    };
  }

  const SESSION_STATUS_LABELS = {
    running: '运行中',
    scheduled: '定时运行中',
    awaiting_approval: '等待批准',
    done: '完成',
    stopped: '已停止',
    truncated: '达步数上限',
    error: '失败',
    emergency: '紧急停止',
    interrupted: '已中断'
  };

  function create(deps = {}) {
    const host = deps.host || {};
    const $ = deps.$;
    const esc = deps.esc;
    const toast = deps.toast;
    let lastLogPath = '';
    let lastPrompt = '';
    let uninstall = null;
    let planSteps = [];
    // Delegated child runs of the viewed session, keyed by child session id.
    let childRuns = new Map();
    let templates = [];
    let schedules = [];
    let history = [];
    let auditEntries = [];
    let auditMonth = '';
    let approvals = [];
    let pendingCount = 0;
    let panelTab = 'live';
    let editor = null; // { kind: 'template'|'schedule'|'run-params'|'memory', seed }
    let sessions = [];
    let memories = [];
    // Directory whose memory list has been fetched (or is being fetched); an empty list is a valid
    // answer, so we must not refetch-and-rerender just because it is empty (that looped forever and
    // kept replacing the selects under the cursor).
    let memoriesLoadedFor = null;
    let codexFallbackNotice = false;
    let activeViewSessionId = '';

    function settings() {
      const merged = defaultSettings(deps.getStore?.(host.STORE.settings, {}).agent || {});
      return { ...merged, backend: resolveBackend(merged.backend, host.codexCli).backend };
    }

    function storageDir() {
      return settings().workspace || host.storageDir || '';
    }

    function saveSettings(next) {
      const previous = deps.getStore?.(host.STORE.settings, {}) || {};
      const merged = defaultSettings({ ...previous.agent, ...next });
      deps.setStore?.(host.STORE.settings, { ...previous, agent: merged });
      deps.saveSettings?.();
      if (next.emergencyHotkey != null) {
        window.agentBridge?.emergencyHotkey?.({ accelerator: merged.emergencyHotkey }).catch(() => {});
      }
      renderSettings();
      renderPanel();
    }

    async function refreshLists() {
      const dir = storageDir();
      if (!dir || !window.agentBridge?.listTemplates) return;
      try {
        templates = await window.agentBridge.listTemplates(dir);
        schedules = await window.agentBridge.listSchedules(dir);
        history = await window.agentBridge.scheduleHistory({ storageDir: dir, limit: 30 });
        const months = await window.agentBridge.auditMonths(dir);
        auditMonth = months[0] || auditMonth;
        if (auditMonth) {
          const read = await window.agentBridge.readAudit({ storageDir: dir, month: auditMonth, limit: 80 });
          auditEntries = read.entries || [];
        } else auditEntries = [];
        approvals = await window.agentBridge.listApprovals({ storageDir: dir }) || [];
        pendingCount = approvals.length;
        sessions = await window.agentBridge.listSessions?.() || [];
        memories = await window.agentBridge.listMemory?.(dir) || [];
        memoriesLoadedFor = dir;
      } catch (err) {
        toast(err?.message || String(err), 'error');
      }
      renderPanel();
    }

    // Codex status from the shared detection (agent/codex-state.js). 浏览/重新检测 only show when they matter:
    // Codex is the chosen backend, or it is missing/still being checked.
    function codexStatusRow(cli, backend) {
      const status = cli ? (cli.ok ? 'ready' : 'missing') : 'checking';
      const text = !cli ? 'Codex 检测中…'
        : cli.ok ? `已找到 Codex ${cli.version}${cli.overridden ? '（手动选择）' : ''}`
        : '未检测到 Codex CLI，可点“浏览”手动选择 codex.exe';
      const detail = cli?.ok ? cli.path : (cli?.error || '');
      const actions = backend === 'codex' || status !== 'ready'
        ? `<span class="agent-codex-actions"><button type="button" class="ghost-btn" id="agentCodexChoose"><i class="fa-solid fa-folder-open"></i> 浏览</button><button type="button" class="ghost-btn" id="agentCodexRedetect" ${status === 'checking' ? 'disabled' : ''}><i class="fa-solid fa-rotate"></i> 重新检测</button></span>`
        : '';
      return `<div class="agent-codex-status" id="agentCodexStatus" data-status="${status}"><span><strong>${esc(text)}</strong>${detail ? `<small>${esc(detail)}</small>` : ''}</span>${actions}</div>`;
    }

    // Three visible mode cards; each spells out what is done directly, asked first, or blocked.
    function modeCards(name, selected, scheduled) {
      const Rules = window.FutureAIAgentRules;
      const askLabel = scheduled ? '进审批队列' : '先问你';
      const line = (label, items) => (items.length ? `<li><b>${label}</b>${items.map(esc).join('、')}</li>` : '');
      return `<div class="agent-mode-cards" role="radiogroup">${Rules.MODES.map(mode => {
        const d = Rules.describeMode(mode);
        return `<label class="agent-mode-card${mode === selected ? ' selected' : ''}">
          <input type="radio" name="${name}" value="${mode}" ${mode === selected ? 'checked' : ''} />
          <strong>${Rules.MODE_LABELS[mode]}</strong><span>${esc(d.summary)}</span>
          <ul>${line('直接做：', d.allow)}${line(`${askLabel}：`, d.ask)}${line('禁止：', d.deny)}</ul>
        </label>`;
      }).join('')}</div>`;
    }

    function renderSettings() {
      const box = $('agentSettingsPanel');
      if (!box) return;
      const memoryDir = storageDir();
      if (memoryDir && memoriesLoadedFor !== memoryDir && window.agentBridge?.listMemory) {
        memoriesLoadedFor = memoryDir;
        window.agentBridge.listMemory(memoryDir).then(list => {
          const next = list || [];
          const changed = JSON.stringify(next) !== JSON.stringify(memories);
          memories = next;
          if (changed) renderSettings();
        }).catch(() => {});
      }
      const current = settings();
      const cli = host.codexCli;
      const codexOk = !!cli?.ok;
      const stored = deps.getStore?.(host.STORE.settings, {}) || {};
      // cli is null until the shared detection finishes, so this never resets the choice early.
      const resolved = resolveBackend(stored.agent?.backend, cli);
      if (resolved.fellBack) {
        // Persist the fallback once (no re-render) so the disabled option can never stay selected.
        deps.setStore?.(host.STORE.settings, { ...stored, agent: { ...stored.agent, backend: 'builtin' } });
        codexFallbackNotice = true;
      }
      box.innerHTML = `
        <label>后端<select id="agentBackendSelect">
          <option value="builtin" ${current.backend === 'builtin' ? 'selected' : ''}>内置智能体</option>
          <option value="codex" ${current.backend === 'codex' ? 'selected' : ''} ${codexOk ? '' : 'disabled'}>Codex${codexOk ? '' : cli ? '（未检测到）' : '（检测中…）'}</option>
        </select>${codexFallbackNotice ? '<small class="agent-backend-hint">未检测到 Codex，已切换为内置智能体。安装 Codex 后可重新选择。</small>' : ''}</label>
        ${codexStatusRow(cli, current.backend)}
        <p class="agent-subhead">交互权限</p>
        ${modeCards('agentMode', current.mode, false)}
        <p class="agent-subhead">定时任务权限<small>无人值守时，需要“先问你”的操作会进入审批队列，等你批准后继续</small></p>
        ${modeCards('agentScheduleMode', current.scheduleMode, true)}
        <label>快速模型（可选）<input id="agentFastModelInput" value="${esc(current.fastModel)}" placeholder="留空 = 全程使用主模型" /><small>主模型就是设置里的全局聊天模型（如 gpt-6-astra），负责理解任务、制定计划、处理出错和看截图。填写后，简单的执行步骤（如新建/移动/删除文件）改用这个更快的模型，使用同一个供应商和密钥，例如 gpt-4o-mini。</small></label>
        <label>步数上限<input id="agentMaxStepsInput" type="number" min="1" max="1000" value="${current.maxSteps}" /></label>
        <label>审批等待时效（小时）<input id="agentApprovalTtl" type="number" min="1" max="168" value="${current.approvalTtlHours}" /><small>定时任务等待确认超时后自动拒绝</small></label>
        <label>紧急停止快捷键<input id="agentEmergencyHotkey" value="${esc(current.emergencyHotkey)}" placeholder="CommandOrControl+Alt+Shift+S" /><small>默认 Ctrl+Alt+Shift+S</small></label>
        <label>并发会话上限<input id="agentMaxConcurrent" type="number" min="1" max="8" value="${current.maxConcurrent}" /><small>同时运行的智能体会话数（默认 3）；GUI 控制全局串行</small></label>
        <div class="agent-workspace-row"><span title="${esc(current.workspace || host.storageDir || '')}">工作区：${esc(current.workspace || host.storageDir || '使用本地存储目录')}</span><button type="button" class="ghost-btn" id="agentChooseWorkspace"><i class="fa-solid fa-folder-open"></i> 选择</button></div>
        ${current.mode === 'full' ? '<p class="agent-full-warn"><i class="fa-solid fa-triangle-exclamation"></i> 完全访问不会再询问危险操作；系统目录、安装目录和凭证位置仍会拦截。</p>' : ''}
        <p class="agent-subhead">长期记忆 / 偏好</p>
        <div class="agent-memory-box">
          <div class="agent-row-actions">
            <button type="button" class="ghost-btn" id="agentMemoryRefresh"><i class="fa-solid fa-rotate"></i>刷新</button>
            <button type="button" class="ghost-btn" id="agentMemoryAdd"><i class="fa-solid fa-plus"></i>添加</button>
          </div>
          ${(memories || []).length ? `<ul class="agent-memory-list">${memories.map(item => `<li><strong>${esc(item.key)}</strong>：${esc(item.value)}${(item.tags||[]).length ? ` <em>${esc(item.tags.join(', '))}</em>` : ''}<span class="agent-row-actions"><button type="button" data-agent-mem-edit="${esc(item.id)}">编辑</button><button type="button" data-agent-mem-del="${esc(item.id)}">删除</button></span></li>`).join('')}</ul>` : '<p class="agent-muted">暂无记忆。智能体可用 remember 工具写入，或在此手动添加常用文件夹、风格偏好等。</p>'}
        </div>`;
      $('agentCodexChoose')?.addEventListener('click', () => deps.chooseCodex?.());
      $('agentCodexRedetect')?.addEventListener('click', () => deps.refreshCodex?.());
      $('agentBackendSelect')?.addEventListener('change', () => {
        const select = $('agentBackendSelect');
        const { backend } = resolveBackend(select.value, host.codexCli || { ok: false });
        if (backend !== select.value) select.value = backend;
        saveSettings({ backend });
      });
      box.querySelectorAll('input[name="agentMode"]').forEach(input => input.addEventListener('change', () => saveSettings({ mode: input.value })));
      box.querySelectorAll('input[name="agentScheduleMode"]').forEach(input => input.addEventListener('change', () => saveSettings({ scheduleMode: input.value })));
      $('agentFastModelInput')?.addEventListener('change', () => saveSettings({ fastModel: $('agentFastModelInput').value }));
      $('agentMaxStepsInput')?.addEventListener('change', () => saveSettings({ maxSteps: Number($('agentMaxStepsInput').value) || 300 }));
      $('agentApprovalTtl')?.addEventListener('change', () => saveSettings({ approvalTtlHours: Number($('agentApprovalTtl').value) || 24 }));
      $('agentMaxConcurrent')?.addEventListener('change', () => saveSettings({ maxConcurrent: Number($('agentMaxConcurrent').value) || 3 }));
      $('agentEmergencyHotkey')?.addEventListener('change', () => saveSettings({ emergencyHotkey: $('agentEmergencyHotkey').value.trim() || 'CommandOrControl+Alt+Shift+S' }));
      $('agentChooseWorkspace')?.addEventListener('click', async () => {
        const dir = await window.agentBridge?.chooseWorkspace?.();
        if (dir) {
          saveSettings({ workspace: dir });
          refreshLists();
        }
      });
      $('agentMemoryRefresh')?.addEventListener('click', () => refreshLists().then(() => renderSettings()));
      $('agentMemoryAdd')?.addEventListener('click', () => openEditor('memory', { key: '', value: '', tags: [] }));
      box.querySelectorAll('[data-agent-mem-edit]').forEach(btn => btn.addEventListener('click', () => {
        const item = memories.find(entry => entry.id === btn.dataset.agentMemEdit);
        if (item) openEditor('memory', item);
      }));
      box.querySelectorAll('[data-agent-mem-del]').forEach(btn => btn.addEventListener('click', async () => {
        if (!window.confirm('确定删除该记忆？')) return;
        try {
          await window.agentBridge.deleteMemory({ storageDir: storageDir(), id: btn.dataset.agentMemDel });
          toast('已删除记忆', 'success');
          await refreshLists();
          renderSettings();
        } catch (err) { toast(err?.message || String(err), 'error'); }
      }));
    }

    function appendLog(line) {
      host.agentOutput = `${host.agentOutput || ''}${line}\n`.slice(-100000);
      const box = $('agentOutputBox');
      if (box) {
        box.textContent = host.agentOutput;
        box.scrollTop = box.scrollHeight;
      }
    }

    function planHtml() {
      if (!planSteps.length) return '';
      const icon = { pending: '○', running: '●', done: '✓', error: '!', skipped: '–' };
      return `<ol class="agent-plan-list">${planSteps.map(step => `<li data-status="${esc(step.status)}"><span>${icon[step.status] || '○'}</span> ${esc(step.title)}</li>`).join('')}</ol>`;
    }

    function childRunsHtml() {
      if (!childRuns.size) return '';
      const label = { running: '运行中', progress: '运行中', reused: '已复用', done: '完成', stopped: '已停止', truncated: '达上限', error: '失败' };
      const rows = [...childRuns.values()].sort((a, b) => a.index - b.index);
      return `<ol class="agent-plan-list agent-child-list">${rows.map(item => `<li data-status="${esc(item.status === 'progress' ? 'running' : item.status)}"><span>${item.index + 1}/${item.total}</span> ${esc(item.title)} · ${esc(label[item.status] || item.status)}${item.line ? ` · ${esc(item.line)}` : ''}</li>`).join('')}</ol>`;
    }

    function formatWhen(ts) {
      if (!ts) return '—';
      try { return new Date(ts).toLocaleString('zh-CN', { hour12: false }); } catch (_err) { return String(ts); }
    }

    function openEditor(kind, seed = {}) {
      editor = { kind, seed: { ...seed } };
      renderPanel();
    }

    function closeEditor() {
      editor = null;
      renderPanel();
    }

    function editorOverlayHtml() {
      if (!editor) return '';
      if (editor.kind === 'template') return templateEditorHtml(editor.seed);
      if (editor.kind === 'schedule') return scheduleEditorHtml(editor.seed);
      if (editor.kind === 'run-params') return runParamsEditorHtml(editor.seed);
      return '';
    }

    function templateEditorHtml(seed) {
      const params = Array.isArray(seed.params) ? seed.params : detectParams(seed.prompt || '');
      const preview = renderPromptLocal(seed.prompt || '', params, Object.fromEntries(params.map(item => [item.key, item.default || `〈${item.key}〉`])));
      return `
        <div class="agent-modal" role="dialog" aria-modal="true">
          <div class="agent-modal-card">
            <header><strong>${seed.id ? '编辑模板' : '新建模板'}</strong><button type="button" class="icon-btn" data-agent-editor="close"><i class="fa-solid fa-xmark"></i></button></header>
            <label>名称<input id="agentTplName" maxlength="80" value="${esc(seed.name || '')}" placeholder="例如：每日素材整理" /></label>
            <label>提示词<textarea id="agentTplPrompt" rows="7" placeholder="可用 {{参数名}} 作为占位符">${esc(seed.prompt || lastPrompt || '')}</textarea></label>
            <div class="agent-toolbar">
              <button type="button" class="ghost-btn" id="agentTplDetect"><i class="fa-solid fa-wand-magic-sparkles"></i> 识别参数</button>
              <span class="agent-muted">从提示词中的 {{参数}} 自动生成字段</span>
            </div>
            <div id="agentTplParams" class="agent-param-fields">${params.map((param, index) => `
              <div class="agent-param-row" data-index="${index}">
                <label>参数名<input data-param="key" value="${esc(param.key)}" /></label>
                <label>显示名<input data-param="label" value="${esc(param.label || param.key)}" /></label>
                <label>默认值<input data-param="default" value="${esc(param.default || '')}" /></label>
                <button type="button" class="ghost-btn" data-param-remove="${index}">删除</button>
              </div>`).join('') || '<p class="agent-muted">暂无参数</p>'}
            </div>
            <p class="agent-subhead">预览</p>
            <pre class="agent-preview">${esc(preview || '（空）')}</pre>
            <div class="agent-modal-actions">
              <button type="button" class="ghost-btn" data-agent-editor="close">取消</button>
              <button type="button" class="primary-btn" id="agentTplSave"><i class="fa-solid fa-check"></i> 保存</button>
            </div>
            <p id="agentTplError" class="agent-form-error" hidden></p>
          </div>
        </div>`;
    }

    function scheduleEditorHtml(seed) {
      const kind = seed.kind || 'daily';
      return `
        <div class="agent-modal" role="dialog" aria-modal="true">
          <div class="agent-modal-card">
            <header><strong>${seed.id ? '编辑定时任务' : '新建定时任务'}</strong><button type="button" class="icon-btn" data-agent-editor="close"><i class="fa-solid fa-xmark"></i></button></header>
            <label>名称<input id="agentSchName" maxlength="80" value="${esc(seed.name || '每日任务')}" /></label>
            <label>模板<select id="agentSchTemplate">${templates.map(item => `<option value="${esc(item.id)}" ${item.id === seed.templateId ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label>
            <label>权限模式<select id="agentSchMode">${MODE_OPTIONS.map(([value, label]) => `<option value="${value}" ${(seed.mode || settings().scheduleMode) === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
            <label>类型<select id="agentSchKind">
              <option value="daily" ${kind === 'daily' ? 'selected' : ''}>每天</option>
              <option value="weekly" ${kind === 'weekly' ? 'selected' : ''}>每周</option>
              <option value="interval" ${kind === 'interval' ? 'selected' : ''}>间隔</option>
            </select></label>
            <div id="agentSchFields"></div>
            <label class="agent-check"><input id="agentSchEnabled" type="checkbox" ${seed.enabled === false ? '' : 'checked'} /> 启用</label>
            <div class="agent-modal-actions">
              <button type="button" class="ghost-btn" data-agent-editor="close">取消</button>
              <button type="button" class="primary-btn" id="agentSchSave"><i class="fa-solid fa-check"></i> 保存</button>
            </div>
            <p id="agentSchError" class="agent-form-error" hidden></p>
          </div>
        </div>`;
    }

    function runParamsEditorHtml(seed) {
      const params = seed.params || [];
      return `
        <div class="agent-modal" role="dialog" aria-modal="true">
          <div class="agent-modal-card">
            <header><strong>运行模板：${esc(seed.name || '')}</strong><button type="button" class="icon-btn" data-agent-editor="close"><i class="fa-solid fa-xmark"></i></button></header>
            <div class="agent-param-fields">${params.map(param => `
              <label>${esc(param.label || param.key)}<input data-run-param="${esc(param.key)}" value="${esc(param.default || '')}" /></label>`).join('') || '<p class="agent-muted">无需参数</p>'}
            </div>
            <p class="agent-subhead">将发送的提示词</p>
            <pre id="agentRunPreview" class="agent-preview">${esc(renderPromptLocal(seed.prompt || '', params, Object.fromEntries(params.map(item => [item.key, item.default || '']))))}</pre>
            <div class="agent-modal-actions">
              <button type="button" class="ghost-btn" data-agent-editor="close">取消</button>
              <button type="button" class="primary-btn" id="agentRunConfirm"><i class="fa-solid fa-play"></i> 运行</button>
            </div>
          </div>
        </div>`;
    }

    function bindScheduleFields(el, seed = {}) {
      const kindSelect = el.querySelector('#agentSchKind');
      const box = el.querySelector('#agentSchFields');
      const paint = () => {
        const kind = kindSelect.value;
        if (kind === 'interval') {
          box.innerHTML = `<label>间隔（分钟）<input id="agentSchEvery" type="number" min="1" max="10080" value="${esc(String(seed.everyMinutes || 60))}" /></label>`;
        } else if (kind === 'weekly') {
          box.innerHTML = `
            <label>星期<select id="agentSchWeekday">${WEEKDAYS.map(([value, label]) => `<option value="${value}" ${String(seed.weekday ?? 1) === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
            <label>时间<input id="agentSchTime" type="time" value="${esc(seed.time || '09:00')}" /></label>`;
        } else {
          box.innerHTML = `<label>时间<input id="agentSchTime" type="time" value="${esc(seed.time || '09:00')}" /></label>`;
        }
      };
      kindSelect?.addEventListener('change', paint);
      paint();
    }

    function bindTemplateEditor(el) {
      const err = el.querySelector('#agentTplError');
      const showError = message => {
        if (!err) return;
        err.hidden = !message;
        err.textContent = message || '';
      };
      const readParams = () => [...el.querySelectorAll('.agent-param-row')].map(row => ({
        key: row.querySelector('[data-param="key"]')?.value.trim() || '',
        label: row.querySelector('[data-param="label"]')?.value.trim() || '',
        default: row.querySelector('[data-param="default"]')?.value || ''
      })).filter(item => item.key);
      const refreshPreview = () => {
        const promptText = el.querySelector('#agentTplPrompt')?.value || '';
        const preview = renderPromptLocal(promptText, readParams(), Object.fromEntries(readParams().map(item => [item.key, item.default || `〈${item.key}〉`])));
        const box = el.querySelector('.agent-preview');
        if (box) box.textContent = preview || '（空）';
      };
      el.querySelector('#agentTplPrompt')?.addEventListener('input', refreshPreview);
      el.querySelector('#agentTplDetect')?.addEventListener('click', () => {
        const promptText = el.querySelector('#agentTplPrompt')?.value || '';
        const current = readParams();
        const detected = detectParams(promptText).map(item => {
          const prev = current.find(entry => entry.key === item.key);
          return prev || item;
        });
        editor = { kind: 'template', seed: { ...editor.seed, name: el.querySelector('#agentTplName')?.value || '', prompt: promptText, params: detected } };
        renderPanel();
      });
      el.querySelectorAll('[data-param-remove]').forEach(btn => btn.addEventListener('click', () => {
        const params = readParams().filter((_, index) => String(index) !== btn.dataset.paramRemove);
        editor = { kind: 'template', seed: { ...editor.seed, name: el.querySelector('#agentTplName')?.value || '', prompt: el.querySelector('#agentTplPrompt')?.value || '', params } };
        renderPanel();
      }));
      el.querySelectorAll('[data-param]').forEach(input => input.addEventListener('input', refreshPreview));
      el.querySelector('#agentTplSave')?.addEventListener('click', async () => {
        const name = el.querySelector('#agentTplName')?.value.trim() || '';
        const promptText = el.querySelector('#agentTplPrompt')?.value.trim() || '';
        if (!name) return showError('请填写模板名称');
        if (!promptText) return showError('请填写提示词');
        if (!storageDir()) return showError('请先选择存储/工作区目录');
        try {
          await window.agentBridge.upsertTemplate({
            storageDir: storageDir(),
            id: editor.seed.id,
            name,
            prompt: promptText,
            params: readParams()
          });
          toast('模板已保存', 'success');
          editor = null;
          panelTab = 'templates';
          refreshLists();
        } catch (error) {
          showError(error?.message || String(error));
        }
      });
    }

    function bindScheduleEditor(el) {
      bindScheduleFields(el, editor.seed);
      const err = el.querySelector('#agentSchError');
      el.querySelector('#agentSchSave')?.addEventListener('click', async () => {
        const name = el.querySelector('#agentSchName')?.value.trim() || '';
        const templateId = el.querySelector('#agentSchTemplate')?.value || '';
        const kind = el.querySelector('#agentSchKind')?.value || 'daily';
        if (!name) { err.hidden = false; err.textContent = '请填写名称'; return; }
        if (!templateId) { err.hidden = false; err.textContent = '请选择模板'; return; }
        if (!templates.length) { err.hidden = false; err.textContent = '请先创建模板'; return; }
        const payload = {
          storageDir: storageDir(),
          id: editor.seed.id,
          name,
          templateId,
          kind,
          mode: el.querySelector('#agentSchMode')?.value || settings().scheduleMode,
          enabled: !!el.querySelector('#agentSchEnabled')?.checked
        };
        if (kind === 'interval') payload.everyMinutes = Number(el.querySelector('#agentSchEvery')?.value || 60);
        else {
          payload.time = el.querySelector('#agentSchTime')?.value || '09:00';
          if (kind === 'weekly') payload.weekday = Number(el.querySelector('#agentSchWeekday')?.value ?? 1);
        }
        try {
          await window.agentBridge.upsertSchedule(payload);
          toast('定时任务已保存', 'success');
          editor = null;
          panelTab = 'schedules';
          refreshLists();
        } catch (error) {
          err.hidden = false;
          err.textContent = error?.message || String(error);
        }
      });
    }

    function bindRunParamsEditor(el) {
      const refresh = () => {
        const values = {};
        el.querySelectorAll('[data-run-param]').forEach(input => { values[input.dataset.runParam] = input.value; });
        const box = el.querySelector('#agentRunPreview');
        if (box) box.textContent = renderPromptLocal(editor.seed.prompt || '', editor.seed.params || [], values);
      };
      el.querySelectorAll('[data-run-param]').forEach(input => input.addEventListener('input', refresh));
      el.querySelector('#agentRunConfirm')?.addEventListener('click', async () => {
        const values = {};
        el.querySelectorAll('[data-run-param]').forEach(input => { values[input.dataset.runParam] = input.value; });
        const promptText = renderPromptLocal(editor.seed.prompt || '', editor.seed.params || [], values);
        const templateId = editor.seed.id;
        editor = null;
        await start(promptText, { templateId });
      });
    }

    function memoryEditorHtml(seed) {
      const tags = Array.isArray(seed.tags) ? seed.tags.join(', ') : String(seed.tags || '');
      return `<div class="agent-editor-form">
        <label>键（如 常用文件夹 / 风格偏好）<input id="agentMemKey" value="${esc(seed.key || '')}" maxlength="80" /></label>
        <label>内容<textarea id="agentMemValue" rows="4" maxlength="2000">${esc(seed.value || '')}</textarea></label>
        <label>标签（逗号分隔）<input id="agentMemTags" value="${esc(tags)}" /></label>
        <div class="agent-row-actions">
          <button type="button" data-agent-editor="close">取消</button>
          <button type="button" class="primary-btn" id="agentMemSave">保存</button>
        </div>
      </div>`;
    }

    function bindMemoryEditor(el) {
      el.querySelector('#agentMemSave')?.addEventListener('click', async () => {
        const key = el.querySelector('#agentMemKey')?.value?.trim();
        const value = el.querySelector('#agentMemValue')?.value?.trim();
        const tags = String(el.querySelector('#agentMemTags')?.value || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);
        if (!key || !value) return toast('请填写键和内容', 'warn');
        try {
          await window.agentBridge.upsertMemory({ storageDir: storageDir(), id: editor?.seed?.id, key, value, tags });
          toast('已保存记忆', 'success');
          closeEditor();
          await refreshLists();
          renderSettings();
        } catch (err) { toast(err?.message || String(err), 'error'); }
      });
    }

    function sessionsHtml() {
      const current = settings();
      const rows = (sessions || []).slice().sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
      if (!rows.length) {
        return `<div class="agent-section-head"><strong>会话</strong><span class="agent-muted">并发上限 ${current.maxConcurrent}</span>
          <button type="button" data-agent-sess="refresh"><i class="fa-solid fa-rotate"></i></button></div>
          <p class="agent-muted">当前没有运行中的智能体会话。可同时启动最多 ${current.maxConcurrent} 个；紧急停止会中止全部。</p>`;
      }
      return `<div class="agent-section-head"><strong>会话（${rows.length}/${current.maxConcurrent}）</strong>
        <button type="button" data-agent-sess="refresh"><i class="fa-solid fa-rotate"></i></button>
        <button type="button" data-agent-sess="emergency"><i class="fa-solid fa-skull-crossbones"></i>全部停止</button></div>
        <ul class="agent-session-list">${rows.map(item => {
          const active = item.sessionId === (activeViewSessionId || host.agentSessionId);
          const status = SESSION_STATUS_LABELS[item.status] || item.status || '运行中';
          const planDone = (item.plan || []).filter(s => s.status === 'done').length;
          const planTotal = (item.plan || []).length;
          return `<li class="${active ? 'active' : ''}">
            <div><strong>${esc((item.prompt || '').slice(0, 60) || item.sessionId)}</strong>
            <span class="agent-muted">${esc(status)}${item.resumable && item.step ? ` · 第 ${item.step} 步` : ''}${planTotal ? ` · 计划 ${planDone}/${planTotal}` : ''}${item.scheduled ? ' · 定时' : ''}${item.pendingApproval ? ` · 待批准 ${esc(item.pendingApproval.name)}` : ''}${item.error ? ` · ${esc(item.error.slice(0, 80))}` : ''}</span></div>
            <div class="agent-row-actions">${item.resumable ? `
              <button type="button" data-agent-sess-resume="${esc(item.sessionId)}">继续</button>
              <button type="button" data-agent-sess-discard="${esc(item.sessionId)}">放弃</button>` : `
              <button type="button" data-agent-sess-view="${esc(item.sessionId)}">查看</button>
              <button type="button" data-agent-sess-stop="${esc(item.sessionId)}" ${item.done ? 'disabled' : ''}>停止</button>`}
            </div>
          </li>`;
        }).join('')}</ul>`;
    }

    function templatesHtml() {
      return `
        <div class="agent-toolbar">
          <button type="button" class="ghost-btn" data-agent-tpl="save-last" ${lastPrompt ? '' : 'disabled'}><i class="fa-solid fa-floppy-disk"></i> 把上次任务存为模板</button>
          <button type="button" class="ghost-btn" data-agent-tpl="new"><i class="fa-solid fa-plus"></i> 新建</button>
          <button type="button" class="ghost-btn" data-agent-tpl="refresh"><i class="fa-solid fa-rotate"></i></button>
        </div>
        <ul class="agent-item-list">${templates.length ? templates.map(item => `
          <li>
            <div><strong>${esc(item.name)}</strong><small>${esc(item.prompt).slice(0, 80)}</small></div>
            <div class="agent-item-actions">
              <button type="button" data-agent-tpl-run="${esc(item.id)}">运行</button>
              <button type="button" data-agent-tpl-edit="${esc(item.id)}">编辑</button>
              <button type="button" data-agent-tpl-del="${esc(item.id)}">删除</button>
            </div>
          </li>`).join('') : '<li class="agent-empty">还没有模板。完成一次任务后可保存，或点新建。</li>'}
        </ul>`;
    }

    function schedulesHtml() {
      const weekdayLabel = value => (WEEKDAYS.find(([id]) => Number(id) === Number(value)) || [])[1] || '';
      return `
        <div class="agent-toolbar">
          <button type="button" class="ghost-btn" data-agent-sch="new" ${templates.length ? '' : 'disabled'}><i class="fa-solid fa-plus"></i> 新建定时</button>
          <button type="button" class="ghost-btn" data-agent-sch="refresh"><i class="fa-solid fa-rotate"></i></button>
        </div>
        <ul class="agent-item-list">${schedules.length ? schedules.map(item => `
          <li>
            <div>
              <strong>${esc(item.name)}</strong>
              <small>${esc(item.kind === 'interval' ? `每 ${item.everyMinutes} 分钟` : item.kind === 'weekly' ? `每${weekdayLabel(item.weekday)} ${item.time}` : `每天 ${item.time}`)} · ${item.enabled ? '启用' : '停用'} · 下次 ${formatWhen(item.nextRunAt)}</small>
            </div>
            <div class="agent-item-actions">
              <button type="button" data-agent-sch-edit="${esc(item.id)}">编辑</button>
              <button type="button" data-agent-sch-toggle="${esc(item.id)}">${item.enabled ? '停用' : '启用'}</button>
              <button type="button" data-agent-sch-del="${esc(item.id)}">删除</button>
            </div>
          </li>`).join('') : '<li class="agent-empty">暂无定时任务。应用打开期间会按计划触发模板。</li>'}
        </ul>
        <p class="agent-subhead">运行历史</p>
        <ul class="agent-item-list agent-history-list">${history.length ? history.map(item => `
          <li><div><strong>${esc(item.status)}</strong><small>${formatWhen(item.at)} · ${esc(item.summary || '')}</small></div></li>`).join('') : '<li class="agent-empty">暂无历史</li>'}
        </ul>`;
    }

    function approvalsHtml() {
      return `
        <div class="agent-toolbar">
          <button type="button" class="ghost-btn" data-agent-apr="refresh"><i class="fa-solid fa-rotate"></i> 刷新</button>
          <span class="agent-muted">待处理 ${pendingCount} 项；超时将自动拒绝</span>
        </div>
        <ul class="agent-item-list">${approvals.length ? approvals.map(item => `
          <li>
            <div>
              <strong>${esc(item.name)}</strong>
              <small>${esc(item.reason || '')} · 截止 ${formatWhen(item.expiresAt)}</small>
              <small class="agent-mono">${esc(JSON.stringify(item.arguments || {}).slice(0, 160))}</small>
            </div>
            <div class="agent-item-actions">
              <button type="button" data-agent-apr-allow="${esc(item.id)}">允许</button>
              <button type="button" data-agent-apr-always="${esc(item.id)}">本次会话总是</button>
              <button type="button" data-agent-apr-deny="${esc(item.id)}">拒绝</button>
            </div>
          </li>`).join('') : '<li class="agent-empty">暂无待确认操作</li>'}
        </ul>`;
    }

    function auditHtml() {
      return `
        <div class="agent-toolbar">
          <button type="button" class="ghost-btn" data-agent-audit="refresh"><i class="fa-solid fa-rotate"></i> 刷新审计</button>
          <span class="agent-muted">${esc(auditMonth || '无记录')}</span>
        </div>
        <pre class="agent-output agent-audit-box">${esc(auditEntries.length ? auditEntries.map(item => `${formatWhen(item.at)} [${item.type || item.status || ''}] ${item.name || ''} ${item.reason || item.summary || item.content || item.error || ''}`).join('\n') : '暂无审计记录。密钥已自动打码。')}</pre>`;
    }

    function renderPanel() {
      const el = $('agentLivePanel');
      if (!el) return;
      const current = settings();
      const tabs = [
        ['live', '运行'],
        ['sessions', `会话${sessions.filter(s => !s.done).length ? ` (${sessions.filter(s => !s.done).length})` : ''}`],
        ['templates', '模板'],
        ['schedules', '定时'],
        ['approvals', `审批${pendingCount ? ` (${pendingCount})` : ''}`],
        ['audit', '审计']
      ];
      el.innerHTML = `
        <div class="agent-live-head">
          <strong>${current.backend === 'codex' ? 'Codex' : '内置智能体 v2'}${pendingCount ? `<span class="agent-badge">${pendingCount}</span>` : ''}</strong>
          <span>${esc(({ readonly: '只读', workspace: '工作区可写', full: '完全访问' })[current.mode] || '')} · 定时${esc(({ readonly: '只读', workspace: '可写', full: '完全' })[current.scheduleMode] || '')} · ${host.agentStatus || '空闲'}</span>
          <div class="agent-live-actions">
            <button type="button" data-agent-action="emergency"><i class="fa-solid fa-skull-crossbones"></i>紧急停止</button>
            <button type="button" data-agent-action="stop" ${host.agentRunning ? '' : 'disabled'}><i class="fa-solid fa-stop"></i>停止</button>
            <button type="button" data-agent-action="restore" ${lastLogPath ? '' : 'disabled'}><i class="fa-solid fa-clock-rotate-left"></i>恢复备份</button>
          </div>
        </div>
        <div class="agent-tabs">${tabs.map(([id, label]) => `<button type="button" data-agent-tab="${id}" class="${panelTab === id ? 'active' : ''}">${label}</button>`).join('')}</div>
        <div class="agent-tab-body">
          ${panelTab === 'live' ? `${planHtml()}${childRunsHtml()}<pre id="agentOutputBox" class="agent-output">${esc(host.agentOutput || '等待任务…')}</pre>` : ''}
          ${panelTab === 'sessions' ? sessionsHtml() : ''}
          ${panelTab === 'templates' ? templatesHtml() : ''}
          ${panelTab === 'schedules' ? schedulesHtml() : ''}
          ${panelTab === 'approvals' ? approvalsHtml() : ''}
          ${panelTab === 'audit' ? auditHtml() : ''}
        </div>
        ${editorOverlayHtml()}`;
      el.querySelectorAll('[data-agent-tab]').forEach(btn => btn.addEventListener('click', () => {
        panelTab = btn.dataset.agentTab;
        if (panelTab !== 'live') refreshLists();
        else renderPanel();
      }));
      el.querySelector('[data-agent-action="stop"]')?.addEventListener('click', () => stop());
      el.querySelector('[data-agent-action="restore"]')?.addEventListener('click', () => restore());
      el.querySelector('[data-agent-action="emergency"]')?.addEventListener('click', () => emergency());
      el.querySelectorAll('[data-agent-editor="close"]').forEach(btn => btn.addEventListener('click', () => closeEditor()));
      if (editor?.kind === 'template') bindTemplateEditor(el);
      if (editor?.kind === 'schedule') bindScheduleEditor(el);
      if (editor?.kind === 'run-params') bindRunParamsEditor(el);
      if (editor?.kind === 'memory') bindMemoryEditor(el);
      bindTemplateActions(el);
      bindScheduleActions(el);
      bindApprovalActions(el);
      bindSessionActions(el);
      el.querySelector('[data-agent-audit="refresh"]')?.addEventListener('click', () => refreshLists());
    }

    function bindSessionActions(el) {
      el.querySelector('[data-agent-sess="refresh"]')?.addEventListener('click', () => refreshLists());
      el.querySelector('[data-agent-sess="emergency"]')?.addEventListener('click', () => emergency());
      el.querySelectorAll('[data-agent-sess-view]').forEach(btn => btn.addEventListener('click', () => {
        activeViewSessionId = btn.dataset.agentSessView;
        host.agentSessionId = activeViewSessionId;
        panelTab = 'live';
        renderPanel();
      }));
      el.querySelectorAll('[data-agent-sess-resume]').forEach(btn => btn.addEventListener('click', () => resume(btn.dataset.agentSessResume)));
      el.querySelectorAll('[data-agent-sess-discard]').forEach(btn => btn.addEventListener('click', async () => {
        try {
          await window.agentBridge.discardSession(btn.dataset.agentSessDiscard);
          refreshLists();
        } catch (err) { toast(err?.message || String(err), 'error'); }
      }));
      el.querySelectorAll('[data-agent-sess-stop]').forEach(btn => btn.addEventListener('click', async () => {
        try {
          await window.agentBridge?.cancel?.(btn.dataset.agentSessStop);
          toast('已请求停止该会话', 'success');
          if (host.agentSessionId === btn.dataset.agentSessStop) {
            host.agentRunning = false;
            host.agentStatus = '已停止';
          }
          refreshLists();
        } catch (err) { toast(err?.message || String(err), 'error'); }
      }));
    }

    function bindTemplateActions(el) {
      el.querySelector('[data-agent-tpl="refresh"]')?.addEventListener('click', () => refreshLists());
      el.querySelector('[data-agent-tpl="new"]')?.addEventListener('click', () => openEditor('template', { prompt: lastPrompt || '', params: detectParams(lastPrompt || '') }));
      el.querySelector('[data-agent-tpl="save-last"]')?.addEventListener('click', () => {
        if (!lastPrompt) return;
        openEditor('template', {
          name: `任务 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
          prompt: lastPrompt,
          params: detectParams(lastPrompt)
        });
      });
      el.querySelectorAll('[data-agent-tpl-run]').forEach(btn => btn.addEventListener('click', () => runTemplate(btn.dataset.agentTplRun)));
      el.querySelectorAll('[data-agent-tpl-edit]').forEach(btn => {
        btn.addEventListener('click', () => {
          const item = templates.find(entry => entry.id === btn.dataset.agentTplEdit);
          if (item) openEditor('template', item);
        });
      });
      el.querySelectorAll('[data-agent-tpl-del]').forEach(btn => btn.addEventListener('click', async () => {
        if (!window.confirm('确定删除该模板？')) return;
        try {
          await window.agentBridge.deleteTemplate({ storageDir: storageDir(), id: btn.dataset.agentTplDel });
          toast('已删除模板', 'success');
          refreshLists();
        } catch (err) { toast(err?.message || String(err), 'error'); }
      }));
    }

    function bindScheduleActions(el) {
      el.querySelector('[data-agent-sch="refresh"]')?.addEventListener('click', () => refreshLists());
      el.querySelector('[data-agent-sch="new"]')?.addEventListener('click', () => openEditor('schedule', { templateId: templates[0]?.id, kind: 'daily', time: '09:00', mode: settings().scheduleMode }));
      el.querySelectorAll('[data-agent-sch-edit]').forEach(btn => btn.addEventListener('click', () => {
        const item = schedules.find(entry => entry.id === btn.dataset.agentSchEdit);
        if (item) openEditor('schedule', item);
      }));
      el.querySelectorAll('[data-agent-sch-toggle]').forEach(btn => btn.addEventListener('click', async () => {
        const item = schedules.find(entry => entry.id === btn.dataset.agentSchToggle);
        if (!item) return;
        try {
          await window.agentBridge.upsertSchedule({ ...item, storageDir: storageDir(), enabled: !item.enabled });
          refreshLists();
        } catch (err) { toast(err?.message || String(err), 'error'); }
      }));
      el.querySelectorAll('[data-agent-sch-del]').forEach(btn => btn.addEventListener('click', async () => {
        if (!window.confirm('确定删除该定时任务？')) return;
        try {
          await window.agentBridge.deleteSchedule({ storageDir: storageDir(), id: btn.dataset.agentSchDel });
          refreshLists();
        } catch (err) { toast(err?.message || String(err), 'error'); }
      }));
    }

    function bindApprovalActions(el) {
      el.querySelector('[data-agent-apr="refresh"]')?.addEventListener('click', () => refreshLists());
      const resolve = async (id, answer) => {
        try {
          await window.agentBridge.resolveApproval({ storageDir: storageDir(), id, answer });
          toast(answer === 'deny' ? '已拒绝' : '已批准', 'success');
          refreshLists();
        } catch (err) { toast(err?.message || String(err), 'error'); }
      };
      el.querySelectorAll('[data-agent-apr-allow]').forEach(btn => btn.addEventListener('click', () => resolve(btn.dataset.agentAprAllow, 'allow')));
      el.querySelectorAll('[data-agent-apr-always]').forEach(btn => btn.addEventListener('click', () => resolve(btn.dataset.agentAprAlways, 'always')));
      el.querySelectorAll('[data-agent-apr-deny]').forEach(btn => btn.addEventListener('click', () => resolve(btn.dataset.agentAprDeny, 'deny')));
    }

    async function runTemplate(id) {
      const item = templates.find(entry => entry.id === id);
      if (!item) return toast('模板不存在', 'warn');
      if (!(item.params || []).length) return start(item.prompt, { templateId: id });
      openEditor('run-params', item);
    }

    function install() {
      if (uninstall || !window.agentBridge?.onEvent) return;
      announceInterrupted();
      uninstall = window.agentBridge.onEvent(async payload => {
        if (!payload) return;
        if (payload.type === 'schedule_due') {
          appendLog(`定时触发：${payload.schedule?.name || ''} → ${payload.template?.name || ''}`);
          await start(payload.prompt, {
            scheduled: true,
            scheduleId: payload.schedule?.id,
            templateId: payload.template?.id,
            storageDir: payload.storageDir,
            scheduleMode: payload.schedule?.mode
          });
          return;
        }
        if (payload.type === 'approval_badge' || payload.type === 'approval_queued') {
          if (payload.pendingCount != null) pendingCount = Number(payload.pendingCount) || 0;
          if (payload.type === 'approval_queued') {
            appendLog(`⏸ 等待审批：${payload.name}（${payload.reason || ''}）`);
            host.agentStatus = '等待审批';
            toast(`定时任务等待确认：${payload.name || ''}`, 'warn');
            panelTab = 'approvals';
          }
          refreshLists();
          return;
        }
        if (payload.type === 'approval_resolved') {
          if (payload.pendingCount != null) pendingCount = Number(payload.pendingCount) || 0;
          appendLog(`审批结果：${payload.answer}`);
          refreshLists();
          return;
        }
        if (payload.type === 'canvas_request') {
          try {
            const result = await deps.handleCanvasRequest?.(payload);
            await window.agentBridge.canvasResult({ jobId: payload.jobId, result });
          } catch (err) {
            await window.agentBridge.canvasResult({ jobId: payload.jobId, error: err?.message || String(err) });
          }
          return;
        }
        if (payload.type === 'emergency') {
          host.agentRunning = false;
          host.agentStatus = '紧急停止';
          appendLog(`⚠ ${payload.reason || '紧急停止'}（会话 ${payload.stopped || 0}，后台 ${payload.killedJobs || 0}）`);
          renderPanel();
          toast(payload.reason || '已紧急停止', 'warn');
          return;
        }
        if (payload.sessionId && (activeViewSessionId || host.agentSessionId) && payload.sessionId !== (activeViewSessionId || host.agentSessionId)) {
          if (payload.type === 'done' || payload.type === 'error' || payload.type === 'start') refreshLists();
          return;
        }
        if (['plan', 'model', 'tool', 'approval'].includes(payload.type)) deps.onAgentProgress?.(payload);
        if (payload.type === 'start') {
          host.agentRunning = true;
          host.agentStatus = payload.scheduled ? '定时运行中' : '运行中';
          planSteps = [];
          childRuns = new Map();
          lastPrompt = payload.prompt || lastPrompt;
          host.agentOutput = `${payload.resumedFrom != null ? `（从第 ${payload.resumedFrom} 步继续）\n` : ''}任务：${payload.prompt}\n工作区：${payload.workspace}\n模式：${payload.mode}${payload.scheduled ? '（定时）' : ''}\n步数上限：${payload.maxSteps}\n会话：${payload.sessionId || ''}\n\n`;
          refreshLists();
        } else if (payload.type === 'plan') {
          planSteps = Array.isArray(payload.steps) ? payload.steps : [];
          appendLog(`计划更新（${planSteps.length} 步）${payload.note ? ` · ${payload.note}` : ''}`);
        } else if (payload.type === 'subagent') {
          const known = childRuns.get(payload.childSessionId) || {};
          childRuns.set(payload.childSessionId, { ...known, ...payload, line: payload.line || (payload.status === 'progress' ? known.line : '') });
          if (payload.status !== 'progress') appendLog(`  ↳ 子任务 ${payload.index + 1}/${payload.total}「${payload.title}」${payload.status === 'running' ? '开始' : payload.status === 'reused' ? '沿用已完成结果' : `结束（${payload.status}）`}${payload.error ? ` · ${payload.error}` : ''}`);
        } else if (payload.type === 'compact') {
          appendLog(`上下文已压缩：${payload.before} → ${payload.after} 条消息`);
        } else if (payload.type === 'model' && payload.status === 'answered') {
          appendLog(`模型 #${payload.step}${payload.toolCalls?.length ? ` → ${payload.toolCalls.map(item => item.name).join(', ')}` : ''}${payload.content ? `\n${payload.content}` : ''}`);
        } else if (payload.type === 'approval') {
          appendLog(`等待批准：${payload.name}（${payload.reason}）`);
        } else if (payload.type === 'tool' && payload.status === 'output') {
          return;
        } else if (payload.type === 'tool') {
          const mark = payload.status === 'ok' ? '✓' : payload.status === 'denied' || payload.status === 'skipped' ? '✗' : payload.status === 'error' ? '!' : '…';
          appendLog(`${mark} ${payload.name}${payload.summary ? ` · ${payload.summary}` : ''}${payload.error ? ` · ${payload.error}` : ''}${payload.reason ? ` · ${payload.reason}` : ''}${payload.diff ? `\n${payload.diff}` : ''}`);
        } else if (payload.type === 'done' || payload.type === 'error') {
          host.agentRunning = false;
          host.agentStatus = payload.type === 'error' ? '失败' : payload.cancelled ? '已停止' : payload.truncated ? '达上限' : '完成';
          lastLogPath = payload.logPath || lastLogPath;
          if (payload.plan) planSteps = payload.plan;
          appendLog(payload.content || payload.error || '');
          if (payload.type === 'error' && payload.resumable) appendLog('进度已保存，可在“会话”中点“继续”接着做。');
          if (payload.tokens) appendLog(`用量：输入 ${payload.tokens.input} / 输出 ${payload.tokens.output}`);
          deps.onAgentFinished?.(payload);
          refreshLists();
        }
        renderPanel();
      });
    }

    async function start(promptText, extra = {}) {
      install();
      const current = settings();
      if (current.backend === 'codex' && !extra.scheduled) return deps.runCodex?.(promptText);
      // Callers (e.g. the 灵枢万象 chat) need to know whether a session actually started.
      const refuse = error => { toast(error, 'warn'); return { ok: false, error }; };
      if (!window.agentBridge?.start) return refuse('当前环境不支持内置智能体');
      const api = await deps.agentApiConfig?.();
      if (!api?.apiKey || !api?.baseUrl || !api?.model) return refuse('请先在设置中配置聊天供应商、模型和密钥');
      const running = (sessions || []).filter(item => !item.done).length;
      if (running >= current.maxConcurrent) return refuse(`已达并发上限（${current.maxConcurrent}），请先停止一个会话`);
      host.agentRunning = true;
      host.agentStatus = extra.scheduled ? '定时启动中' : '启动中';
      // New session gets a fresh log view; prior sessions stay listed under 会话.
      host.agentOutput = '';
      planSteps = [];
      childRuns = new Map();
      lastPrompt = String(promptText || '');
      renderPanel();
      try {
        const result = await window.agentBridge.start({
          prompt: promptText,
          workspace: current.workspace || host.storageDir,
          storageDir: extra.storageDir || storageDir() || host.storageDir,
          settings: { ...current, approvalTtlMs: current.approvalTtlHours * 60 * 60_000, maxConcurrent: current.maxConcurrent },
          maxSteps: current.maxSteps,
          fastModel: current.fastModel,
          maxConcurrent: current.maxConcurrent,
          approvalTtlMs: current.approvalTtlHours * 60 * 60_000,
          scheduled: !!extra.scheduled,
          scheduleId: extra.scheduleId || '',
          templateId: extra.templateId || '',
          scheduleMode: extra.scheduleMode || current.scheduleMode,
          resumeSessionId: extra.resumeSessionId || '',
          ...api
        });
        host.agentSessionId = result?.sessionId || '';
        activeViewSessionId = host.agentSessionId;
        await refreshLists();
        return { ok: !!host.agentSessionId, sessionId: host.agentSessionId };
      } catch (err) {
        host.agentRunning = (sessions || []).some(item => !item.done);
        host.agentStatus = '启动失败';
        appendLog(err?.message || String(err));
        renderPanel();
        toast(err?.message || String(err), 'error');
        return { ok: false, error: err?.message || String(err) };
      }
    }

    // Continues an interrupted/stopped session from its last snapshot.
    async function resume(sessionId) {
      const item = (sessions || []).find(entry => entry.sessionId === sessionId);
      panelTab = 'live';
      return await start(item?.prompt || '', { resumeSessionId: sessionId });
    }

    async function announceInterrupted() {
      try {
        const list = await window.agentBridge.listSessions?.() || [];
        const interrupted = list.filter(item => item.resumable && item.status === 'interrupted');
        if (interrupted.length) toast(`有 ${interrupted.length} 个智能体任务上次被中断，可在“会话”中点“继续”`, 'warn');
      } catch (_err) { /* list unavailable: nothing to announce */ }
    }

    async function stop() {
      if (host.agentSessionId) await window.agentBridge?.cancel?.(host.agentSessionId);
      host.agentRunning = false;
      host.agentStatus = '已停止';
      renderPanel();
    }

    async function emergency() {
      try {
        const result = await window.agentBridge?.emergencyStop?.();
        toast(`紧急停止：${result?.stopped || 0} 个会话`, 'warn');
      } catch (err) {
        toast(err?.message || String(err), 'error');
      }
      host.agentRunning = false;
      host.agentStatus = '紧急停止';
      renderPanel();
    }

    async function restore() {
      if (!lastLogPath) return;
      try {
        const result = await window.agentBridge.restore(lastLogPath);
        toast(`已恢复 ${result.restored.length} 个文件`, 'success');
        appendLog(`已恢复：\n${result.restored.join('\n')}`);
        renderPanel();
      } catch (err) {
        toast(err?.message || String(err), 'error');
      }
    }

    return { defaultSettings, settings, saveSettings, renderSettings, renderPanel, install, start, resume, stop, restore, emergency, refreshLists, detectParams };
  }

  window.FutureAIAgentUI = { create, defaultSettings, resolveBackend, MODE_OPTIONS, detectParams };
})();
