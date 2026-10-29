(() => {
  'use strict';

  // 「花费管理」面板：真实扣费记录（来自余额变化）+ 预算上限 + 余额提醒 + 导出 CSV。
  function create(deps = {}) {
    const Core = () => deps.Core || window.FutureAISpendHistory;
    const $ = deps.$ || (id => document.getElementById(id));
    const esc = deps.esc || (value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch])));
    const toast = deps.toast || (() => {});
    const confirmModal = deps.confirm || (async () => window.confirm('确定？'));
    const getHistory = deps.getHistory || (() => []);
    const setHistory = deps.setHistory || (() => {});
    const getSettings = deps.getSettings || (() => ({}));
    const setSettings = deps.setSettings || (() => {});
    const getProject = deps.getProject || (() => ({id: '', name: ''}));
    const getEstimates = deps.getEstimates || (() => null);
    const budgetInputs = {currency: 'generationBudgetCurrency', single: 'generationSingleBudget', daily: 'generationDailyBudget', project: 'generationProjectBudget'};

    const modal = () => $('spendModal');
    const isOpen = () => Boolean(modal() && !modal().classList.contains('hidden'));

    function readBudget() {
      const value = id => Math.max(0, Number($(id)?.value || 0));
      return {
        currency: String($(budgetInputs.currency)?.value || 'USD').toUpperCase(),
        single: value(budgetInputs.single),
        daily: value(budgetInputs.daily),
        project: value(budgetInputs.project)
      };
    }

    // 面板里改预算 = 改设置里的同一个输入框，再触发它原本的保存逻辑，两边永远一致。
    function writeBudget(key, raw) {
      const input = $(budgetInputs[key]);
      if (!input) return;
      input.value = key === 'currency' ? String(raw || 'USD').toUpperCase() : String(Math.max(0, Math.round(Number(raw || 0) * 100) / 100));
      input.dispatchEvent(new Event('change', {bubbles: true}));
    }

    function statCard(label, totals, hint) {
      const core = Core();
      return `<div class="spend-stat"><span>${esc(label)}</span><strong>${esc(core.formatTotals(totals, readBudget().currency))}</strong>${hint ? `<small>${esc(hint)}</small>` : ''}</div>`;
    }

    function chartHtml(history) {
      const core = Core();
      const {unit, series, max} = core.dailySeries(history, {days: 14});
      const bars = series.map(item => {
        const height = max > 0 ? Math.max(item.amount > 0 ? 6 : 2, Math.round(item.amount / max * 100)) : 2;
        const title = `${item.day}：${core.formatAmount(item.amount, unit)}`;
        return `<div class="spend-bar" title="${esc(title)}"><i style="height:${height}%"></i><span>${esc(item.label.split('/')[1])}</span></div>`;
      }).join('');
      return `<div class="spend-chart" aria-label="最近 14 天每日花费（${esc(unit)}）">${bars}</div>`;
    }

    function meter(label, used, limit, currency) {
      const core = Core();
      if (!(limit > 0)) return `<div class="spend-meter off"><span>${esc(label)}</span><small>未设上限</small></div>`;
      const ratio = Math.min(1, used / limit);
      const tone = used >= limit ? 'over' : ratio >= 0.8 ? 'near' : 'ok';
      return `<div class="spend-meter ${tone}"><span>${esc(label)}</span><small>已预计 ${esc(core.formatAmount(used, currency))} / 上限 ${esc(core.formatAmount(limit, currency))}</small><b><i style="width:${Math.round(ratio * 100)}%"></i></b></div>`;
    }

    function listHtml(history) {
      const core = Core();
      const rows = [...history].reverse().slice(0, 60).map(item => `<li>
          <span class="spend-row-time">${esc(core.timeText(item.at))}</span>
          <span class="spend-row-what">${esc(item.projectName || '未命名项目')}<small>${esc(item.providerName || 'API 服务')}${item.tasks > 1 ? ` · ${item.tasks} 次生成` : ''}</small></span>
          <strong>−${esc(core.formatAmount(item.amount, item.unit))}</strong>
        </li>`).join('');
      return rows ? `<ul class="spend-list">${rows}</ul>` : '<p class="spend-empty">还没有扣费记录。生成图片或视频后，只要 API 服务支持余额查询，这里就会记下每次实际扣了多少钱。</p>';
    }

    function render() {
      const core = Core();
      const body = $('spendBody');
      if (!core || !body) return;
      const history = (getHistory() || []).filter(Boolean);
      const project = getProject() || {};
      const sum = core.summarize(history, {projectId: project.id || ''});
      const budget = readBudget();
      const estimates = getEstimates(budget.currency) || {daily: 0, project: 0};
      const settings = getSettings() || {};
      body.innerHTML = `
        <div class="spend-stats">
          ${statCard('今天', sum.today)}
          ${statCard('近 7 天', sum.week)}
          ${statCard('本月', sum.month)}
          ${statCard('当前项目', sum.project, project.name || '')}
        </div>
        <section class="spend-section">
          <h4>最近 14 天</h4>
          ${chartHtml(history)}
        </section>
        <section class="spend-section">
          <h4>预算上限<small>按生成前的预计费用计算，快超过时会先暂停并问你</small></h4>
          <div class="spend-budget-grid">
            <label>币种<select data-spend-budget="currency"><option value="USD">美元 USD</option><option value="CNY">人民币 CNY</option></select></label>
            <label>每天最多<input data-spend-budget="daily" type="number" min="0" step="0.5" value="${budget.daily}"></label>
            <label>本项目最多<input data-spend-budget="project" type="number" min="0" step="0.5" value="${budget.project}"></label>
            <label>单次最多<input data-spend-budget="single" type="number" min="0" step="0.1" value="${budget.single}"></label>
          </div>
          <div class="spend-meters">
            ${meter('今天', estimates.daily, budget.daily, budget.currency)}
            ${meter('本项目', estimates.project, budget.project, budget.currency)}
          </div>
          <p class="spend-note">填 0 表示不限制。</p>
        </section>
        <section class="spend-section">
          <h4>余额提醒</h4>
          <label class="spend-inline">顶栏余额低于<input data-spend-low type="number" min="0" step="1" value="${Number(settings.lowBalance || 0)}">时变橙色并提醒一次<small>填 0 关闭</small></label>
        </section>
        <section class="spend-section">
          <h4>扣费记录<small>共 ${sum.count} 条</small></h4>
          ${listHtml(history)}
        </section>`;
      const select = body.querySelector('[data-spend-budget="currency"]');
      if (select) select.value = budget.currency;
      $('spendFootNote').textContent = '金额来自 API 服务余额的实际变化；不支持余额查询的服务不会被记录。记录只保存在这台电脑上。';
    }

    function open() {
      const el = modal();
      if (!el) return;
      render();
      el.classList.remove('hidden');
      el.setAttribute('aria-hidden', 'false');
      deps.onOpen?.();
    }

    function close() {
      const el = modal();
      if (!el || !isOpen()) return;
      el.classList.add('hidden');
      el.setAttribute('aria-hidden', 'true');
    }

    async function exportCsv(opts = {}) {
      const core = Core();
      const history = getHistory() || [];
      if (!history.length) {
        toast('还没有扣费记录可以导出', 'warn');
        return null;
      }
      if (!deps.saveCsv) return null;
      try {
        const result = await deps.saveCsv({csv: core.toCsv(history), e2eTarget: opts.e2eTarget || ''});
        if (result?.path) toast(`已导出 ${history.length} 条记录`, 'success');
        return result;
      } catch (error) {
        toast(`导出失败：${error?.message || error}`, 'error');
        return null;
      }
    }

    async function clearHistory() {
      if (!(getHistory() || []).length) return false;
      const ok = await confirmModal();
      if (!ok) return false;
      setHistory([]);
      render();
      toast('扣费记录已清空', 'success');
      return true;
    }

    function bind() {
      const el = modal();
      if (!el || el.dataset.bound) return;
      el.dataset.bound = '1';
      $('closeSpend')?.addEventListener('click', close);
      $('spendExportCsv')?.addEventListener('click', () => exportCsv());
      $('spendClear')?.addEventListener('click', () => clearHistory());
      el.addEventListener('click', event => { if (event.target === el) close(); });
      el.addEventListener('change', event => {
        const budgetKey = event.target?.dataset?.spendBudget;
        if (budgetKey) {
          writeBudget(budgetKey, event.target.value);
          render();
          return;
        }
        if (event.target?.matches?.('[data-spend-low]')) {
          setSettings(Object.assign({}, getSettings(), {lowBalance: Math.max(0, Number(event.target.value || 0))}));
          deps.onLowBalanceChange?.();
        }
      });
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && isOpen()) {
          event.preventDefault();
          close();
        }
      }, true);
    }

    return {bind, open, close, isOpen, render, exportCsv, clearHistory};
  }

  window.FutureAISpendPanelUi = {create};
})();
