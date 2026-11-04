(function initCanvasWallpaper(global) {
  'use strict';

  // Preset artwork is pure CSS (styles.css, [data-wallpaper-preset]) so it ships inside the app
  // and works on any PC; only the user's own upload is a file, resolved by the main process.
  const PRESET_IDS = Object.freeze(['aurora', 'dusk', 'forest', 'ocean', 'mist']);
  const LIMITS = Object.freeze({blur: 24, dim: 90});
  const DEFAULTS = Object.freeze({id: 'none', blur: 0, dim: 35, grid: true});
  const SAVE_DELAY_MS = 150;
  // Every backdrop that shows the wallpaper: [grid host or null, layer id]. One choice paints all of
  // them; the grid toggle only applies to the canvas. 无 hides the layers, so each view keeps its own look.
  const LAYERS = Object.freeze([['canvas', 'canvasWallpaper'], [null, 'homeWallpaper']]);

  function clampInt(value, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(Math.min(max, Math.max(0, number))) : fallback;
  }

  function normalizeWallpaper(raw) {
    const id = String(raw?.id || '');
    return {
      id: id === 'custom' || PRESET_IDS.includes(id) ? id : 'none',
      blur: clampInt(raw?.blur, LIMITS.blur, DEFAULTS.blur),
      dim: clampInt(raw?.dim, LIMITS.dim, DEFAULTS.dim),
      grid: raw?.grid !== false
    };
  }

  function cssUrl(href) {
    return `url("${String(href).replace(/["\\\n\r]/g, encodeURIComponent)}")`;
  }

  // Paints the screen-fixed layer; a custom choice whose file is missing quietly shows nothing.
  function applyWallpaper(canvas, layer, settings, customUrl) {
    const value = normalizeWallpaper(settings);
    const id = value.id === 'custom' && !customUrl ? 'none' : value.id;
    canvas?.classList.toggle('canvas-grid-off', !value.grid);
    if (!layer) return id;
    layer.hidden = id === 'none';
    layer.dataset.wallpaperPreset = PRESET_IDS.includes(id) ? id : '';
    if (id === 'custom') layer.style.setProperty('--wallpaper-image', cssUrl(customUrl));
    else layer.style.removeProperty('--wallpaper-image');
    layer.style.setProperty('--wallpaper-blur', `${value.blur}px`);
    layer.style.setProperty('--wallpaper-dim', `${value.dim}%`);
    return id;
  }

  function ipcErrorText(error) {
    return String(error?.message || error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
  }

  function createCanvasWallpaper({document, bridge, onChange, toast}) {
    const $ = id => document.getElementById(id);
    let value = {...DEFAULTS};
    let custom = null;
    let saveTimer = null;

    function render() {
      const [shown] = LAYERS.map(([gridHost, layerId]) => applyWallpaper(gridHost && $(gridHost), $(layerId), value, custom?.url));
      document.querySelectorAll('input[name="canvasWallpaper"]').forEach(input => { input.checked = input.value === shown; });
      const customTile = $('canvasWallpaperCustomTile');
      if (customTile) {
        customTile.hidden = !custom;
        customTile.querySelector('.wallpaper-swatch')?.style.setProperty('--wallpaper-image', custom ? cssUrl(custom.url) : 'none');
      }
      if ($('canvasWallpaperDelete')) $('canvasWallpaperDelete').hidden = !custom;
      if ($('canvasWallpaperBlur')) $('canvasWallpaperBlur').value = String(value.blur);
      if ($('canvasWallpaperBlurValue')) $('canvasWallpaperBlurValue').value = `${value.blur}px`;
      if ($('canvasWallpaperDim')) $('canvasWallpaperDim').value = String(value.dim);
      if ($('canvasWallpaperDimValue')) $('canvasWallpaperDimValue').value = `${value.dim}%`;
      if ($('canvasWallpaperGridToggle')) $('canvasWallpaperGridToggle').checked = value.grid;
      if ($('canvasWallpaperLocation')) $('canvasWallpaperLocation').textContent = custom ? `图片副本保存在：${custom.dir}` : '上传的图片会复制一份保存，原文件可随意移动或删除。';
    }

    function update(patch) {
      value = normalizeWallpaper({...value, ...patch});
      render();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(onChange, SAVE_DELAY_MS);
    }

    async function refreshCustom() {
      try {
        custom = await bridge?.current?.() || null;
      } catch {
        custom = null;
      }
      render();
    }

    async function importFile(file) {
      if (!file || !bridge?.importFile) return;
      try {
        custom = await bridge.importFile(file);
        update({id: 'custom'});
        toast('壁纸已更新', 'success');
      } catch (error) {
        toast(`壁纸上传失败：${ipcErrorText(error)}`);
      }
    }

    async function deleteCustom() {
      if (!custom || !bridge?.remove) return;
      try {
        await bridge.remove();
        custom = null;
        update({id: value.id === 'custom' ? 'none' : value.id});
        toast('已删除壁纸图片', 'success');
      } catch (error) {
        toast(`删除失败：${ipcErrorText(error)}`);
      }
    }

    function bind() {
      $('canvasWallpaperGrid')?.addEventListener('change', event => {
        if (event.target.name === 'canvasWallpaper' && event.target.checked) update({id: event.target.value});
      });
      $('canvasWallpaperUpload')?.addEventListener('click', () => $('canvasWallpaperFile')?.click());
      $('canvasWallpaperDelete')?.addEventListener('click', () => void deleteCustom());
      $('canvasWallpaperFile')?.addEventListener('change', event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        void importFile(file);
      });
      $('canvasWallpaperBlur')?.addEventListener('input', event => update({blur: event.target.value}));
      $('canvasWallpaperDim')?.addEventListener('input', event => update({dim: event.target.value}));
      $('canvasWallpaperGridToggle')?.addEventListener('change', event => update({grid: event.target.checked}));
    }

    function load(raw) {
      value = normalizeWallpaper(raw);
      render();
      void refreshCustom();
    }

    return {bind, load, value: () => ({...value})};
  }

  global.FutureAICanvasWallpaper = {DEFAULTS, LAYERS, LIMITS, PRESET_IDS, applyWallpaper, createCanvasWallpaper, normalizeWallpaper};
})(typeof window !== 'undefined' ? window : globalThis);
