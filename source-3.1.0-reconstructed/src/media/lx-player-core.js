(() => {
  'use strict';

  // Playback architecture adapted from LX Music Desktop (Apache-2.0).
  // https://github.com/lyswhut/lx-music-desktop
  const STATE_KEY = 'futureai.lxPlayerState.v1';
  const MODES = ['listLoop', 'random', 'singleLoop', 'list'];

  function trackKey(track) {
    return String(track?.id || track?.url || '');
  }

  function safeTrack(track) {
    if (!track || !track.url || track.local || /^blob:/i.test(track.url)) return null;
    return {
      id: track.id || track.url,
      title: track.title || '',
      artist: track.artist || '',
      album: track.album || '',
      source: track.source || '',
      pageUrl: track.pageUrl || '',
      cover: track.cover || track.pic || '',
      lyric: track.lyric || '',
      url: track.url
    };
  }

  function create(options = {}) {
    const audio = options.audio;
    if (!audio) throw new Error('LX player requires an audio element');
    const storage = options.storage || window.localStorage;
    const state = {
      queue: [],
      current: null,
      mode: MODES.includes(options.mode) ? options.mode : 'listLoop',
      volume: Number.isFinite(options.volume) ? options.volume : 0.8,
      muted: false,
      history: [],
      historyIndex: -1,
      failed: new Set(),
      position: 0,
      duration: 0,
      playing: false
    };
    let retryKey = '';
    let waitingTimer = null;
    let persistTimer = null;
    let restorePosition = 0;
    const preloadAudio = new Audio();
    preloadAudio.preload = 'metadata';
    preloadAudio.muted = true;

    function emit(reason = 'state') {
      options.onStateChange?.(getState(), reason);
    }

    function getState() {
      return {
        queue: [...state.queue],
        current: state.current,
        mode: state.mode,
        volume: state.volume,
        muted: state.muted,
        position: state.position,
        duration: state.duration,
        playing: state.playing,
        failedKeys: [...state.failed]
      };
    }

    function persistSoon() {
      clearTimeout(persistTimer);
      persistTimer = setTimeout(persist, 300);
    }

    function persist() {
      const current = safeTrack(state.current);
      const queue = state.queue.map(safeTrack).filter(Boolean).slice(0, 500);
      try {
        storage.setItem(STATE_KEY, JSON.stringify({
          version: 1,
          current,
          queue,
          mode: state.mode,
          volume: state.volume,
          muted: state.muted,
          position: state.position,
          duration: state.duration
        }));
      } catch (_) {}
    }

    function restore() {
      let saved;
      try { saved = JSON.parse(storage.getItem(STATE_KEY) || 'null'); } catch (_) { saved = null; }
      if (!saved || saved.version !== 1) return getState();
      if (MODES.includes(saved.mode)) state.mode = saved.mode;
      if (Number.isFinite(saved.volume)) state.volume = Math.max(0, Math.min(1, saved.volume));
      state.muted = !!saved.muted;
      state.queue = Array.isArray(saved.queue) ? saved.queue.filter(track => track?.url) : [];
      state.current = saved.current?.url ? saved.current : null;
      restorePosition = Number.isFinite(saved.position) ? Math.max(0, saved.position) : 0;
      audio.volume = state.volume;
      audio.muted = state.muted;
      if (state.current) {
        audio.src = state.current.url;
        audio.preload = 'metadata';
        options.onTrackChange?.(state.current, {restored: true});
      }
      updateMediaSession();
      emit('restore');
      return getState();
    }

    function setQueue(queue = []) {
      const seen = new Set();
      state.queue = queue.filter(track => {
        const key = trackKey(track);
        if (!key || !track?.url || seen.has(key) || state.failed.has(key) || state.failed.has(track.url)) return false;
        seen.add(key);
        return true;
      });
      persistSoon();
      emit('queue');
      return [...state.queue];
    }

    function currentIndex() {
      const key = trackKey(state.current);
      return state.queue.findIndex(track => trackKey(track) === key || (track.url && track.url === state.current?.url));
    }

    function addHistory(track) {
      const key = trackKey(track);
      if (!key || state.history[state.history.length - 1] === key) return;
      state.history = [...state.history.slice(0, state.historyIndex + 1), key].slice(-200);
      state.historyIndex = state.history.length - 1;
    }

    async function play(track, playOptions = {}) {
      if (!track?.url) return false;
      const changed = trackKey(track) !== trackKey(state.current) || track.url !== state.current?.url;
      state.current = track;
      if (changed) {
        retryKey = '';
        addHistory(track);
        audio.src = track.url;
        restorePosition = Number.isFinite(playOptions.position) ? Math.max(0, playOptions.position) : 0;
        options.onTrackChange?.(track, {restored: false});
        updateMediaSession();
      }
      audio.volume = state.volume;
      audio.muted = state.muted;
      persistSoon();
      emit('track');
      if (playOptions.autoplay === false) return true;
      try {
        await audio.play();
        return true;
      } catch (error) {
        options.onPlayRejected?.(error, track);
        return false;
      }
    }

    async function toggle() {
      if (!audio.src && state.current?.url) audio.src = state.current.url;
      if (!audio.src) return false;
      if (audio.paused) return play(state.current || state.queue[0]);
      audio.pause();
      return true;
    }

    function randomTrack() {
      if (!state.queue.length) return null;
      const currentKey = trackKey(state.current);
      const played = new Set(state.history);
      let candidates = state.queue.filter(track => trackKey(track) !== currentKey && !played.has(trackKey(track)));
      if (!candidates.length) candidates = state.queue.filter(track => trackKey(track) !== currentKey);
      return candidates[Math.floor(Math.random() * candidates.length)] || state.queue[0];
    }

    function adjacent(direction, automatic = false) {
      if (!state.queue.length) return null;
      if (state.mode === 'random') {
        if (direction < 0 && state.historyIndex > 0) {
          state.historyIndex--;
          const key = state.history[state.historyIndex];
          return state.queue.find(track => trackKey(track) === key) || randomTrack();
        }
        return randomTrack();
      }
      const index = currentIndex();
      let nextIndex = index < 0 ? 0 : index + direction;
      if (nextIndex < 0) nextIndex = state.mode === 'listLoop' ? state.queue.length - 1 : 0;
      if (nextIndex >= state.queue.length) {
        if (state.mode === 'listLoop') nextIndex = 0;
        else if (automatic) return null;
        else nextIndex = state.queue.length - 1;
      }
      return state.queue[nextIndex] || null;
    }

    function next(automatic = false) {
      const track = adjacent(1, automatic);
      if (!track) {
        audio.pause();
        emit('queue-end');
        return false;
      }
      return play(track);
    }

    function previous() {
      if (audio.currentTime > 5) {
        audio.currentTime = 0;
        return true;
      }
      const track = adjacent(-1, false);
      return track ? play(track) : false;
    }

    function setMode(mode) {
      state.mode = MODES.includes(mode) ? mode : 'listLoop';
      persistSoon();
      emit('mode');
      return state.mode;
    }

    function cycleMode() {
      const index = MODES.indexOf(state.mode);
      return setMode(MODES[(index + 1) % MODES.length]);
    }

    function setVolume(value) {
      state.volume = Math.max(0, Math.min(1, Number(value) || 0));
      audio.volume = state.volume;
      persistSoon();
      emit('volume');
    }

    function seek(seconds) {
      if (!Number.isFinite(audio.duration)) return;
      audio.currentTime = Math.max(0, Math.min(audio.duration, Number(seconds) || 0));
    }

    function markFailed(track) {
      if (track?.id) state.failed.add(String(track.id));
      if (track?.url) state.failed.add(String(track.url));
      state.queue = state.queue.filter(item => !state.failed.has(trackKey(item)) && !state.failed.has(item.url));
    }

    function updateMediaSession() {
      if (!('mediaSession' in navigator)) return;
      const track = state.current;
      navigator.mediaSession.metadata = track ? new MediaMetadata({
        title: track.title || 'Music',
        artist: track.artist || '',
        album: track.album || track.source || '',
        artwork: (track.cover || track.pic) ? [{src: track.cover || track.pic}] : []
      }) : null;
    }

    function registerMediaSession() {
      if (!('mediaSession' in navigator)) return;
      const actions = {
        play: () => play(state.current || state.queue[0]),
        pause: () => audio.pause(),
        stop: () => { audio.pause(); audio.currentTime = 0; },
        previoustrack: previous,
        nexttrack: () => next(false),
        seekbackward: details => seek(audio.currentTime - (details.seekOffset || 5)),
        seekforward: details => seek(audio.currentTime + (details.seekOffset || 5)),
        seekto: details => seek(details.seekTime || 0)
      };
      Object.entries(actions).forEach(([name, handler]) => {
        try { navigator.mediaSession.setActionHandler(name, handler); } catch (_) {}
      });
    }

    function clearWaitingTimer() {
      clearTimeout(waitingTimer);
      waitingTimer = null;
    }

    audio.addEventListener('loadedmetadata', () => {
      state.duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      if (restorePosition > 0 && state.duration > 0) {
        audio.currentTime = Math.min(restorePosition, Math.max(0, state.duration - 1));
        restorePosition = 0;
      }
      emit('metadata');
    });
    audio.addEventListener('play', () => { state.playing = true; clearWaitingTimer(); emit('play'); });
    audio.addEventListener('pause', () => { state.playing = false; clearWaitingTimer(); persistSoon(); emit('pause'); });
    audio.addEventListener('playing', clearWaitingTimer);
    audio.addEventListener('waiting', () => {
      clearWaitingTimer();
      waitingTimer = setTimeout(() => {
        options.onBufferTimeout?.(state.current);
        markFailed(state.current);
        next(true);
      }, 12000);
    });
    audio.addEventListener('timeupdate', () => {
      state.position = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      state.duration = Number.isFinite(audio.duration) ? audio.duration : state.duration;
      if (state.duration > 10 && state.duration - state.position < 10) {
        const upcoming = adjacent(1, true);
        if (upcoming?.url && preloadAudio.src !== upcoming.url) preloadAudio.src = upcoming.url;
      }
      if (Math.floor(state.position) % 2 === 0) persistSoon();
      if ('mediaSession' in navigator && state.duration > 0) {
        try { navigator.mediaSession.setPositionState({duration: state.duration, playbackRate: audio.playbackRate || 1, position: Math.min(state.position, state.duration)}); } catch (_) {}
      }
      emit('progress');
    });
    audio.addEventListener('ended', () => {
      if (state.mode === 'singleLoop') {
        audio.currentTime = 0;
        audio.play().catch(() => next(true));
      } else next(true);
    });
    audio.addEventListener('error', () => {
      if (!state.current) return;
      const key = trackKey(state.current);
      if (retryKey !== key) {
        retryKey = key;
        const position = state.position;
        audio.src = state.current.url;
        restorePosition = position;
        audio.play().catch(() => {});
        return;
      }
      markFailed(state.current);
      options.onTrackError?.(state.current, getState());
      setTimeout(() => next(true), 450);
    });

    registerMediaSession();
    audio.volume = state.volume;
    return {restore, getState, setQueue, play, toggle, next, previous, setMode, cycleMode, setVolume, seek, persist};
  }

  window.FutureAILXPlayerCore = {create, modes: [...MODES], stateKey: STATE_KEY};
})();
