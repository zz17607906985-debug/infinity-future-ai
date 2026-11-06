(() => {
  'use strict';

  const STEP_ORDER = ['models', 'text', 'imageSquare', 'imageLandscape', 'imageReference', 'videoLandscape'];
  const STEP_LABELS = Object.freeze({
    models: '模型列表',
    text: '文本请求',
    imageSquare: '方图生成',
    imageLandscape: '16:9 图片',
    imageReference: '参考图生成',
    videoLandscape: '16:9 视频'
  });

  function cleanErrorMessage(error) {
    return String(error?.message || error || '未知错误')
      .replace(/sk-[A-Za-z0-9_\-]{8,}/g, 'sk-[REDACTED]')
      .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]')
      .replace(/https?:\/\/\S+/gi, '[API_ENDPOINT]')
      .replace(/[A-Za-z]:\\[^\s"']+/g, '[LOCAL_PATH]')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240);
  }

  function errorCategory(error) {
    const message = String(error?.message || error || '').toLowerCase();
    if (/401|unauthori|invalid.*key|密钥|鉴权/.test(message)) return 'authentication';
    if (/403|forbidden|permission|no access|无权限|未开通/.test(message)) return 'permission';
    if (/404|not found|endpoint|路径|接口/.test(message)) return 'endpoint';
    if (/429|rate limit|quota|balance|频率|余额|限额/.test(message)) return 'quota';
    if (/timeout|timed out|aborted|52[0-4]|超时|网关/.test(message)) return 'timeout';
    if (/size|dimension|resolution|width|height|尺寸|分辨率/.test(message)) return 'size';
    if (/model|unsupported|模型|不支持/.test(message)) return 'model';
    if (/content policy|safety|moderation|安全|审核/.test(message)) return 'content-policy';
    return 'provider-error';
  }

  function sanitizeResult(value) {
    if (value == null) return value;
    if (Array.isArray(value)) return value.slice(0, 50).map(sanitizeResult);
    if (typeof value === 'object') {
      const output = {};
      for (const [key, child] of Object.entries(value)) {
        if (/key|secret|token|authorization|url|endpoint|path|prompt|content/i.test(key)) continue;
        output[key] = sanitizeResult(child);
      }
      return output;
    }
    if (typeof value === 'string') return cleanErrorMessage(value);
    return value;
  }

  async function runProviderConformance({ provider = {}, selected = {}, steps = {}, onProgress = () => {}, now = () => Date.now() }) {
    const startedAt = now();
    const results = [];
    for (const id of STEP_ORDER) {
      if (!selected[id]) continue;
      const run = steps[id];
      if (typeof run !== 'function') continue;
      const stepStartedAt = now();
      onProgress({ id, label: STEP_LABELS[id], status: 'running' });
      try {
        const evidence = sanitizeResult(await run());
        const item = { id, label: STEP_LABELS[id], status: 'passed', durationMs: Math.max(0, now() - stepStartedAt), evidence };
        results.push(item);
        onProgress(item);
      } catch (error) {
        const item = {
          id,
          label: STEP_LABELS[id],
          status: 'failed',
          durationMs: Math.max(0, now() - stepStartedAt),
          error: { category: errorCategory(error), message: cleanErrorMessage(error) }
        };
        results.push(item);
        onProgress(item);
      }
    }
    const passed = results.filter(item => item.status === 'passed').length;
    const failed = results.filter(item => item.status === 'failed').length;
    return {
      schema: 'future-ai-provider-conformance/v1',
      createdAt: new Date(startedAt).toISOString(),
      provider: {
        name: cleanErrorMessage(provider.name || '未命名供应商').slice(0, 80),
        protocol: cleanErrorMessage(provider.type || 'unknown').slice(0, 40),
        models: {
          chat: cleanErrorMessage(provider.chatModel || '').slice(0, 120),
          image: cleanErrorMessage(provider.imageModel || '').slice(0, 120),
          video: cleanErrorMessage(provider.videoModel || '').slice(0, 120)
        }
      },
      summary: { selected: results.length, passed, failed, status: failed ? 'failed' : results.length ? 'passed' : 'not-run' },
      durationMs: Math.max(0, now() - startedAt),
      results
    };
  }

  function commercialEvidenceReady(report) {
    if (report?.schema !== 'future-ai-provider-conformance/v1' || report?.summary?.status !== 'passed') return false;
    const results = Array.isArray(report.results) ? report.results : [];
    return STEP_ORDER.every(id => results.some(item => item.id === id && item.status === 'passed'))
      && results.filter(item => STEP_ORDER.includes(item.id)).length === STEP_ORDER.length;
  }

  function commercialCapability(item) {
    const mappedId = item.id === 'imageReference' ? 'referenceImage' : item.id === 'videoLandscape' ? 'video' : item.id;
    const output = {id: mappedId, status: item.status === 'passed' ? 'pass' : 'fail'};
    if (item.id === 'imageSquare' || item.id === 'imageLandscape') {
      output.requested = String(item.evidence?.requestedSize || '');
    }
    if (item.id === 'videoLandscape') {
      output.requestedSize = String(item.evidence?.requestedSize || '1280x720');
    }
    return output;
  }

  function buildCommercialEvidence(report, options = {}) {
    if (!commercialEvidenceReady(report)) throw new Error('Commercial evidence requires all six live capabilities to pass');
    return {
      schema: 'future-ai-real-provider-validation/v1',
      status: 'pass',
      source: 'future-ai-desktop-live-conformance',
      createdAt: report.createdAt,
      appVersion: String(options.appVersion || ''),
      liveRequests: true,
      redacted: true,
      provider: sanitizeResult(report.provider),
      capabilities: STEP_ORDER.map(id => commercialCapability(report.results.find(item => item.id === id)))
    };
  }

  function validateCommercialEvidence(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || value.schema !== 'future-ai-real-provider-validation/v1' || value.status !== 'pass'
      || value.source !== 'future-ai-desktop-live-conformance' || value.liveRequests !== true || value.redacted !== true) {
      throw new Error('Commercial provider evidence schema is invalid');
    }
    if (!Number.isFinite(Date.parse(value.createdAt)) || !/^\d+\.\d+\.\d+$/.test(String(value.appVersion || ''))) {
      throw new Error('Commercial provider evidence version or timestamp is invalid');
    }
    if (value.runtime?.testMode !== false) throw new Error('Commercial provider evidence cannot come from test mode');
    if (!['internal', 'stable'].includes(value.runtime?.releaseChannel)) throw new Error('Commercial provider evidence release channel is invalid');
    if (!/^[a-f0-9]{64}$/i.test(String(value.runtime?.appAsarSha256 || ''))) {
      throw new Error('Commercial provider evidence app.asar build identity is invalid');
    }
    const serialized = JSON.stringify(value);
    if (/https?:\/\/|\bBearer\b|sk-[A-Za-z0-9_-]{8,}|[A-Za-z]:\\/i.test(serialized)
      || /"(?:apiKey|apiUrl|authorization|endpoint|secret|token)"\s*:/i.test(serialized)) {
      throw new Error('Commercial provider evidence contains sensitive connection data');
    }
    const capabilities = Array.isArray(value.capabilities) ? value.capabilities : [];
    const required = ['models', 'text', 'imageSquare', 'imageLandscape', 'referenceImage', 'video'];
    if (capabilities.length !== required.length || required.some(id => !capabilities.some(item => item?.id === id && item?.status === 'pass'))) {
      throw new Error('Commercial provider evidence does not contain six passing capabilities');
    }
    const provider = value.provider && typeof value.provider === 'object' ? value.provider : {};
    const models = provider.models && typeof provider.models === 'object' ? provider.models : {};
    return {
      schema: value.schema,
      status: 'pass',
      source: value.source,
      createdAt: new Date(value.createdAt).toISOString(),
      appVersion: String(value.appVersion),
      liveRequests: true,
      redacted: true,
      runtime: {
        releaseChannel: value.runtime.releaseChannel,
        testMode: false,
        appAsarSha256: String(value.runtime.appAsarSha256).toLowerCase()
      },
      provider: {
        name: cleanErrorMessage(provider.name || '未命名供应商').slice(0, 80),
        protocol: cleanErrorMessage(provider.protocol || 'unknown').slice(0, 40),
        models: {
          chat: cleanErrorMessage(models.chat || '').slice(0, 120),
          image: cleanErrorMessage(models.image || '').slice(0, 120),
          video: cleanErrorMessage(models.video || '').slice(0, 120)
        }
      },
      capabilities: required.map(id => {
        const item = capabilities.find(entry => entry.id === id);
        const output = {id, status: 'pass'};
        if (id === 'imageSquare' || id === 'imageLandscape') {
          output.requested = String(item.requested);
        }
        if (id === 'video') {
          output.requestedSize = String(item.requestedSize || '1280x720');
        }
        return output;
      })
    };
  }

  const api = { STEP_LABELS, STEP_ORDER, buildCommercialEvidence, cleanErrorMessage, commercialEvidenceReady, errorCategory, runProviderConformance, sanitizeResult, validateCommercialEvidence };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FutureAIProviderConformance = api;
})();
