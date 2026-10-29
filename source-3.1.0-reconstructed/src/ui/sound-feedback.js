(function initUISoundFeedback(global) {
  'use strict';

  const PATTERNS = {
    hover: [
      {type: 'sine', from: 820, to: 1040, duration: .026, gain: .011}
    ],
    press: [
      {type: 'triangle', from: 310, to: 220, duration: .044, gain: .025},
      {type: 'sine', from: 760, to: 540, duration: .032, gain: .01}
    ],
    confirm: [
      {type: 'sine', from: 580, to: 860, duration: .06, gain: .018},
      {type: 'sine', from: 910, to: 1240, duration: .055, delay: .022, gain: .012}
    ],
    preview: [
      {type: 'sine', from: 440, to: 660, duration: .11, gain: .07},
      {type: 'sine', from: 660, to: 990, duration: .1, delay: .075, gain: .055}
    ],
    toggle: [
      {type: 'sine', from: 480, to: 720, duration: .052, gain: .018}
    ]
  };
  const INTERACTIVE_SELECTOR = 'button,[role="button"],a[href],select,summary,input[type="checkbox"],input[type="radio"],input[type="range"]';

  function clampVolume(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return .35;
    return Math.max(0, Math.min(1, number));
  }

  function createUISoundController(options = {}) {
    const host = options.window || global;
    let enabled = options.enabled !== false;
    let volume = clampVolume(options.volume ?? .35);
    let context = null;
    let attachedRoot = null;
    let lastHoverTarget = null;
    let lastPlayedAt = 0;
    let lastError = '';
    const listeners = [];

    async function ensureContext() {
      if (!enabled || volume <= 0) return null;
      const AudioContext = host.AudioContext || host.webkitAudioContext;
      if (!AudioContext) return null;
      if (context?.state === 'closed') context = null;
      if (!context) context = new AudioContext();
      if (context.state !== 'running') await context.resume();
      if (context.state !== 'running') throw new Error(`Audio context is ${context.state || 'unavailable'}`);
      return context;
    }

    function playVoice(audioContext, voice) {
      const start = audioContext.currentTime + Number(voice.delay || 0);
      const end = start + voice.duration;
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.type = voice.type || 'sine';
      oscillator.frequency.setValueAtTime(voice.from, start);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, voice.to), end);
      gainNode.gain.setValueAtTime(.0001, start);
      gainNode.gain.linearRampToValueAtTime(Math.max(.0001, voice.gain * volume), start + Math.min(.008, voice.duration * .25));
      gainNode.gain.exponentialRampToValueAtTime(.0001, end);
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.start(start);
      oscillator.stop(end + .01);
    }

    async function play(kind = 'press') {
      if (!enabled || volume <= 0) return false;
      try {
        const audioContext = await ensureContext();
        const pattern = PATTERNS[kind] || PATTERNS.press;
        if (!audioContext) return false;
        pattern.forEach(voice => playVoice(audioContext, voice));
        lastPlayedAt = Date.now();
        lastError = '';
        return true;
      } catch (error) {
        lastError = error?.message || String(error);
        return false;
      }
    }

    function interactiveTarget(event) {
      const target = event.target?.closest?.(INTERACTIVE_SELECTOR);
      if (!target || target.disabled || target.getAttribute?.('aria-disabled') === 'true') return null;
      if (target.closest?.('[data-ui-sound="off"]')) return null;
      return target;
    }

    function listen(root, eventName, handler, options) {
      root.addEventListener(eventName, handler, options);
      listeners.push(() => root.removeEventListener(eventName, handler, options));
    }

    function attach(root = host.document) {
      if (!root || attachedRoot === root) return;
      detach();
      attachedRoot = root;
      listen(root, 'pointerover', event => {
        const target = interactiveTarget(event);
        if (!target || target === lastHoverTarget) return;
        lastHoverTarget = target;
        play('hover');
      }, true);
      listen(root, 'pointerout', event => {
        if (event.target?.closest?.(INTERACTIVE_SELECTOR) === lastHoverTarget) lastHoverTarget = null;
      }, true);
      listen(root, 'pointerdown', event => {
        if (interactiveTarget(event)) play('press');
      }, true);
      listen(root, 'change', event => {
        const target = interactiveTarget(event);
        if (target?.matches?.('select,input[type="checkbox"],input[type="radio"]')) play('confirm');
      }, true);
    }

    function detach() {
      while (listeners.length) listeners.pop()();
      attachedRoot = null;
      lastHoverTarget = null;
    }

    function setEnabled(next) {
      enabled = Boolean(next);
      if (!enabled && context?.state === 'running') context.suspend?.().catch?.(() => {});
      return enabled;
    }

    function setVolume(next) {
      volume = clampVolume(next);
      return volume;
    }

    function getState() {
      return {
        enabled,
        volume,
        supported: Boolean(host.AudioContext || host.webkitAudioContext),
        contextState: context?.state || 'idle',
        lastPlayedAt,
        lastError
      };
    }

    function dispose() {
      detach();
      const closing = context?.close?.();
      context = null;
      return closing;
    }

    return {attach, detach, dispose, getState, play, setEnabled, setVolume};
  }

  global.FutureAIUISound = {clampVolume, createUISoundController};
})(typeof window !== 'undefined' ? window : globalThis);
