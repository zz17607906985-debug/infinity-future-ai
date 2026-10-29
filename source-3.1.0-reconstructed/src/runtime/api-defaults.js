(() => {
  'use strict';
  // In-memory global API defaults (base URL, global Key, default models).
  // The legacy settings form that used to hold these values was removed; they
  // are still loaded from saved settings / secure storage and mirrored by the
  // "默认模型" controls, so older configs keep working.
  const values = {
    apiUrl: 'https://nexusapi.cn/v1',
    apiKey: '',
    imageModel: 'gpt-image2',
    videoModel: 'omni-flash',
    chatModel: 'gpt-4o-mini'
  };
  window.FutureAIApiDefaults = {
    get: name => String(values[name] ?? ''),
    set: (name, value) => { if (name in values) values[name] = String(value ?? ''); }
  };
})();
