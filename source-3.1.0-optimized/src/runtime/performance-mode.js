(() => {
  'use strict';

  /**
   * Startup / motion performance helpers.
   * Home background video is deferred; optional reduce-motion mode for weak machines.
   */
  function create(deps = {}) {
    const $ = deps.$;
    const toast = deps.toast;
    const getReduceMotion = deps.getReduceMotion;
    const setReduceMotion = deps.setReduceMotion;
    const persistSettings = deps.persistSettings;

    function applyReduceMotionMode() {
      const enabled = Boolean(getReduceMotion());
      document.body.classList.toggle('reduce-motion', enabled);
      if ($('perfReduceMotion')) $('perfReduceMotion').checked = enabled;
      const video = $('homeBgVideo') || document.querySelector('.home-bg-video');
      if (!video) return;
      if (enabled) {
        video.pause?.();
        video.removeAttribute('src');
        video.removeAttribute('autoplay');
        try { video.load?.(); } catch {}
        delete video.dataset.started;
      }
    }

    function setReduceMotionMode(enabled, {persist = true, toastUser = false} = {}) {
      setReduceMotion(Boolean(enabled));
      try {
        localStorage.setItem('futureai.reduceMotion', getReduceMotion() ? 'on' : 'off');
      } catch {}
      applyReduceMotionMode();
      if (!getReduceMotion()) scheduleHomeBackgroundVideo();
      if (persist) persistSettings?.();
      if (toastUser) toast(getReduceMotion() ? '性能模式已开启' : '性能模式已关闭', getReduceMotion() ? 'success' : 'warn');
    }

    function scheduleHomeBackgroundVideo() {
      const video = $('homeBgVideo') || document.querySelector('.home-bg-video');
      if (!video) return;
      if (getReduceMotion()) {
        applyReduceMotionMode();
        return;
      }
      if (video.dataset.started === '1') return;
      const start = () => {
        if (getReduceMotion() || video.dataset.started === '1') return;
        video.pause?.();
        video.removeAttribute('src');
        video.removeAttribute('autoplay');
        try { video.load?.(); } catch {}
        video.dataset.started = '1';
      };
      const idle = window.requestIdleCallback
        ? cb => window.requestIdleCallback(cb, {timeout: 2800})
        : cb => setTimeout(cb, 1400);
      idle(start);
    }

    return {
      applyReduceMotionMode,
      setReduceMotionMode,
      scheduleHomeBackgroundVideo
    };
  }

  window.FutureAIPerformanceMode = { create };
})();
