(function initBalanceChip(global) {
  'use strict';

  // Top-bar balance chip (replaces the old 已保存 chip). It owns no fetcher: every lookup goes
  // through provider-ui's refreshProviderBalance → main-process provider:balance, whose cache
  // (and key handling) is shared with the settings API list.
  // Generations are measured by balance-spend.js (snapshot at start, re-read after, "−$0.04"
  // flash under the chip). A generation it cannot measure (unsupported relay, failed lookup)
  // falls back to one fresh lookup — delayed so a batch finishing together costs one request,
  // and never more often than the minimum gap.
  const GENERATION_REFRESH_DELAY_MS = 4000;
  const FLASH_MS = 2000;
  const GENERATION_REFRESH_MIN_GAP_MS = 30000;

  function pickProvider(providers, {selectedId, defaultId, queryable, state}) {
    const usable = providers.filter(queryable);
    return usable.find(provider => provider.id === selectedId)
      || usable.find(provider => provider.id === defaultId)
      || usable.find(provider => state(provider.id)?.status === 'ok')
      || usable[0]
      || null;
  }

  // Compact chip text; the long wording (and 已用/总额/查询于) lives in the tooltip and popover.
  function chipText(state, format) {
    if (!state || state.status === 'loading') return {text: '…', tone: 'loading'};
    if (state.status === 'unsupported') return {text: '—', tone: 'muted'};
    if (state.status !== 'ok') return {text: '—', tone: 'warn'};
    if (state.unlimited) return {text: '无限', tone: 'ok'};
    const amount = state.remaining ?? state.total;
    if (amount === null || amount === undefined) return {text: '—', tone: 'muted'};
    return {text: format(amount, state.unit), tone: state.remaining !== null && state.remaining !== undefined && state.remaining <= 0 ? 'warn' : 'ok'};
  }

  function createBalanceChip(deps) {
    const {document, esc, getProviders, getDefaultProviderId, balance, onChange} = deps;
    const now = deps.now || Date.now;
    const schedule = deps.schedule || ((fn, ms) => setTimeout(fn, ms));
    const chip = document.getElementById('balanceChip');
    const valueEl = document.getElementById('balanceChipValue');
    const popover = document.getElementById('balancePopover');
    const flash = document.getElementById('balanceFlash');
    const Spend = deps.Spend || global.FutureAIBalanceSpend;
    let selectedId = '';
    let flashTimer = null;
    let generationTimer = null;
    let lastGenerationRefresh = -Infinity;
    const lowWarned = new Set();

    const providers = () => (getProviders() || []).filter(Boolean);
    const current = () => pickProvider(providers(), {selectedId, defaultId: getDefaultProviderId?.() || '', queryable: balance.queryable, state: balance.state});
    const isOpen = () => Boolean(popover && !popover.classList.contains('hidden'));

    function render() {
      if (!chip || !valueEl) return;
      const list = providers();
      chip.classList.toggle('hidden', !list.length);
      if (!list.length) {
        close();
        return;
      }
      const provider = current();
      if (!provider) {
        valueEl.textContent = '—';
        chip.dataset.tone = 'muted';
        chip.title = '还没有可查询余额的 API 服务：填写地址并保存 Key 后可查询';
      } else {
        const view = chipText(balance.state(provider.id), balance.format);
        const detail = balance.view(provider);
        valueEl.textContent = view.text;
        chip.dataset.tone = view.tone;
        chip.title = [`${provider.name || '当前服务'}：${detail.text}`, detail.title].filter(Boolean).join('\n');
      }
      markLowBalance(provider);
      chip.setAttribute('aria-label', `API 余额：${chip.title.split('\n')[0]}，点击选择显示的服务`);
      if (isOpen()) renderPopover();
    }

    // 余额提醒：低于「花费管理」里设定的值时顶栏变橙，每个服务每次启动只提醒一次。
    function markLowBalance(provider) {
      const low = Boolean(provider && deps.isLowBalance?.(balance.state(provider.id)));
      if (low) chip.dataset.low = '1';
      else delete chip.dataset.low;
      if (!low || lowWarned.has(provider.id)) return;
      lowWarned.add(provider.id);
      deps.onLowBalance?.(provider, balance.view(provider));
    }

    function resetLowBalanceWarnings() {
      lowWarned.clear();
      render();
    }

    function renderPopover() {
      const shown = current();
      const rows = providers().map(provider => {
        const view = balance.view(provider);
        const usable = balance.queryable(provider);
        const selected = shown?.id === provider.id;
        return `<button type="button" class="balance-popover-row ${selected ? 'selected' : ''}" data-balance-pick="${esc(provider.id)}" role="menuitemradio" aria-checked="${selected}" ${usable ? '' : 'disabled'} title="${esc(view.title)}">
          <i class="fa-solid fa-check balance-popover-check" aria-hidden="true"></i>
          <span class="balance-popover-name">${esc(provider.name || '未命名服务')}</span>
          <span class="balance-popover-value ${esc(view.tone)}">${esc(view.text)}</span>
        </button>`;
      }).join('');
      popover.innerHTML = `<div class="balance-popover-head"><span>选择顶栏显示的余额</span>
        <button type="button" class="balance-popover-refresh" data-balance-refresh title="刷新全部余额" aria-label="刷新全部余额"><i class="fa-solid fa-rotate" aria-hidden="true"></i></button></div>
        <div class="balance-popover-list" role="menu">${rows}</div>
        ${deps.onOpenSpend ? '<button type="button" class="balance-popover-foot" data-balance-spend><i class="fa-solid fa-wallet" aria-hidden="true"></i> 花费记录与预算</button>' : ''}`;
    }

    // The popover is body-level (the top bar's backdrop-filter and narrow-screen overflow would
    // clip or offset it), so it is placed under the chip each time it opens.
    function place() {
      const rect = chip.getBoundingClientRect();
      const viewport = document.documentElement.clientWidth || 0;
      popover.style.top = `${Math.round(rect.bottom + 6)}px`;
      popover.style.right = `${Math.max(8, Math.round(viewport - rect.right))}px`;
    }

    function open() {
      if (!popover || !chip || chip.classList.contains('hidden')) return;
      renderPopover();
      popover.classList.remove('hidden');
      chip.setAttribute('aria-expanded', 'true');
      place();
      refreshAll();
    }

    function close() {
      if (!isOpen()) return;
      popover.classList.add('hidden');
      chip?.setAttribute('aria-expanded', 'false');
    }

    function refresh({force = false} = {}) {
      const provider = current();
      return provider ? balance.refresh(provider, {force}) : Promise.resolve();
    }

    function refreshAll({force = false} = {}) {
      return Promise.all(providers().filter(balance.queryable).map(provider => balance.refresh(provider, {force})));
    }

    function select(id) {
      selectedId = String(id || '');
      onChange?.();
      close();
      render();
      return refresh();
    }

    const tracker = Spend?.createSpendTracker({
      fetchFresh: provider => balance.refresh(provider, {force: true, quiet: true}),
      state: balance.state,
      now,
      schedule,
      cancel: deps.cancel,
      onSpend: info => {
        deps.onSpend?.(info);
        return showSpend(info);
      },
      onSettled: ({providerIds}) => {
        // The measured provider's state is fresh now; the shown one (if different) reads the
        // main-process cache, which a shared relay account has just refreshed.
        const shown = current();
        if (shown && !providerIds.includes(shown.id)) balance.refresh(shown, {quiet: true});
        render();
      }
    }) || null;

    function sameAccount(a, b) {
      if (!a || !b) return false;
      if (a.id === b.id) return true;
      const accountA = balance.state(a.id)?.account;
      return Boolean(accountA && accountA === balance.state(b.id)?.account);
    }

    // Brief "−$0.04" under the chip: non-interactive (pointer-events: none) and gone in ~2s.
    function showSpend({amount, unit, provider} = {}) {
      const text = Spend?.formatSpend(amount, unit) || '';
      if (!text || !flash || !chip || chip.classList.contains('hidden')) return '';
      const rect = chip.getBoundingClientRect();
      if (!rect.width) return '';
      const shown = current();
      const label = !provider || sameAccount(shown, provider) ? text : `${text} · ${provider.name || '其他服务'}`;
      flash.textContent = label;
      flash.style.top = `${Math.round(rect.bottom + 4)}px`;
      flash.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
      flash.classList.remove('hidden', 'show');
      void flash.offsetWidth; // restart the animation when flashes come back to back
      flash.classList.add('show');
      if (flashTimer) (deps.cancel || clearTimeout)(flashTimer);
      flashTimer = schedule(() => {
        flashTimer = null;
        flash.classList.remove('show');
        flash.classList.add('hidden');
      }, FLASH_MS + 100);
      return label;
    }

    // Called when a generation is about to send its request; returns a ticket for finish.
    function noteGenerationStarted(provider) {
      if (!tracker || !provider || !balance.queryable(provider)) return null;
      return tracker.start(provider);
    }

    function noteGenerationFinished(ticket = null, result = {}) {
      if (!tracker || !ticket) return Promise.resolve(fallbackRefresh());
      return tracker.finish(ticket, {status: result?.status}).then(tracked => (tracked ? null : fallbackRefresh()));
    }

    function fallbackRefresh() {
      if (generationTimer) return;
      const wait = Math.max(GENERATION_REFRESH_DELAY_MS, lastGenerationRefresh + GENERATION_REFRESH_MIN_GAP_MS - now());
      generationTimer = schedule(() => {
        generationTimer = null;
        lastGenerationRefresh = now();
        refresh({force: true});
      }, wait);
    }

    function handlePopoverClick(event) {
      if (event.target.closest('[data-balance-refresh]')) return refreshAll({force: true});
      if (event.target.closest('[data-balance-spend]')) {
        close();
        return deps.onOpenSpend?.();
      }
      const pick = event.target.closest('[data-balance-pick]');
      if (pick && !pick.disabled) return select(pick.dataset.balancePick);
      return null;
    }

    function bind() {
      chip?.addEventListener('click', () => (isOpen() ? close() : open()));
      popover?.addEventListener('click', handlePopoverClick);
      document.addEventListener('pointerdown', event => {
        if (isOpen() && !popover.contains(event.target) && !chip.contains(event.target)) close();
      }, true);
      document.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || !isOpen()) return;
        event.preventDefault();
        event.stopPropagation();
        close();
        chip.focus();
      }, true);
      global.addEventListener?.('resize', close);
    }

    return {
      bind,
      load(id) { selectedId = String(id || ''); render(); },
      value: () => selectedId,
      render,
      refresh,
      open,
      close,
      isOpen,
      handlePopoverClick,
      resetLowBalanceWarnings,
      noteGenerationStarted,
      noteGenerationFinished,
      showSpend
    };
  }

  global.FutureAIBalanceChip = {createBalanceChip, pickProvider, chipText, FLASH_MS, GENERATION_REFRESH_DELAY_MS, GENERATION_REFRESH_MIN_GAP_MS};
})(typeof window !== 'undefined' ? window : globalThis);
