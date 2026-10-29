// Single source of truth for the user's Codex CLI in the renderer.
// The main process does the actual detection (saved custom path first, then PATH and the
// known install locations incl. <CODEX_HOME>/.sandbox-bin); this module holds the one result,
// dedupes concurrent checks and tells every subscriber (settings, agent backend, console) when it changes.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FutureAICodexState = api;
})(typeof window !== 'undefined' ? window : null, () => {
  'use strict';

  function create({ bridge = null } = {}) {
    let cli = null; // null = not checked yet / checking
    let checking = null;
    let detected = false; // at least one detection has finished
    const listeners = new Set();

    function emit() {
      for (const fn of listeners) {
        try { fn(cli); } catch (err) { console.error('[codex-state] listener failed', err); }
      }
    }

    function set(next) {
      cli = next || null;
      if (cli) detected = true;
      emit();
      return cli;
    }

    function refresh({ force = false } = {}) {
      if (!bridge?.status) return Promise.resolve(set({ ok: false, error: 'Codex 检测不可用' }));
      if (checking && !force) return checking;
      cli = null;
      emit();
      const run = Promise.resolve()
        .then(() => bridge.status({ force }))
        .catch(err => ({ ok: false, error: err?.message || String(err) }))
        .then(result => {
          if (checking === run) checking = null;
          return set(result || { ok: false, error: '' });
        });
      checking = run;
      return run;
    }

    // Returns the picked result (or null when cancelled); a valid pick becomes the shared state.
    async function choose() {
      if (!bridge?.chooseCommand) return null;
      const picked = await bridge.chooseCommand();
      if (picked?.ok) {
        checking = null;
        set(picked);
      }
      return picked || null;
    }

    function subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }

    return {
      get cli() { return cli; },
      // 'checking' until the first detection finishes, then 'ready' / 'missing'.
      get status() { return cli ? (cli.ok ? 'ready' : 'missing') : 'checking'; },
      get detected() { return detected; },
      set,
      refresh,
      choose,
      subscribe
    };
  }

  return { create };
});
