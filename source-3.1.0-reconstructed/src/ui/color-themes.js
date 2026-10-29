(function initColorThemes(global) {
  'use strict';

  const DEFAULT_CUSTOM_COLOR = '#4fd6e8';
  const MAX_SAVED_THEMES = 5;
  const PALETTE_KEYS = Object.freeze(['accent', 'deep', 'workspace', 'panel', 'control']);
  const THEMES = Object.freeze({
    ocean: {id:'ocean',name:'\u6781\u5149\u9752',accent:'#4fd6e8',accent2:'#7c8cff',onAccent:'#071018'},
    jade: {id:'jade',name:'\u9752\u7389\u7eff',accent:'#34c7a1',accent2:'#8be3c9',onAccent:'#071016'},
    dusk: {id:'dusk',name:'\u66ae\u5149\u7d2b',accent:'#9b8af5',accent2:'#c3b8ff',onAccent:'#f8fcff'},
    coral: {id:'coral',name:'\u73ca\u745a\u7ea2',accent:'#f27588',accent2:'#ffb0ba',onAccent:'#071016'},
    amber: {id:'amber',name:'\u7425\u73c0\u91d1',accent:'#e9aa3a',accent2:'#f7d48a',onAccent:'#071016'}
  });
  const CURATED_PALETTES = Object.freeze({
    ocean: {accent:'#4fd6e8',deep:'#07090e',workspace:'#0b0f16',panel:'#12161e',control:'#0e141c'},
    jade: {accent:'#34c7a1',deep:'#061411',workspace:'#0b201b',panel:'#173027',control:'#0e241e'},
    dusk: {accent:'#9b8af5',deep:'#100d1b',workspace:'#191526',panel:'#29223a',control:'#1d192b'},
    coral: {accent:'#f27588',deep:'#170c11',workspace:'#21151b',panel:'#33232a',control:'#25191f'},
    amber: {accent:'#e9aa3a',deep:'#171106',workspace:'#211a0c',panel:'#302718',control:'#241d10'}
  });
  const DEFAULT_PALETTE = CURATED_PALETTES.ocean;

  function normalizeTheme(value) {
    if (value === 'custom') return 'custom';
    return Object.prototype.hasOwnProperty.call(THEMES, value) ? value : 'ocean';
  }

  function normalizeHexWithFallback(value, fallback) {
    const hex = String(value || '').trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(hex) ? hex : String(fallback || DEFAULT_CUSTOM_COLOR).toLowerCase();
  }

  function normalizeHex(value) {
    return normalizeHexWithFallback(value, DEFAULT_CUSTOM_COLOR);
  }

  function mixHex(foreground, background, amount) {
    const front = normalizeHexWithFallback(foreground, DEFAULT_CUSTOM_COLOR).slice(1);
    const back = normalizeHexWithFallback(background, '#000000').slice(1);
    const ratio = Math.max(0, Math.min(1, Number(amount) || 0));
    const channel = index => Math.round(
      parseInt(front.slice(index, index + 2), 16) * ratio +
      parseInt(back.slice(index, index + 2), 16) * (1 - ratio)
    ).toString(16).padStart(2, '0');
    return `#${channel(0)}${channel(2)}${channel(4)}`;
  }

  function paletteFromAccent(value) {
    const accent = normalizeHex(value);
    return {
      accent,
      deep:mixHex(accent, '#03070a', .07),
      workspace:mixHex(accent, '#090e12', .08),
      panel:mixHex(accent, '#12191f', .1),
      control:mixHex(accent, '#0b1116', .08)
    };
  }

  function normalizePalette(value, fallback) {
    const source = value && typeof value === 'object' ? value : {};
    const base = fallback && typeof fallback === 'object' ? fallback : DEFAULT_PALETTE;
    const accent = normalizeHexWithFallback(source.accent || source.color, base.accent || DEFAULT_CUSTOM_COLOR);
    const derived = paletteFromAccent(accent);
    return {
      accent,
      deep:normalizeHexWithFallback(source.deep, base.deep || derived.deep),
      workspace:normalizeHexWithFallback(source.workspace, base.workspace || derived.workspace),
      panel:normalizeHexWithFallback(source.panel, base.panel || derived.panel),
      control:normalizeHexWithFallback(source.control, base.control || derived.control)
    };
  }

  function relativeLuminance(hex) {
    const safe = normalizeHex(hex).slice(1);
    const channels = [0, 2, 4].map(index => parseInt(safe.slice(index, index + 2), 16) / 255)
      .map(channel => channel <= .03928 ? channel / 12.92 : Math.pow((channel + .055) / 1.055, 2.4));
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  }

  function readableForeground(accent) {
    return relativeLuminance(accent) > .36 ? '#071016' : '#f8fcff';
  }

  function normalizeSavedThemes(value) {
    const source = Array.isArray(value) ? value : [];
    const usedSlots = new Set();
    const usedIds = new Set();
    const result = [];
    for (const item of source) {
      if (!item || typeof item !== 'object' || result.length >= MAX_SAVED_THEMES) continue;
      let slot = Number.isInteger(Number(item.slot)) ? Number(item.slot) : -1;
      if (slot < 0 || slot >= MAX_SAVED_THEMES || usedSlots.has(slot)) {
        slot = Array.from({length:MAX_SAVED_THEMES}, (_, index) => index).find(index => !usedSlots.has(index));
      }
      if (!Number.isInteger(slot)) break;
      let id = String(item.id || `saved-theme-${slot + 1}`).trim().slice(0, 64) || `saved-theme-${slot + 1}`;
      if (usedIds.has(id)) id = `${id}-${slot + 1}`;
      const name = String(item.name || '').trim().slice(0, 24) || `\u6211\u7684\u4e3b\u9898 ${slot + 1}`;
      const color = normalizeHex(item.palette?.accent || item.color);
      const palette = normalizePalette(item.palette || {accent:color}, paletteFromAccent(color));
      result.push({id,slot,name,color:palette.accent,palette});
      usedSlots.add(slot);
      usedIds.add(id);
    }
    return result.sort((a, b) => a.slot - b.slot);
  }

  function upsertSavedTheme(value, theme) {
    const current = normalizeSavedThemes(value);
    if (!theme || typeof theme !== 'object') return current;
    const existingIndex = current.findIndex(item => item.id === String(theme.id || ''));
    let slot = Number.isInteger(Number(theme.slot)) ? Number(theme.slot) : -1;
    if (existingIndex >= 0) slot = current[existingIndex].slot;
    if (slot < 0 || slot >= MAX_SAVED_THEMES || current.some((item, index) => item.slot === slot && index !== existingIndex)) {
      slot = Array.from({length:MAX_SAVED_THEMES}, (_, index) => index).find(index => !current.some(item => item.slot === index));
    }
    if (!Number.isInteger(slot)) return current;
    const color = normalizeHex(theme.palette?.accent || theme.color);
    const next = {
      id:String(theme.id || `saved-theme-${slot + 1}`).trim().slice(0, 64) || `saved-theme-${slot + 1}`,
      slot,
      name:String(theme.name || '').trim().slice(0, 24) || `\u6211\u7684\u4e3b\u9898 ${slot + 1}`,
      color,
      palette:normalizePalette(theme.palette || {accent:color}, paletteFromAccent(color))
    };
    if (existingIndex >= 0) current[existingIndex] = next;
    else current.push(next);
    return normalizeSavedThemes(current);
  }

  function removeSavedTheme(value, id) {
    return normalizeSavedThemes(value).filter(item => item.id !== String(id || ''));
  }

  function resolveTheme(id, customColor, customPalette) {
    const safeId = normalizeTheme(id);
    if (safeId !== 'custom') {
      const theme = THEMES[safeId];
      return {...theme,palette:normalizePalette(CURATED_PALETTES[safeId])};
    }
    const fallback = paletteFromAccent(customColor);
    const palette = normalizePalette(customPalette || {accent:customColor}, fallback);
    return {id:'custom',name:'\u81ea\u5b9a\u4e49',accent:palette.accent,accent2:palette.accent,onAccent:readableForeground(palette.accent),palette};
  }

  function applyColorTheme(documentObject, id, customColor, customPalette) {
    const theme = resolveTheme(id, customColor, customPalette);
    const body = documentObject?.body;
    if (!body) return theme;
    body.dataset.colorTheme = theme.id;
    body.style.setProperty('--accent', theme.accent);
    body.style.setProperty('--accent-2', theme.accent2);
    body.style.setProperty('--theme-accent', theme.accent);
    body.style.setProperty('--theme-accent-2', theme.accent2);
    body.style.setProperty('--theme-on-accent', theme.onAccent);
    body.style.setProperty('--theme-bg-deep', theme.palette.deep);
    body.style.setProperty('--theme-bg-workspace', theme.palette.workspace);
    body.style.setProperty('--theme-bg-panel', theme.palette.panel);
    body.style.setProperty('--theme-bg-control', theme.palette.control);
    return theme;
  }

  global.FutureAIColorThemes = {
    DEFAULT_CUSTOM_COLOR,
    DEFAULT_PALETTE,
    MAX_SAVED_THEMES,
    PALETTE_KEYS,
    THEMES,
    applyColorTheme,
    normalizeHex,
    normalizePalette,
    normalizeTheme,
    paletteFromAccent,
    readableForeground,
    normalizeSavedThemes,
    removeSavedTheme,
    resolveTheme,
    upsertSavedTheme
  };
})(typeof window !== 'undefined' ? window : globalThis);
