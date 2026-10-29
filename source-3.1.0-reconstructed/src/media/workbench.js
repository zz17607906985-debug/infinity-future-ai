(() => {
  'use strict';

  /**
   * Media center workbench: music/radio/TV player, history drawer, asset library UI.
   */
  function create(deps = {}) {
    const host = deps.host || {};
    const $ = deps.$;
    const esc = deps.esc;
    const safeMediaUrl = deps.safeMediaUrl || (value => window.FutureAIMediaUtils?.safeMediaUrl?.(value) || '');
    const toast = deps.toast;
    const wait = deps.wait;
    const fetchJsonWithRetry = deps.fetchJsonWithRetry;
    const API_TIMEOUTS = deps.API_TIMEOUTS;
    const saveSettings = deps.saveSettings;
    const getStore = deps.getStore;
    const setStore = deps.setStore;
    const unique = deps.unique;
    const openModal = deps.openModal;
    const persistMediaUrl = deps.persistMediaUrl;
    const mediaExtFromMime = deps.mediaExtFromMime;
    const isVideoMedia = deps.isVideoMedia;
    const isSupportedUploadFile = deps.isSupportedUploadFile;
    const fileToDataUrl = deps.fileToDataUrl;
    const ensureVendor = deps.ensureVendor;
    const MediaLibraryRendering = deps.MediaLibraryRendering || window.FutureAIMediaLibraryRendering;
    const MediaUtils = deps.MediaUtils || window.FutureAIMediaUtils;
    const HistoryApi = deps.HistoryApi || window.FutureAICanvasHistory;
    const LXCoreFactory = deps.LXCoreFactory || window.FutureAILXPlayerCore;
    const SmartIndex = deps.SmartIndex || window.FutureAIAssetSmartIndex;
    const STORE = deps.STORE;
    const compactHistoryItem = deps.compactHistoryItem;
    const renderVideoResults = deps.renderVideoResults;
    const searchFreeVideos = deps.searchFreeVideos;
    const viewCenter = deps.viewCenter;
    const addNode = deps.addNode;
    const selectSingleNode = deps.selectSingleNode;
    const closeHistory = deps.closeHistory;
    const fitNodeIntoView = deps.fitNodeIntoView;
    const saveProject = deps.saveProject;
    const openImageModal = deps.openImageModal;
    const dropAssetOnCanvas = deps.dropAssetOnCanvas;
    const sendAssetToAssistant = deps.sendAssetToAssistant;
    const sendAssetToShortWorkbench = deps.sendAssetToShortWorkbench;
    const getAssetReferences = deps.getAssetReferences || (() => []);
    const scopedHistoryItems = HistoryApi?.scopedHistoryItems || ((history, projectId) => history || []);
    const historyCardsHtml = HistoryApi?.historyCardsHtml || (() => '');
    const historyRestoreUrls = HistoryApi?.historyRestoreUrls || (item => item?.url ? [item.url] : []);
    // currentProjectId is read from host when needed

function setMediaMode(mode = 'music') {
  host.mediaMode = ['music', 'video', 'tv'].includes(mode) ? mode : 'music';
  document.querySelectorAll('[data-media-mode]').forEach(btn => btn.classList.toggle('active', btn.dataset.mediaMode === host.mediaMode));
  $('musicRadioBtn')?.classList.toggle('hidden', host.mediaMode !== 'music');
  $('musicSearchBtn')?.classList.toggle('hidden', host.mediaMode !== 'music');
  $('musicSearchInput')?.closest('.music-search-row')?.classList.toggle('hidden', host.mediaMode !== 'music');
  $('musicWorkbench')?.querySelector('.music-layout')?.classList.toggle('hidden', host.mediaMode !== 'music');
  $('musicWorkbench')?.querySelector('.music-player')?.classList.toggle('hidden', host.mediaMode !== 'music');
  $('videoWorkbenchPanel')?.classList.toggle('hidden', host.mediaMode !== 'video');
  $('tvWorkbenchPanel')?.classList.toggle('hidden', host.mediaMode !== 'tv');
  if (host.mediaMode === 'video') renderVideoResults();
  if (host.mediaMode === 'video' && !host.mediaVideoResults.length && host.activeWorkspace === 'music') searchFreeVideos();
  if (host.mediaMode === 'tv') renderTvChannels();
  if (host.mediaMode === 'music' && host.activeWorkspace === 'music') scheduleAutoMusicSearch(250);
}

function stopOtherMedia(kind) {
  if (kind !== 'music') $('musicAudio')?.pause();
  if (kind !== 'video') $('mediaVideoPlayer')?.pause();
  if (kind !== 'tv') $('mediaTvPlayer')?.pause();
}

function playLocalVideoFile(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  playMediaUrl('video', url, file.name || '本地视频');
}

async function playMediaUrl(kind, url, title = '') {
  const cleanUrl = String(url || '').trim();
  if (!cleanUrl) return toast('请先输入可播放地址', 'warn');
  const player = kind === 'tv' ? $('mediaTvPlayer') : $('mediaVideoPlayer');
  if (!player) return;
  stopOtherMedia(kind);
  const hlsKey = kind === 'tv' ? 'host.mediaTvHls' : 'host.mediaVideoHls';
  if (kind === 'tv' && host.mediaTvHls) { host.mediaTvHls.destroy(); host.mediaTvHls = null; }
  if (kind === 'video' && host.mediaVideoHls) { host.mediaVideoHls.destroy(); host.mediaVideoHls = null; }
  const wantsHls = /\.m3u8(\?|$)/i.test(cleanUrl);
  if (wantsHls) {
    const ok = await ensureVendor('hls', '流媒体播放组件');
    if (!ok) return;
  }
  if (wantsHls && window.Hls?.isSupported()) {
    const hls = new window.Hls({ lowLatencyMode: true });
    hls.loadSource(cleanUrl);
    hls.attachMedia(player);
    if (hlsKey === 'host.mediaTvHls') host.mediaTvHls = hls; else host.mediaVideoHls = hls;
  } else {
    player.src = cleanUrl;
  }
  player.play().catch(() => toast(`${title || '媒体'} 已加载，请点击播放器播放`, 'warn'));
}

function renderTvChannels() {
  if (!$('mediaTvList')) return;
  $('mediaTvList').innerHTML = host.MEDIA_TV_CHANNELS.map(channel => `<article class="music-track" data-tv-id="${esc(channel.id)}"><button class="music-track-play" type="button"><i class="fa-solid fa-tv"></i></button><div><strong>${esc(channel.name)}</strong><span>${esc(channel.group)} · 公开直播源</span><small>${esc(channel.url)}</small></div><button class="icon-btn" type="button" title="播放"><i class="fa-solid fa-play"></i></button><button class="icon-btn" type="button" title="打开"><i class="fa-solid fa-arrow-up-right-from-square"></i></button></article>`).join('');
}

function musicTrackById(id) {
  return [...host.musicLocalTracks, ...host.musicResults, ...host.musicFavorites].find(track => track.id === id) || null;
}
function isMusicFavorite(track) {
  return !!track && host.musicFavorites.some(item => item.id === track.id || item.url === track.url);
}
function saveMusicFavorites() {
  setStore('host.musicFavorites', host.musicFavorites.slice(0, 200));
}

function importLocalMusicFiles(files) {
  const audioFiles = Array.from(files || []).filter(file => file?.type?.startsWith('audio/') || /\.(mp3|wav|flac|m4a|aac|ogg|opus)$/i.test(file?.name || ''));
  if (!audioFiles.length) return toast('\u8bf7\u9009\u62e9\u97f3\u9891\u6587\u4ef6', 'warn');
  const imported = audioFiles.map(file => {
    const title = (file.name || '\u672c\u5730\u97f3\u4e50').replace(/\.[^.]+$/, '');
    return {
      id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title,
      artist: '\u672c\u5730\u97f3\u4e50',
      source: '\u672c\u5730\u6587\u4ef6',
      license: '\u672c\u5730\u5bfc\u5165',
      url: URL.createObjectURL(file),
      pageUrl: '',
      local: true
    };
  });
  host.musicLocalTracks = [...imported, ...host.musicLocalTracks].slice(0, 300);
  host.musicStatus = `\u5df2\u5bfc\u5165 ${imported.length} \u9996\u672c\u5730\u97f3\u4e50`;
  if (!host.musicCurrentTrack) playMusicTrack(imported[0]); else renderMusicPlayer();
}

function musicPlayableQueue() {
  const seen = new Set();
  return [...host.musicLocalTracks, ...host.musicResults, ...host.musicFavorites].filter(track => {
    const key = track?.url || track?.id;
    if (!track?.url || !key || seen.has(key) || host.musicUnavailableTrackIds.has(track.id) || host.musicUnavailableTrackIds.has(track.url)) return false;
    seen.add(key);
    return true;
  });
}

function musicQueueIndex(queue = musicPlayableQueue()) {
  if (!host.musicCurrentTrack) return -1;
  return queue.findIndex(track => track.id === host.musicCurrentTrack.id || track.url === host.musicCurrentTrack.url);
}

function formatMusicTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = String(total % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

function initLXMusicCore() {
  if (host.musicLXCore || !window.FutureAILXPlayerCore || !$('musicAudio')) return host.musicLXCore;
  const initialMode = host.musicShuffleEnabled ? 'random'
    : host.musicRepeatMode === 'one' ? 'singleLoop'
      : host.musicRepeatMode === 'all' ? 'listLoop'
        : 'list';
  host.musicLXCore = window.FutureAILXPlayerCore.create({
    audio: $('musicAudio'),
    storage: localStorage,
    mode: initialMode,
    volume: host.musicPlayerVolume,
    onTrackChange(track) {
      host.musicCurrentTrack = track;
      renderMusicPlayer();
    },
    onStateChange(state, reason) {
      host.musicCurrentTrack = state.current || host.musicCurrentTrack;
      host.musicCurrentTime = state.position || 0;
      host.musicDuration = state.duration || 0;
      host.musicPlayerVolume = state.volume;
      host.musicShuffleEnabled = state.mode === 'random';
      host.musicRepeatMode = state.mode === 'singleLoop' ? 'one' : state.mode === 'listLoop' ? 'all' : 'off';
      if (reason !== 'progress') renderMusicTransport();
    },
    onTrackError(track) {
      handleMusicPlaybackError(track);
    },
    onBufferTimeout(track) {
      host.musicStatus = `“${track?.title || '当前音源'}”缓冲超时，正在尝试下一首`;
      renderMusicPlayer();
    },
    onPlayRejected() {
      toast('浏览器阻止了自动播放，请点播放按钮', 'warn');
    }
  });
  const restored = host.musicLXCore.restore();
  if (restored.current?.url) {
    host.musicCurrentTrack = restored.current;
    host.musicResults = [restored.current, ...restored.queue.filter(track => track.id !== restored.current.id)];
    host.musicStatus = '已恢复上次播放队列';
  }
  return host.musicLXCore;
}

function syncLXMusicQueue() {
  const core = initLXMusicCore();
  core?.setQueue(musicPlayableQueue());
  return core;
}

function applyMusicVolume() {
  const audio = $('musicAudio');
  if (!audio) return;
  const nextVolume = Number.isFinite(host.musicPlayerVolume) ? Math.max(0, Math.min(1, host.musicPlayerVolume)) : 0.8;
  audio.volume = nextVolume;
}

async function loadMusicPluginRegistry() {
  const fallbackPlugins = [
    { id: 'audius', name: 'Audius', source: 'Audius Open Streaming', description: '开放音乐曲库', loginRequired: false, enabled: true },
    { id: 'ccmixter', name: 'ccMixter', source: 'Open Music Remix Library', description: '独立音乐与混音曲库', loginRequired: false, enabled: true },
    { id: 'archive', name: 'Internet Archive Audio', source: 'Internet Archive', description: '音频档案与音乐收藏', loginRequired: false, enabled: true },
    { id: 'wikimedia', name: 'Wikimedia Commons', source: 'Wikimedia Commons', description: '自由授权音频资料库', loginRequired: false, enabled: true },
    { id: 'radio', name: 'Radio Browser', source: 'radio-browser.info', description: '网络电台目录', loginRequired: false, enabled: true }
  ];
  try {
    const result = await window.musicBridge?.registry?.() || await window.musicBridge?.plugins?.();
    host.musicSourcePluginRegistry = result?.protocol ? result : null;
    host.musicSourcePlugins = Array.isArray(result?.plugins) && result.plugins.length ? result.plugins : fallbackPlugins;
  } catch {
    host.musicSourcePlugins = fallbackPlugins;
  }
  const saved = getStore('musicSourcePluginState', null);
  host.enabledMusicSourceIds = Array.isArray(saved)
    ? saved.filter(id => host.musicSourcePlugins.some(plugin => plugin.id === id))
    : host.musicSourcePlugins.filter(plugin => plugin.enabled !== false).map(plugin => plugin.id);
  const pluginVersion = Number(getStore('musicSourcePluginVersion', 0));
  if (pluginVersion < 8) {
    const required = ['wikimedia', 'audius', 'ccmixter', 'archive', 'radio'].filter(id => host.musicSourcePlugins.some(plugin => plugin.id === id));
    host.enabledMusicSourceIds = [...new Set([...host.enabledMusicSourceIds, ...required])];
    setStore('musicSourcePluginVersion', 8);
    saveMusicPluginState();
  }
  if (!Array.isArray(saved) && !host.enabledMusicSourceIds.length) host.enabledMusicSourceIds = host.musicSourcePlugins.filter(plugin => plugin.enabled !== false).map(plugin => plugin.id);
}

function saveMusicPluginState() {
  setStore('musicSourcePluginState', host.enabledMusicSourceIds);
}

function onMusicPluginToggle(e) {
  const input = e.target.closest('[data-music-plugin]');
  if (!input) return;
  const id = input.dataset.musicPlugin;
  if (input.checked) {
    host.enabledMusicSourceIds = [...new Set([...host.enabledMusicSourceIds, id])];
  } else {
    host.enabledMusicSourceIds = host.enabledMusicSourceIds.filter(item => item !== id);
  }
  saveMusicPluginState();
  renderMusicPlugins();
  scheduleAutoMusicSearch(200, true);
}

function renderMusicPlugins() {
  const el = $('musicPluginList');
  if (!el) return;
  el.innerHTML = host.musicSourcePlugins.map(plugin => {
    const checked = host.enabledMusicSourceIds.includes(plugin.id);
    return `<label class="music-plugin-card"><input type="checkbox" data-music-plugin="${esc(plugin.id)}" ${checked ? 'checked' : ''}><span><strong>${esc(plugin.name || plugin.id)}</strong><small>${esc(plugin.source || plugin.capability || 'open source')}</small><em>${esc(plugin.description || '')}</em></span></label>`;
  }).join('') || '<div class="music-empty">没有可用音乐插件</div>';
}

async function searchOpenRadio() {
  if (!window.mediaBridge?.searchRadio) return toast('当前环境不支持开源电台搜索', 'warn');
  host.musicSearchQuery = $('musicSearchInput')?.value.trim() || host.musicSearchQuery || 'lofi';
  host.musicStatus = '正在搜索开源电台...';
  renderMusicPlayer();
  try {
    const result = await window.mediaBridge.searchRadio({ query: host.musicSearchQuery, sourceIds: host.enabledMusicSourceIds });
    host.musicResults = Array.isArray(result?.tracks) ? result.tracks : [];
    host.musicStatus = host.musicResults.length ? `找到 ${host.musicResults.length} 个 · ${result.source || '开源电台'}` : '没有找到电台，换个关键词试试';
  } catch (err) {
    host.musicStatus = '电台搜索失败';
    toast('开源电台搜索失败：\n' + (err.message || err), 'warn');
  }
  renderMusicPlayer();
}

function scheduleAutoMusicSearch(delay = 700, fromInput = false) {
  clearTimeout(host.musicAutoSearchTimer);
  if (host.activeWorkspace !== 'music' || host.mediaMode !== 'music') return;
  const query = $('musicSearchInput')?.value.trim() || host.musicSearchQuery || '电影感';
  if (!query) return;
  const sourceKey = host.enabledMusicSourceIds.slice().sort().join(',');
  const autoKey = `${query}::${sourceKey}`;
  if (!fromInput && host.musicResults.length && host.musicLastAutoSearchKey === autoKey) return;
  host.musicAutoSearchTimer = setTimeout(() => {
    searchFreeMusic({ auto: true, query });
  }, delay);
}

async function searchFreeMusic(options = {}) {
  if (!window.musicBridge?.search) return toast('当前环境不支持音乐搜索', 'warn');
  const nextQuery = String(options.query || $('musicSearchInput')?.value.trim() || host.musicSearchQuery || '电影感').trim();
  if (!nextQuery) return;
  const sourceKey = host.enabledMusicSourceIds.slice().sort().join(',');
  const autoKey = `${nextQuery}::${sourceKey}`;
  if (options.auto && host.musicLastAutoSearchKey === autoKey && host.musicResults.length) return;
  host.musicSearchQuery = nextQuery;
  host.musicUnavailableTrackIds = new Set();
  host.musicLastAutoSearchKey = autoKey;
  const requestId = ++host.musicSearchRequestSeq;
  host.musicStatus = options.auto ? `正在搜索：${host.musicSearchQuery}` : '正在搜索音乐...';
  renderMusicPlayer();
  try {
    const result = await window.musicBridge.search({ query: host.musicSearchQuery, sourceIds: host.enabledMusicSourceIds });
    if (requestId !== host.musicSearchRequestSeq) return;
    host.musicResults = Array.isArray(result?.tracks) ? result.tracks : [];
    const failedSources = Array.isArray(result?.diagnostics) ? result.diagnostics.filter(item => item.status === 'rejected').length : 0;
    host.musicStatus = host.musicResults.length
      ? `找到 ${host.musicResults.length} 首可免费播放 · ${result.source || '公开音乐库'}${failedSources ? ` · ${failedSources} 个源暂不可用` : ''}`
      : result?.strictLiteralSearch
        ? `没有找到“${host.musicSearchQuery}”的免费歌曲`
        : '没有找到可免费播放的歌曲，换个歌名、歌手或曲风试试';
    if (!options.auto && host.musicResults.length) {
      const first = host.musicResults.find(track => track.url);
      if (first) playMusicTrack(first);
    }
  } catch (err) {
    if (requestId !== host.musicSearchRequestSeq) return;
    host.musicStatus = '搜索失败';
    if (!options.auto) toast('音乐搜索失败：\n' + (err.message || err), 'warn');
  }
  renderMusicPlayer();
}
async function playMusicTrack(track) {
  if (!track?.url) return openMusicSource(track);
  const manifest = host.musicSourcePlugins.find(plugin => plugin.id === track.sourceId)?.manifest;
  if (manifest && !manifest.actions?.includes('getMediaSource')) return toast('此音乐来源未提供播放地址', 'warn');
  let playableTrack = track;
  if (!track.local) {
    try {
      const resolved = await window.musicBridge?.resolveTrack?.({ track });
      if (!resolved?.url) throw new Error('音乐来源没有返回播放地址');
      playableTrack = { ...track, url: resolved.url, rights: resolved.rights || track.rights };
    } catch (err) {
      host.musicUnavailableTrackIds.add(track.id || track.url);
      renderMusicPlayer();
      return toast(err?.message || '音乐播放授权已失效，请重新搜索', 'warn');
    }
  }
  host.musicCurrentTrack = playableTrack;
  const core = syncLXMusicQueue();
  if (core) core.play(playableTrack);
  else {
    const audio = $('musicAudio');
    if (audio) { audio.src = playableTrack.url; applyMusicVolume(); audio.play().catch(() => toast('播放失败，请换一首', 'warn')); }
  }
  renderMusicPlayer();
}
function toggleMusicPlayback() {
  const core = syncLXMusicQueue();
  if (core) {
    if (!host.musicCurrentTrack && musicPlayableQueue()[0]) host.musicCurrentTrack = musicPlayableQueue()[0];
    core.toggle();
    return;
  }
  const audio = $('musicAudio');
  if (!audio?.src && host.musicCurrentTrack?.url) audio.src = host.musicCurrentTrack.url;
  if (!audio?.src) return toast('请先选择一首音乐', 'warn');
  applyMusicVolume();
  if (audio.paused) audio.play().catch(() => toast('播放失败，请换一首', 'warn')); else audio.pause();
}
function playAdjacentMusic(direction = 1, fromEnded = false) {
  const core = syncLXMusicQueue();
  if (core) {
    if (direction < 0) core.previous();
    else core.next(!!fromEnded);
    return;
  }
  const queue = musicPlayableQueue();
  if (!queue.length) return toast('当前没有可播放队列', 'warn');
  const currentIndex = musicQueueIndex(queue);
  let nextIndex = currentIndex;
  if (host.musicShuffleEnabled && queue.length > 1) {
    while (nextIndex === currentIndex) nextIndex = Math.floor(Math.random() * queue.length);
  } else {
    nextIndex = currentIndex < 0 ? 0 : currentIndex + direction;
    if (nextIndex < 0) nextIndex = host.musicRepeatMode === 'all' ? queue.length - 1 : 0;
    if (nextIndex >= queue.length) {
      if (host.musicRepeatMode === 'all') nextIndex = 0;
      else if (fromEnded) return renderMusicPlayer();
      else nextIndex = queue.length - 1;
    }
  }
  playMusicTrack(queue[nextIndex]);
}
function handleMusicEnded() {
  const audio = $('musicAudio');
  if (host.musicRepeatMode === 'one' && audio) {
    audio.currentTime = 0;
    audio.play().catch(() => renderMusicPlayer());
    return;
  }
  playAdjacentMusic(1, true);
}

function handleMusicPlaybackError(failed = host.musicCurrentTrack) {
  if (!failed) return;
  if (failed.id) host.musicUnavailableTrackIds.add(failed.id);
  if (failed.url) host.musicUnavailableTrackIds.add(failed.url);
  host.musicStatus = `“${failed.title || '当前音源'}”暂时无法播放，正在尝试下一条`;
  renderMusicPlayer();
  if (!musicPlayableQueue().length) toast('当前搜索结果的直连音源均不可用，请重新搜索或打开来源页', 'warn');
}
function updateMusicProgress() {
  const audio = $('musicAudio');
  if (!audio) return;
  host.musicCurrentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  host.musicDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
  renderMusicTransport();
}
function seekMusicPlayback(e) {
  const audio = $('musicAudio');
  if (!audio || !host.musicDuration) return;
  const ratio = Number(e.target.value || 0) / 1000;
  const seconds = Math.max(0, Math.min(host.musicDuration, ratio * host.musicDuration));
  if (host.musicLXCore) host.musicLXCore.seek(seconds); else audio.currentTime = seconds;
}
function changeMusicVolume(e) {
  host.musicPlayerVolume = Math.max(0, Math.min(1, Number(e.target.value || 0) / 100));
  localStorage.setItem('futureai.musicVolume', String(host.musicPlayerVolume));
  if (host.musicLXCore) host.musicLXCore.setVolume(host.musicPlayerVolume); else applyMusicVolume();
  renderMusicTransport();
}
function toggleMusicShuffle() {
  const core = syncLXMusicQueue();
  host.musicShuffleEnabled = !host.musicShuffleEnabled;
  if (core) core.setMode(host.musicShuffleEnabled ? 'random' : (host.musicRepeatMode === 'one' ? 'singleLoop' : host.musicRepeatMode === 'all' ? 'listLoop' : 'list'));
  localStorage.setItem('futureai.musicShuffle', host.musicShuffleEnabled ? 'on' : 'off');
  renderMusicTransport();
}
function toggleMusicRepeat() {
  host.musicRepeatMode = host.musicRepeatMode === 'off' ? 'all' : host.musicRepeatMode === 'all' ? 'one' : 'off';
  host.musicShuffleEnabled = false;
  const core = syncLXMusicQueue();
  if (core) core.setMode(host.musicRepeatMode === 'one' ? 'singleLoop' : host.musicRepeatMode === 'all' ? 'listLoop' : 'list');
  localStorage.setItem('futureai.musicShuffle', 'off');
  localStorage.setItem('futureai.musicRepeat', host.musicRepeatMode);
  renderMusicTransport();
}
function toggleMusicFavorite(track) {
  if (!track) return toast('请先选择音乐', 'warn');
  if (isMusicFavorite(track)) {
    host.musicFavorites = host.musicFavorites.filter(item => item.id !== track.id && item.url !== track.url);
    toast('已取消收藏', 'success');
  } else {
    host.musicFavorites = [track, ...host.musicFavorites.filter(item => item.id !== track.id && item.url !== track.url)].slice(0, 200);
    toast('已收藏音乐', 'success');
  }
  saveMusicFavorites();
  renderMusicPlayer();
}
async function openMusicSource(track) {
  if (!track?.pageUrl) return toast('没有来源页面', 'warn');
  window.open(track.pageUrl, '_blank');
}
function onMusicListClick(e) {
  const preset = e.target.closest('[data-music-preset]');
  if (preset) {
    const query = preset.dataset.musicPreset || 'cinematic';
    host.musicSearchQuery = query;
    if ($('musicSearchInput')) $('musicSearchInput').value = query;
    return searchFreeMusic({ query });
  }
  const id = e.target.closest('[data-music-id]')?.dataset.musicId;
  if (!id) return;
  const track = musicTrackById(id);
  if (e.target.closest('[data-music-favorite]')) return toggleMusicFavorite(track);
  if (e.target.closest('[data-music-source]')) return openMusicSource(track);
  playMusicTrack(track);
}
function musicTrackCard(track, compact = false) {
  const active = host.musicCurrentTrack?.id === track.id;
  const favorite = isMusicFavorite(track);
  const unavailable = host.musicUnavailableTrackIds.has(track.id) || host.musicUnavailableTrackIds.has(track.url);
  const playable = !!track.url && !unavailable;
  const playIcon = unavailable ? 'fa-rotate-right' : 'fa-play';
  const sourceLabel = track.source || '\u97f3\u4e50\u6765\u6e90';
  const sourceButton = track.pageUrl ? `<button class="icon-btn" data-music-source type="button" title="\u67e5\u770b\u6765\u6e90\u4e0e\u6388\u6743\u4fe1\u606f"><i class="fa-solid fa-arrow-up-right-from-square"></i></button>` : '<span></span>';
  return `<article class="music-track ${active ? 'active' : ''} ${track.local ? 'local' : ''} ${unavailable ? 'unavailable' : ''}" data-music-id="${esc(track.id)}"><button class="music-track-play" type="button"><i class="fa-solid ${playIcon}"></i></button><div><strong>${esc(track.title || '\u97f3\u4e50')}</strong><span>${esc(track.artist || '\u672a\u77e5\u4f5c\u8005')} · ${esc(unavailable ? '音源暂不可用' : sourceLabel)}</span></div><button class="icon-btn ${favorite ? 'active' : ''}" data-music-favorite type="button" title="\u6536\u85cf"><i class="${favorite ? 'fa-solid' : 'fa-regular'} fa-heart"></i></button>${sourceButton}</article>`;
}
function renderMusicTransport() {
  const audio = $('musicAudio');
  const queue = musicPlayableQueue();
  const queueIndex = musicQueueIndex(queue);
  const isPlaying = !!audio?.src && !audio.paused;
  const progressValue = host.musicDuration ? Math.round((host.musicCurrentTime / host.musicDuration) * 1000) : 0;
  if ($('musicNowTitle')) $('musicNowTitle').textContent = host.musicCurrentTrack?.title || '未选择音乐';
  if ($('musicNowMeta')) $('musicNowMeta').textContent = host.musicCurrentTrack ? `${host.musicCurrentTrack.artist || '未知作者'} · ${host.musicCurrentTrack.source || '音乐'}` : '搜索后点击播放';
  if ($('musicDeckTitle')) $('musicDeckTitle').textContent = host.musicCurrentTrack?.title || '未选择音乐';
  if ($('musicDeckMeta')) $('musicDeckMeta').textContent = host.musicCurrentTrack ? `${host.musicCurrentTrack.artist || '未知作者'} · ${host.musicCurrentTrack.source || host.musicCurrentTrack.license || '音乐'}` : '搜索歌曲或导入本地音乐';
  if ($('musicQueueCount')) $('musicQueueCount').textContent = `${queue.length} 首可播放`;
  if ($('musicQueueState')) $('musicQueueState').textContent = queue.length ? `${queueIndex >= 0 ? queueIndex + 1 : 0} / ${queue.length}` : '0 / 0';
  if ($('musicElapsed')) $('musicElapsed').textContent = formatMusicTime(host.musicCurrentTime);
  if ($('host.musicDuration')) $('host.musicDuration').textContent = formatMusicTime(host.musicDuration);
  if ($('musicSeek') && document.activeElement !== $('musicSeek')) $('musicSeek').value = String(progressValue);
  if ($('musicVolume') && document.activeElement !== $('musicVolume')) $('musicVolume').value = String(Math.round(Math.max(0, Math.min(1, host.musicPlayerVolume)) * 100));
  if ($('musicPlayPause')) $('musicPlayPause').innerHTML = `<i class="fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'}"></i>`;
  $('musicShuffle')?.classList.toggle('active', host.musicShuffleEnabled);
  $('musicRepeat')?.classList.toggle('active', host.musicRepeatMode !== 'off');
  if ($('musicRepeat')) {
    $('musicRepeat').title = host.musicRepeatMode === 'one' ? '单曲循环' : host.musicRepeatMode === 'all' ? '列表循环' : '循环播放';
    $('musicRepeat').innerHTML = `<i class="fa-solid fa-repeat"></i>`;
  }
  if ($('musicFavoriteCurrent')) $('musicFavoriteCurrent').innerHTML = `<i class="${isMusicFavorite(host.musicCurrentTrack) ? 'fa-solid' : 'fa-regular'} fa-heart"></i> ${isMusicFavorite(host.musicCurrentTrack) ? '已收藏' : '收藏'}`;
}
function musicPresetCard(item, index) {
  return `<button class="music-preset-card preset-${index % 6}" data-music-preset="${esc(item.query)}" type="button"><span><i class="fa-solid ${esc(item.icon)}"></i></span><strong>${esc(item.title)}</strong><small>${esc(item.caption)}</small><em><i class="fa-solid fa-play"></i></em></button>`;
}

function renderMusicRecommendations() {
  const presets = [
    {title: '\u6bcf\u65e5\u63a8\u8350', query: 'lofi chill beats', caption: '\u8f7b\u677e\u5199\u4f5c\u548c\u5de5\u4f5c', icon: 'fa-calendar-day'},
    {title: '\u79c1\u4eba\u96f7\u8fbe', query: 'indie electronic creative commons', caption: '\u5f00\u6e90\u72ec\u7acb\u97f3\u4e50', icon: 'fa-satellite-dish'},
    {title: '\u70ed\u6b4c\u699c', query: 'popular free music', caption: '\u516c\u5f00\u66f2\u5e93\u70ed\u95e8', icon: 'fa-fire'},
    {title: '\u7535\u5f71\u914d\u4e50', query: 'cinematic soundtrack creative commons', caption: '\u526a\u8f91\u548c\u9884\u544a\u7247\u6c1b\u56f4', icon: 'fa-film'},
    {title: '\u5de5\u4f5c\u4e13\u6ce8', query: 'focus ambient instrumental', caption: '\u957f\u65f6\u6bb5\u4e13\u6ce8\u64ad\u653e', icon: 'fa-headphones-simple'},
    {title: '\u653e\u677e\u6c1b\u56f4', query: 'relaxing ambient piano', caption: '\u5b89\u9759\u3001\u7f13\u6162\u3001\u67d4\u548c', icon: 'fa-cloud'},
    {title: '\u7535\u97f3\u65e5\u63a8', query: 'electronic dance creative commons', caption: '\u8282\u594f\u548c\u80fd\u91cf', icon: 'fa-bolt'},
    {title: '\u5f00\u6e90\u7535\u53f0', query: 'lofi radio', caption: '\u8fde\u7eed\u64ad\u653e\u7f51\u7edc\u7535\u53f0', icon: 'fa-tower-broadcast'}
  ];
  return `<section class="music-home"><div class="music-section-title inline"><strong>\u63a8\u8350\u6b4c\u5355</strong><span>\u70b9\u51fb\u540e\u81ea\u52a8\u641c\u7d22\u5e76\u52a0\u5165\u64ad\u653e\u961f\u5217</span></div><div class="music-preset-grid">${presets.map(musicPresetCard).join('')}</div></section>`;
}

function renderMusicQueueList() {
  const queue = musicPlayableQueue();
  if (!$('musicQueueList')) return;
  $('musicQueueList').innerHTML = queue.map(track => musicTrackCard(track, true)).join('') || '<div class="music-empty">\u53ef\u64ad\u653e\u6b4c\u66f2\u4f1a\u51fa\u73b0\u5728\u8fd9\u91cc</div>';
}

function renderMusicResultsShell() {
  const playableCount = host.musicResults.filter(track => track.url).length;
  const localHtml = host.musicLocalTracks.length ? `<section class="music-home"><div class="music-section-title inline"><strong>\u672c\u5730\u97f3\u4e50</strong><span>${host.musicLocalTracks.length} \u9996\u5df2\u5bfc\u5165</span></div><div class="music-local-strip">${host.musicLocalTracks.slice(0, 8).map(track => musicTrackCard(track, true)).join('')}</div></section>` : '';
  const resultTitle = host.musicResults.length ? `<div class="music-result-summary"><strong>\u641c\u7d22\u7ed3\u679c</strong><span>${playableCount} \u9996\u53ef\u514d\u8d39\u64ad\u653e</span></div>` : '';
  const resultsHtml = host.musicResults.map(track => musicTrackCard(track)).join('') || '<div class="music-empty">\u8f93\u5165\u6b4c\u540d\u3001\u6b4c\u624b\u6216\u66f2\u98ce\uff0c\u4f1a\u81ea\u52a8\u53bb\u516c\u5f00\u66f2\u5e93\u627e\u53ef\u64ad\u653e\u7684\u514d\u8d39\u97f3\u4e50</div>';
  if (host.musicResults.length) return `${resultTitle}${resultsHtml}${localHtml}${renderMusicRecommendations()}`;
  return `${renderMusicRecommendations()}${localHtml}${resultTitle}${resultsHtml}`;
}

function renderMusicPlayer() {
  if ($('musicSearchInput') && $('musicSearchInput').value !== host.musicSearchQuery) $('musicSearchInput').value = host.musicSearchQuery;
  if ($('musicSearchStatus')) $('musicSearchStatus').textContent = host.musicStatus;
  if ($('musicResultsList')) $('musicResultsList').innerHTML = renderMusicResultsShell(); 
  if ($('musicFavoritesList')) $('musicFavoritesList').innerHTML = host.musicFavorites.map(track => musicTrackCard(track, true)).join('') || '<div class="music-empty">\u8fd8\u6ca1\u6709\u6536\u85cf\u97f3\u4e50</div>'; 
  renderMusicQueueList();
  renderMusicPlugins();
  if ($('musicFavoriteCount')) $('musicFavoriteCount').textContent = `${host.musicFavorites.length} \u9996`; 
  renderMusicTransport();
}
function addAssetLibraryItem(item) {
  const entry = compactHistoryItem({id: 'a_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), projectId: '', time: Date.now(), ...item});
  const url = assetPrimaryUrl(entry);
  if (!url) return toast('这个节点没有可加入资产库的素材', 'warn');
  host.assetLibrary = [entry, ...host.assetLibrary.filter(asset => assetPrimaryUrl(asset) !== url)].slice(0, 120);
  if (!trySaveAssetLibrary()) {
    host.assetLibrary = host.assetLibrary.slice(0, 60).map(compactHistoryItem);
    trySaveAssetLibrary();
    toast('资产库空间较大，已自动压缩部分记录。', 'warn');
  }
  renderAssetLibrary();
  if (item?.skipPortable !== true) {
    saveAssetToPortableLibrary(entry).catch(err => console.warn('portable library save failed', err));
  }
  return entry;
}

async function saveAssetToPortableLibrary(asset, {quiet = true} = {}) {
  const bridge = window.portableLibraryBridge;
  if (!bridge?.save) return null;
  const url = assetPrimaryUrl(asset);
  if (!url) return null;
  try {
    const payload = {
      name: assetDisplayName(asset),
      kind: assetKind(asset),
      prompt: asset.prompt || '',
      tags: Array.isArray(asset.tags) ? asset.tags : [],
      mime: asset.mime || '',
      size: asset.size || '',
      model: asset.model || '',
      time: asset.time || Date.now()
    };
    if (/^data:/i.test(url)) payload.dataUrl = url;
    else payload.url = url;
    const saved = await bridge.save(payload);
    if (saved?.id) {
      const record = assetRecordById(asset.id) || host.assetLibrary.find(a => assetPrimaryUrl(a) === url);
      if (record) {
        record.portable = true;
        record.portableId = saved.id;
        record.sha256 = saved.sha256 || record.sha256 || '';
        if (saved.url) {
          record.url = saved.url;
          record.urls = [saved.url];
        }
        const tags = Array.isArray(record.tags) ? record.tags.slice() : [];
        if (!tags.includes('便携')) tags.unshift('便携');
        record.tags = tags.slice(0, 12);
        // Drop any duplicate cards that just got merged via portable id/sha
        host.assetLibrary = host.assetLibrary.filter((a, idx, arr) => {
          if (a === record) return true;
          if (record.portableId && a.portableId === record.portableId) return false;
          if (record.sha256 && a.sha256 && a.sha256 === record.sha256) return false;
          return true;
        });
        trySaveAssetLibrary();
        renderAssetLibrary();
      }
      if (!quiet) toast('已存入便携素材库（随软件文件夹一起带走）', 'success');
    }
    return saved;
  } catch (error) {
    if (!quiet) toast(`存入便携素材库失败：${error?.message || error}`, 'warn');
    throw error;
  }
}

async function syncPortableLibraryIntoAssets() {
  const bridge = window.portableLibraryBridge;
  if (!bridge?.list) return {merged: 0};
  let items = [];
  try { items = await bridge.list() || []; } catch (error) {
    console.warn('portable library list failed', error);
    return {merged: 0};
  }
  let merged = 0;
  for (const item of items) {
    if (!item?.url) continue;
    const existing = host.assetLibrary.find(asset => {
      if (asset.portableId && asset.portableId === item.id) return true;
      if (asset.sha256 && item.sha256 && asset.sha256 === item.sha256) return true;
      return assetPrimaryUrl(asset) === item.url;
    });
    if (existing) {
      existing.portable = true;
      existing.portableId = item.id;
      existing.sha256 = item.sha256 || existing.sha256 || '';
      if (!Array.isArray(existing.tags)) existing.tags = [];
      if (!existing.tags.includes('便携')) existing.tags = ['便携', ...existing.tags].slice(0, 12);
      if (!existing.url && item.url) existing.url = item.url;
      continue;
    }
    host.assetLibrary.unshift(compactHistoryItem({
      id: item.id || ('lib_' + Date.now()),
      projectId: '',
      time: item.time || item.updatedAt || Date.now(),
      type: item.kind === 'video' ? 'video' : 'image',
      url: item.url,
      urls: item.urls || [item.url],
      name: item.name || '便携素材',
      prompt: item.prompt || '',
      tags: Array.isArray(item.tags) && item.tags.length ? item.tags : ['便携'],
      model: item.model || '',
      size: item.size || '',
      mime: item.mime || '',
      portable: true,
      portableId: item.id,
      sha256: item.sha256 || ''
    }));
    merged += 1;
  }
  if (merged) {
    host.assetLibrary = host.assetLibrary.slice(0, 120);
    trySaveAssetLibrary();
  }
  renderAssetLibrary();
  return {merged, total: items.length};
}
function trySaveHistory() {
  try {
    return setStore(STORE.history, host.history) !== false;
  } catch {
    return false;
  }
}
function trySaveAssetLibrary() {
  try {
    return setStore(STORE.assets, host.assetLibrary) !== false;
  } catch {
    return false;
  }
}
function onHistoryClick(e) {
  const action = e.target.closest('[data-asset-action]');
  if (action) return;
  const emptyAction = e.target.closest('[data-history-empty-action]');
  if (emptyAction?.dataset.historyEmptyAction === 'image') {
    const center = viewCenter();
    const node = addNode('image', center.x - 260, center.y - 180, {size: '1024x1024', prompt: ''});
    if (node) {
      selectSingleNode(node.id);
      closeHistory();
      fitNodeIntoView(node);
      saveProject();
      toast('已创建图片节点，请填写提示词后生成', 'success');
    }
    return;
  }
  const restore = e.target.closest('[data-restore]');
  if (restore) {
    e.preventDefault();
    e.stopPropagation();
    const h = host.history.find(x => x.id === restore.dataset.restore);
    if (!h) return;
    const restoreUrls = historyRestoreUrls(h);
    const restoreUrl = restoreUrls[0] || '';
    if (!restoreUrl) return toast('这条历史记录没有可恢复的素材文件', 'warn');
    const center = viewCenter();
    const node = h.type === 'video'
      ? addNode('video', center.x - 260, center.y - 180, {prompt: h.prompt, model: h.model, url: restoreUrl, refUrl: h.refUrl || '', size: h.size || '1280x720', duration: h.duration || '5'})
      : addNode('image', center.x - 260, center.y - 180, {prompt: h.prompt, model: h.model, url: restoreUrl, urls: restoreUrls, refUrl: h.refUrl || '', size: h.size || '1024x1024'});
    if (node) {
      selectSingleNode(node.id);
      closeHistory();
      fitNodeIntoView(node);
      saveProject();
      toast('历史素材已恢复到画布', 'success');
    }
    return;
  }
  const preview = e.target.closest('[data-history-preview]');
  const img = preview?.querySelector('img');
  if (img) return openImageModal(img.src, preview);
}
function renderHistory() {
  const scoped = scopedHistoryItems(host.history, host.currentProjectId);
  $('historyList').innerHTML = historyCardsHtml(scoped);
}
function renderAssetLibrary() {
  ensureAssetLibraryFolderSelection();
  renderAssetLibraryFolders();
  if ($('assetSmartCollection')) $('assetSmartCollection').value = host.assetLibrarySmartCollection || 'all';
  const scoped = host.assetLibrary.filter(assetLibraryMatchesFilters);
  const duplicateGroups = duplicateAssetGroups(host.assetLibrary.filter(item => !item.deletedAt));
  const activeAssets = host.assetLibrary.map(normalizeAssetItem).filter(asset => asset && !asset.deletedAt);
  const indexedCount = activeAssets.filter(asset => asset.visualFeature?.hash).length;
  const failedCount = activeAssets.filter(asset => asset.visualIndexError).length;
  const reportParts = [];
  if (host.assetLibraryVisualQuery?.feature) reportParts.push(`正在查找与“${esc(host.assetLibraryVisualQuery.name || '所选素材')}”视觉相近的素材 <button type="button" data-asset-report-action="clear-similar">清除</button>`);
  if (duplicateGroups.length) reportParts.push(`发现 ${duplicateGroups.length} 组重复素材`);
  if (activeAssets.some(asset => asset.kind === 'image')) reportParts.push(`视觉索引 ${indexedCount} 项${failedCount ? `，${failedCount} 项读取失败` : ''}`);
  if (host.assetLibraryTrashOnly) reportParts.push('回收站中的资产仍可恢复，未删除本地媒体文件');
  const report = $('assetLibraryReport');
  if (report) report.innerHTML = reportParts.join(' · ');
  $('assetLibraryList').innerHTML = assetLibraryCardsHtml(scoped);
}
function toggleAssetLibraryTrash() {
  host.assetLibraryTrashOnly = !host.assetLibraryTrashOnly;
  const label = host.assetLibraryTrashOnly ? '返回资产库' : '查看回收站';
  $('assetLibraryTrashToggle')?.setAttribute('title', label);
  $('assetLibraryTrashToggle')?.setAttribute('aria-label', label);
  renderAssetLibrary();
}
function normalizeAssetFolders(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).map(folder => ({
    id: String(folder?.id || '').trim(),
    name: String(folder?.name || '').trim(),
    projectId: folder?.projectId || '',
    time: Number(folder?.time || Date.now())
  })).filter(folder => {
    if (!folder.id || !folder.name || seen.has(folder.id)) return false;
    seen.add(folder.id);
    return true;
  }).slice(0, 80);
}
function scopedAssetFolders() {
  return normalizeAssetFolders(host.assetLibraryFolders);
}
function assetFolderId(item) {
  return item?.folderId || 'uncategorized';
}
function ensureAssetLibraryFolderSelection() {
  if (host.assetLibraryFolderId === 'all' || host.assetLibraryFolderId === 'uncategorized') return;
  if (!scopedAssetFolders().some(folder => folder.id === host.assetLibraryFolderId)) host.assetLibraryFolderId = 'all';
}
function assetFolderCounts() {
  const counts = {all: 0, uncategorized: 0};
  host.assetLibrary.forEach(item => {
    if (!normalizeAssetItem(item)) return;
    const id = assetFolderId(item);
    counts.all += 1;
    counts[id] = (counts[id] || 0) + 1;
  });
  return counts;
}
function renderAssetLibraryFolders() {
  const box = $('assetLibraryFolderSelect');
  if (!box) return;
  const folders = scopedAssetFolders();
  const counts = assetFolderCounts();
  const rows = [
    {id: 'all', name: '全部资产', icon: 'fa-layer-group', count: counts.all || 0},
    {id: 'uncategorized', name: '未分类', icon: 'fa-folder-open', count: counts.uncategorized || 0},
    ...folders.map(folder => ({...folder, icon: 'fa-folder', count: counts[folder.id] || 0}))
  ];
  box.innerHTML = rows.map(folder => `
    <option value="${esc(folder.id)}" ${folder.id === host.assetLibraryFolderId ? 'selected' : ''}>${esc(folder.name)} (${folder.count})</option>`).join('');
}
function saveAssetLibraryFolders() {
  host.assetLibraryFolders = normalizeAssetFolders(host.assetLibraryFolders);
  return setStore(STORE.assetFolders, host.assetLibraryFolders) !== false;
}
async function createAssetLibraryFolder() {
  const value = await openModal({title: '新建资产文件夹', value: '素材文件夹', okText: '创建'});
  if (value === null) return;
  const name = String(value || '').trim();
  if (!name) return toast('文件夹名称不能为空', 'warn');
  const duplicate = scopedAssetFolders().some(folder => folder.name === name);
  if (duplicate) return toast('已经有同名文件夹', 'warn');
  const folder = {id: 'af_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), name, projectId: '', time: Date.now()};
  host.assetLibraryFolders = [folder, ...host.assetLibraryFolders];
  host.assetLibraryFolderId = folder.id;
  saveAssetLibraryFolders();
  renderAssetLibrary();
  toast('文件夹已创建', 'success');
}
function assetLibraryFolderOptionsHtml(currentId = '') {
  return ['未分类', ...scopedAssetFolders().map(folder => folder.name)].map((name, index) => {
    const id = index === 0 ? 'uncategorized' : scopedAssetFolders()[index - 1].id;
    return `${id === currentId ? '● ' : '○ '}${name}`;
  }).join('\n');
}
function folderNameById(id) {
  if (!id || id === 'uncategorized') return '未分类';
  return scopedAssetFolders().find(folder => folder.id === id)?.name || '未分类';
}
async function moveAssetLibraryItem(id) {
  const item = assetRecordById(id);
  if (!item) return;
  const current = assetFolderId(item);
  const options = assetLibraryFolderOptionsHtml(current);
  const next = await openModal({title: '移动到文件夹', value: folderNameById(current), okText: '移动'});
  if (next === null) return;
  const name = String(next || '').trim();
  const folder = scopedAssetFolders().find(entry => entry.name === name || entry.id === name);
  if (name === '未分类' || name === 'uncategorized') item.folderId = '';
  else if (folder) item.folderId = folder.id;
  else return toast('请输入已有文件夹名称：\n' + options, 'warn');
  trySaveAssetLibrary();
  renderAssetLibrary();
  toast('资产已移动', 'success');
}
function assetLibraryMatchesFilters(item) {
  const asset = normalizeAssetItem(item);
  if (!asset) return false;
  if (host.assetLibraryTrashOnly ? !asset.deletedAt : asset.deletedAt) return false;
  if (host.assetLibraryFolderId === 'uncategorized' && asset.folderId) return false;
  if (host.assetLibraryFolderId !== 'all' && host.assetLibraryFolderId !== 'uncategorized' && asset.folderId !== host.assetLibraryFolderId) return false;
  if (host.assetLibraryType !== 'all' && asset.kind !== host.assetLibraryType) return false;
  const usageCount = getAssetReferences(asset.url).length;
  if (SmartIndex && !SmartIndex.matchesCollection(asset, host.assetLibrarySmartCollection || 'all', usageCount)) return false;
  if (host.assetLibraryVisualQuery?.feature) {
    if (!asset.visualFeature?.hash || SmartIndex.featureDistance(asset.visualFeature, host.assetLibraryVisualQuery.feature) > .42) return false;
  }
  const q = String(host.assetLibrarySearch || '').trim().toLowerCase();
  if (!q) return true;
  return SmartIndex
    ? SmartIndex.matchesQuery(asset, q, usageCount, host.assetLibraryVisualQuery?.feature || null)
    : [asset.name, asset.prompt, asset.model, asset.tags.join(' ')].join(' ').toLowerCase().includes(q);
}
function assetKind(item) {
  const url = assetPrimaryUrl(item);
  return item?.type === 'video' || isVideoMedia(item?.mime, url) ? 'video' : 'image';
}
function assetPrimaryUrl(item) {
  return historyRestoreUrls(item)[0] || item?.url || '';
}
function assetDisplayName(item) {
  return item?.title || item?.name || (assetKind(item) === 'video' ? '视频资产' : '图片资产');
}
function normalizeAssetItem(item) {
  if (!item) return null;
  const url = assetPrimaryUrl(item);
  if (!url) return null;
  const kind = assetKind(item);
  const normalized = {
    id: item.id || 'asset_' + Date.now(),
    kind,
    url,
    urls: historyRestoreUrls(item),
    refUrl: item.refUrl || '',
    name: assetDisplayName(item),
    prompt: item.prompt || '',
    tags: Array.isArray(item.tags) ? item.tags : [],
    folderId: item.folderId || '',
    model: item.model || '',
    size: item.size || (kind === 'video' ? '1280x720' : '1024x1024'),
    duration: item.duration || '5',
    mime: kind === 'video' ? 'video/mp4' : 'image/png',
    deletedAt: Number(item.deletedAt || 0),
    visualFeature: item.visualFeature?.hash ? {...item.visualFeature} : null,
    visualIndexError: String(item.visualIndexError || ''),
    smartCollections: Array.isArray(item.smartCollections) ? [...item.smartCollections] : [],
    portable: !!item.portable,
    portableId: item.portableId || '',
    sha256: item.sha256 || ''
  };
  if (!normalized.smartCollections.length && SmartIndex) normalized.smartCollections = SmartIndex.semanticCollections(normalized);
  return normalized;
}
function duplicateAssetGroups(items = []) {
  const groups = new Map();
  items.forEach(item => {
    const url = assetPrimaryUrl(item);
    if (!url) return;
    const list = groups.get(url) || [];
    list.push(item);
    groups.set(url, list);
  });
  return [...groups.values()].filter(list => list.length > 1);
}
function assetLibraryCardsHtml(items) {
  const assets = items.map(normalizeAssetItem).filter(Boolean);
  if (!assets.length) return '<div class="history-empty"><strong>还没有资产</strong><span>导入图片/视频，或在节点菜单选择“加入我的资产”。存入便携库的素材会放在软件旁的 library 文件夹，复制到其他电脑也能用。</span><button type="button" class="ghost-btn" data-asset-empty-action="import"><i class="fa-solid fa-upload" aria-hidden="true"></i>导入第一个资产</button></div>';
  return assets.map(asset => {
    const safeUrl = safeMediaUrl(asset.url);
    return `
    <article class="history-card asset-card" draggable="true" data-asset-id="${esc(asset.id)}">
      ${safeUrl ? (asset.kind === 'video' ? `<video src="${esc(safeUrl)}" muted playsinline></video>` : `<img src="${esc(safeUrl)}" alt="${esc(asset.name)}">`) : '<i class="fa-solid fa-file-circle-question"></i>'}
      <strong>${esc(asset.name)}</strong>
      <div class="asset-folder-label"><i class="fa-solid fa-folder"></i>${esc(folderNameById(asset.folderId))}</div>
      ${asset.portable ? '<span class="asset-index-badge" title="已存入便携素材库，复制软件文件夹即可带走"><i class="fa-solid fa-suitcase"></i> 便携</span>' : ''}
      ${asset.visualFeature?.hash ? '<span class="asset-index-badge" title="已建立本地视觉索引"><i class="fa-solid fa-fingerprint"></i> 已索引</span>' : ''}
      ${asset.tags.length ? `<div class="asset-tags">${asset.tags.slice(0, 4).map(tag => `<span>${esc(tag)}</span>`).join('')}</div>` : ''}
      <p>${esc(asset.prompt || (asset.kind === 'video' ? '视频素材' : '图片素材'))}</p>
      <div class="asset-actions">
        ${asset.deletedAt ? `<button type="button" data-asset-action="restore" data-asset-id="${esc(asset.id)}" title="恢复资产"><i class="fa-solid fa-trash-arrow-up"></i></button>` : ''}
        <button type="button" data-asset-action="canvas" data-asset-id="${esc(asset.id)}" title="放入画布"><i class="fa-solid fa-diagram-project"></i></button>
        <button type="button" data-asset-action="assistant" data-asset-id="${esc(asset.id)}" title="发给∞ 灵枢万象"><i class="fa-solid fa-comments"></i></button>
        <button type="button" data-asset-action="short" data-asset-id="${esc(asset.id)}" title="加入 AI 漫剧资产"><i class="fa-regular fa-circle-play"></i></button>
        <button type="button" data-asset-action="rename" data-asset-id="${esc(asset.id)}" title="重命名"><i class="fa-solid fa-pen"></i></button>
        <button type="button" data-asset-action="tag" data-asset-id="${esc(asset.id)}" title="编辑标签"><i class="fa-solid fa-tag"></i></button>
        <button type="button" data-asset-action="move" data-asset-id="${esc(asset.id)}" title="移动到文件夹"><i class="fa-solid fa-folder-tree"></i></button>
        ${asset.kind === 'image' ? `<button type="button" data-asset-action="similar" data-asset-id="${esc(asset.id)}" title="查找视觉相近素材"><i class="fa-solid fa-object-group"></i></button>` : ''}
        <button type="button" data-asset-action="impact" data-asset-id="${esc(asset.id)}" title="查看替换影响"><i class="fa-solid fa-code-branch"></i></button>
        ${asset.deletedAt || asset.portable ? '' : `<button type="button" data-asset-action="portable" data-asset-id="${esc(asset.id)}" title="存到便携素材库（随软件文件夹带走）"><i class="fa-solid fa-suitcase"></i></button>`}
        ${asset.deletedAt ? '' : `<button type="button" data-asset-action="delete" data-asset-id="${esc(asset.id)}" title="移入回收站"><i class="fa-regular fa-trash-can"></i></button>`}
      </div>
    </article>`;
  }).join('');
}
function assetById(id) {
  return normalizeAssetItem(host.assetLibrary.find(item => item.id === id));
}
function assetRecordById(id) {
  return host.assetLibrary.find(item => item.id === id) || null;
}
function onAssetLibraryDragStart(e) {
  const card = e.target.closest('[data-asset-id]');
  if (!card || e.target.closest('button')) return;
  const asset = assetById(card.dataset.assetId);
  if (!asset) return;
  e.dataTransfer.effectAllowed = 'copy';
  e.dataTransfer.setData('application/x-future-ai-asset', JSON.stringify(asset));
  e.dataTransfer.setData('text/plain', asset.url);
  document.body.classList.add('asset-dragging');
}
function onAssetLibraryDragEnd() {
  document.body.classList.remove('asset-dragging');
  document.querySelectorAll('.asset-drop-over').forEach(el => el.classList.remove('asset-drop-over'));
}
function assetFromDataTransfer(dataTransfer) {
  const raw = dataTransfer?.getData?.('application/x-future-ai-asset') || '';
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function hasAssetTransfer(dataTransfer) {
  return [...(dataTransfer?.types || [])].includes('application/x-future-ai-asset');
}
async function onAssetLibraryActionClick(e) {
  const emptyAction = e.target.closest('[data-asset-empty-action]')?.dataset.assetEmptyAction;
  if (emptyAction === 'import') return $('assetLibraryFileInput')?.click();
  const btn = e.target.closest('[data-asset-action]');
  if (!btn) return;
  const asset = assetById(btn.dataset.assetId);
  if (!asset) return toast('资产不可用', 'warn');
  if (btn.dataset.assetAction === 'canvas') return dropAssetOnCanvas(asset);
  if (btn.dataset.assetAction === 'assistant') return sendAssetToAssistant(asset);
  if (btn.dataset.assetAction === 'short') return sendAssetToShortWorkbench(asset);
  if (btn.dataset.assetAction === 'rename') return renameAssetLibraryItem(btn.dataset.assetId);
  if (btn.dataset.assetAction === 'tag') return editAssetLibraryTags(btn.dataset.assetId);
  if (btn.dataset.assetAction === 'move') return moveAssetLibraryItem(btn.dataset.assetId);
  if (btn.dataset.assetAction === 'similar') return findSimilarAsset(btn.dataset.assetId);
  if (btn.dataset.assetAction === 'impact') return showAssetReplacementImpact(btn.dataset.assetId);
  if (btn.dataset.assetAction === 'restore') return restoreAssetLibraryItem(btn.dataset.assetId);
  if (btn.dataset.assetAction === 'dedupe') return dedupeAssetLibrary();
  if (btn.dataset.assetAction === 'portable') {
    const record = assetRecordById(btn.dataset.assetId);
    if (!record) return toast('资产不可用', 'warn');
    return saveAssetToPortableLibrary(record, {quiet: false});
  }
  if (btn.dataset.assetAction === 'delete') return deleteAssetLibraryItem(btn.dataset.assetId);
}
function onAssetLibraryReportClick(e) {
  if (!e.target.closest('[data-asset-report-action="clear-similar"]')) return;
  host.assetLibraryVisualQuery = null;
  renderAssetLibrary();
}
async function findSimilarAsset(id) {
  const item = assetRecordById(id);
  const asset = normalizeAssetItem(item);
  if (!item || !asset || asset.kind !== 'image' || !SmartIndex) return toast('这个素材暂不支持视觉相似检索', 'warn');
  if (!item.visualFeature?.hash) {
    try {
      item.visualFeature = await SmartIndex.extractVisualFeature(safeMediaUrl(asset.url) || asset.url);
      item.visualIndexError = '';
      item.smartCollections = SmartIndex.semanticCollections(asset);
      trySaveAssetLibrary();
    } catch (error) {
      item.visualIndexError = String(error?.message || error || '素材无法读取');
      trySaveAssetLibrary();
      renderAssetLibrary();
      return toast('无法为这个素材建立视觉索引，原素材未受影响', 'warn');
    }
  }
  host.assetLibraryVisualQuery = {sourceId: asset.id, name: asset.name, feature: {...item.visualFeature}};
  host.assetLibrarySmartCollection = 'all';
  if ($('assetSmartCollection')) $('assetSmartCollection').value = 'all';
  renderAssetLibrary();
}
async function showAssetReplacementImpact(id) {
  const asset = assetById(id);
  if (!asset) return;
  const references = getAssetReferences(asset.url);
  const lines = references.slice(0, 30).map(reference => {
    if (reference.type === 'current') return `当前画布 · ${reference.nodeType || '节点'} #${reference.nodeId || ''}`;
    if (reference.type === 'project') return `${reference.projectName || '项目'} · ${reference.nodeType || '节点'} #${reference.nodeId || ''}`;
    return `历史记录 · ${reference.id || ''}`;
  });
  const suffix = references.length > lines.length ? `\n另有 ${references.length - lines.length} 处未展开。` : '';
  const value = references.length
    ? `替换“${asset.name}”会影响 ${references.length} 处引用：\n\n${lines.join('\n')}${suffix}\n\n当前操作仅展示影响，不会自动替换或删除任何内容。`
    : `“${asset.name}”当前没有被项目节点或历史记录引用，可以安全整理。`;
  await openModal({title: '素材替换影响', value, okText: '知道了'});
}
async function rebuildAssetVisualIndex() {
  if (!SmartIndex) return toast('视觉索引模块未加载', 'error');
  const button = $('assetLibraryReindex');
  const repair = SmartIndex.repairIndex(host.assetLibrary);
  if (repair.invalid) host.assetLibrary = repair.assets;
  const candidates = host.assetLibrary.filter(item => {
    const asset = normalizeAssetItem(item);
    return asset && !asset.deletedAt && asset.kind === 'image';
  });
  if (!candidates.length) return toast('资产库中还没有可建立索引的图片', 'warn');
  if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
  let indexed = 0;
  let failed = 0;
  try {
    for (const item of candidates) {
      const asset = normalizeAssetItem(item);
      item.smartCollections = SmartIndex.semanticCollections(asset);
      try {
        item.visualFeature = await SmartIndex.extractVisualFeature(safeMediaUrl(asset.url) || asset.url);
        item.visualIndexError = '';
        indexed += 1;
      } catch (error) {
        item.visualIndexError = String(error?.message || error || '素材无法读取');
        failed += 1;
      }
      if ((indexed + failed) % 5 === 0) {
        trySaveAssetLibrary();
        const report = $('assetLibraryReport');
        if (report) report.textContent = `正在重建视觉索引：${indexed + failed}/${candidates.length}`;
        await wait(0);
      }
    }
    trySaveAssetLibrary();
    renderAssetLibrary();
    toast(`视觉索引已重建：成功 ${indexed} 项${failed ? `，失败 ${failed} 项` : ''}${repair.invalid ? `，已修复 ${repair.invalid} 条损坏索引` : ''}`, failed ? 'warn' : 'success');
  } finally {
    if (button) { button.disabled = false; button.removeAttribute('aria-busy'); }
  }
}
async function renameAssetLibraryItem(id) {
  const item = assetRecordById(id);
  if (!item) return;
  const next = await openModal({title: '重命名资产', value: assetDisplayName(item), okText: '保存'});
  if (next === null) return;
  const name = String(next || '').trim();
  if (!name) return toast('资产名称不能为空', 'warn');
  item.name = name;
  item.title = name;
  trySaveAssetLibrary();
  renderAssetLibrary();
  toast('资产已重命名', 'success');
}
async function editAssetLibraryTags(id) {
  const item = assetRecordById(id);
  if (!item) return;
  const current = Array.isArray(item.tags) ? item.tags.join('、') : '';
  const next = await openModal({title: '编辑资产标签', value: current, okText: '保存'});
  if (next === null) return;
  item.tags = String(next || '').split(/[、,，\n]/).map(s => s.trim()).filter(Boolean).slice(0, 12);
  trySaveAssetLibrary();
  renderAssetLibrary();
  toast('资产标签已更新', 'success');
}
async function deleteAssetLibraryItem(id) {
  const item = assetRecordById(id);
  if (!item) return;
  const references = getAssetReferences(assetPrimaryUrl(item));
  const impact = references.length ? `\n\n仍被 ${references.length} 处项目/历史引用；移入回收站不会破坏这些引用。` : '\n\n当前没有发现项目或历史引用。';
  const ok = await openModal({title: '移入资产回收站', value: `确认移入：${assetDisplayName(item)}${impact}`, okText: '移入回收站'});
  if (ok === null) return;
  item.deletedAt = Date.now();
  trySaveAssetLibrary();
  renderAssetLibrary();
  toast('资产已移入回收站，可随时恢复', 'success');
}
function restoreAssetLibraryItem(id) {
  const item = assetRecordById(id);
  if (!item) return;
  item.deletedAt = 0;
  trySaveAssetLibrary();
  renderAssetLibrary();
  toast('资产已恢复', 'success');
}
async function dedupeAssetLibrary() {
  const groups = duplicateAssetGroups(host.assetLibrary.filter(item => !item.deletedAt));
  if (!groups.length) return toast('没有发现重复素材', 'success');
  const ok = await openModal({title: '整理重复素材', value: `发现 ${groups.length} 组重复素材。每组会保留最新记录，其余移入回收站；本地媒体文件不会删除。`, okText: '整理'});
  if (ok === null) return;
  groups.forEach(list => list.slice().sort((a, b) => Number(b.time || 0) - Number(a.time || 0)).slice(1).forEach(item => { item.deletedAt = Date.now(); }));
  trySaveAssetLibrary();
  renderAssetLibrary();
  toast('重复素材已移入回收站', 'success');
}
async function importAssetLibraryFiles(files) {
  const list = [...(files || [])].filter(isSupportedUploadFile).slice(0, 30);
  if (!list.length) return toast('只支持导入图片或视频文件', 'warn');
  for (const file of list) {
    const dataUrl = await fileToDataUrl(file);
    const kind = isVideoMedia(file.type, dataUrl) ? 'video' : 'image';
    const url = await persistMediaUrl(dataUrl, file.name || 'asset', mediaExtFromMime(file.type, file.name));
    const folderId = host.assetLibraryFolderId !== 'all' && host.assetLibraryFolderId !== 'uncategorized' ? host.assetLibraryFolderId : '';
    addAssetLibraryItem({type: kind, url, name: file.name || (kind === 'video' ? '视频资产' : '图片资产'), prompt: '', mime: file.type || '', tags: ['导入'], folderId});
  }
  renderAssetLibrary();
  toast(`已导入 ${list.length} 个资产`, 'success');
}
    return {
      setMediaMode,
      stopOtherMedia,
      playLocalVideoFile,
      playMediaUrl,
      renderTvChannels,
      musicTrackById,
      isMusicFavorite,
      saveMusicFavorites,
      importLocalMusicFiles,
      musicPlayableQueue,
      musicQueueIndex,
      formatMusicTime,
      initLXMusicCore,
      syncLXMusicQueue,
      applyMusicVolume,
      loadMusicPluginRegistry,
      saveMusicPluginState,
      onMusicPluginToggle,
      renderMusicPlugins,
      searchOpenRadio,
      scheduleAutoMusicSearch,
      searchFreeMusic,
      playMusicTrack,
      toggleMusicPlayback,
      playAdjacentMusic,
      handleMusicEnded,
      handleMusicPlaybackError,
      updateMusicProgress,
      seekMusicPlayback,
      changeMusicVolume,
      toggleMusicShuffle,
      toggleMusicRepeat,
      toggleMusicFavorite,
      openMusicSource,
      onMusicListClick,
      musicTrackCard,
      renderMusicTransport,
      musicPresetCard,
      renderMusicRecommendations,
      renderMusicQueueList,
      renderMusicResultsShell,
      renderMusicPlayer,
      addAssetLibraryItem,
      saveAssetToPortableLibrary,
      syncPortableLibraryIntoAssets,
      trySaveHistory,
      trySaveAssetLibrary,
      onHistoryClick,
      renderHistory,
      renderAssetLibrary,
      rebuildAssetVisualIndex,
      onAssetLibraryReportClick,
      toggleAssetLibraryTrash,
      duplicateAssetGroups,
      dedupeAssetLibrary,
      normalizeAssetFolders,
      scopedAssetFolders,
      assetFolderId,
      ensureAssetLibraryFolderSelection,
      assetFolderCounts,
      renderAssetLibraryFolders,
      saveAssetLibraryFolders,
      createAssetLibraryFolder,
      assetLibraryFolderOptionsHtml,
      folderNameById,
      moveAssetLibraryItem,
      assetLibraryMatchesFilters,
      assetKind,
      assetPrimaryUrl,
      assetDisplayName,
      normalizeAssetItem,
      assetLibraryCardsHtml,
      assetById,
      assetRecordById,
      onAssetLibraryDragStart,
      onAssetLibraryDragEnd,
      assetFromDataTransfer,
      hasAssetTransfer,
      onAssetLibraryActionClick,
      renameAssetLibraryItem,
      editAssetLibraryTags,
      deleteAssetLibraryItem,
      importAssetLibraryFiles
    };
  }

  window.FutureAIMediaWorkbench = { create };
})();
