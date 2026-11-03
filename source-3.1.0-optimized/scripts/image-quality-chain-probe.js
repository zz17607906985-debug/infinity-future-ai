(() => {
  'use strict';
  window.startImageQualityChainProbe = function(options = {}) {
    if (options.allowPaid !== true) throw new Error('Explicit paid-test authorization required');
    if (window.imageQualityChainProbe) throw new Error('This probe has already started');
    const job = window.imageQualityChainProbe = {state: 'running', startedAt: Date.now(), calls: 0, attempts: [], images: new Map()};
    const settings = JSON.parse(parent.localStorage.getItem('future_clean_settings') || '{}');
    const baseProvider = structuredClone(settings.apiProviders.find(item => item.id === (options.node.data.providerId || settings.globalModelProviders.image)));
    if (!baseProvider || baseProvider.useGlobalKey || baseProvider.type !== 'openai-images') throw new Error('This controlled probe requires an image provider key pool');
    window.secretBridge = {
      listProviderApiKeys: providerId => parent.secretBridge.listProviderApiKeys(providerId),
      getProviderApiKeyForKey: (providerId, keyId) => parent.secretBridge.getProviderApiKeyForKey(providerId, keyId),
      getProviderApiKey: () => {throw new Error('Legacy first-key shortcut forbidden');},
      updateProviderApiKeyMetadata: async () => true
    };
    const unique = values => [...new Set(values)];
    const noop = () => {};
    const run = async () => {
      let provider = structuredClone(baseProvider);
      for (let index = 0; index < 2 && job.calls < 2; index += 1) {
        const firstSucceeded = job.attempts[0]?.success === true;
        if (firstSucceeded) provider = structuredClone(baseProvider);
        const quality = firstSucceeded ? 'high' : 'auto';
        const attempt = {quality, startedAt: Date.now(), requests: [], keyId: '', success: false};
        job.attempts.push(attempt);
        const node = {id: 'isolated-quality-test', type: 'image', data: {...structuredClone(options.node.data), promptMode: 'raw', quality, count: '1', url: '', urls: [], references: []}, el: {querySelector: () => null}};
        let activeSecret = '';
        const ui = window.FutureAIProviderUI.create({host: {apiProviders: [provider]}, saveSettings: noop, unique});
        const api = window.FutureAIProviderApi.create({
          normalizeKnownImageModelAlias: model => model,
          assertImageProviderCapability: ui.assertImageProviderCapability,
          markImageProviderCapability: ui.markImageProviderCapability,
          imageCapabilityError: ui.imageCapabilityError,
          saveSettings: noop, renderApiProviders: noop, unique,
          API_TIMEOUTS: window.FutureAICanvasAIClient.API_TIMEOUTS,
          assertUsableApiBaseAddress: address => {new URL(address);},
          fetchJsonWithRetry: async (url, request) => {
            if (request.method !== 'POST' || job.calls >= 2 || attempt.requests.length >= 1) throw new Error('Paid request guard: no automatic retry');
            const body = JSON.parse(request.body);
            const address = new URL(url);
            const trace = {url: address.origin + address.pathname, model: body.model, quality: body.quality || 'auto', size: body.size, promptChars: body.prompt.length, promptExact: body.prompt === options.node.data.prompt, keyId: attempt.keyId};
            attempt.requests.push(trace);
            job.calls += 1;
            const response = await window.FutureAICanvasAIClient.fetchJsonWithRetry(url, {...request, retries: 0, retryUnsafe: false});
            trace.status = response.status;
            const payload = await response.clone().json().catch(() => null);
            trace.returnedModel = payload?.model || null;
            trace.rawImageUrl = payload?.data?.[0]?.url || payload?.url || '';
            return response;
          },
          mediaUrlToBlob: async url => {
            if (job.images.has(url)) return job.images.get(url);
            const response = await fetch(url, {signal: AbortSignal.timeout(120000)});
            if (!response.ok) throw new Error('Image download HTTP ' + response.status);
            const blob = await response.blob();
            job.images.set(url, blob);
            return blob;
          }
        });
        const queue = window.FutureAIGenerationQueue.create({
          getNode: () => node, getInputPrompt: () => '', currentProviderForNode: () => provider,
          providerApiKey: async (...args) => {
            const lease = await ui.providerApiKey(...args);
            activeSecret = String(lease);
            attempt.keyId = lease?.keyId || '';
            attempt.keyLabel = provider.keyPool.find(key => key.id === attempt.keyId)?.label || '';
            return lease;
          },
          reportProviderKeyResult: ui.reportProviderKeyResult,
          imageTargetSize: data => window.FutureAIMediaDimensions.imageTargetSize(data),
          apiCompatibleImageSize: api.apiCompatibleImageSize,
          imageRequestDimensionFields: api.imageRequestDimensionFields,
          imageRequestSeedFields: api.imageRequestSeedFields,
          ensureInputImageRefs: async () => [],
          imageGenerateRequest: api.imageGenerateRequest,
          imageEditWithFallback: api.imageEditWithFallback,
          persistGeneratedImageResult: async result => {
            attempt.url = result.url;
             return result.url;
          },
           hydrateNode: noop, saveProject: noop, setImageStatus: noop,
          refreshDownstreamLinkedInputs: noop, addHistory: noop, toast: noop,
          isSafetyError: () => false,
          formatImageGenerationError: error => error.message,
          imageErrorTitle: () => 'Controlled test',
          authorizeGenerationBudget: async () => 'explicit-user-authorized-probe',
          completeGenerationBudget: noop
        });
        try {
          await queue.runImageNow(node.id);
          attempt.success = true;
        } catch (error) {
          attempt.error = activeSecret ? String(error.message).split(activeSecret).join('[redacted]').slice(0,300) : 'No usable key or request blocked before authentication';
          if (/timeout|超时|network|download/i.test(attempt.error)) break;
        } finally {
          attempt.elapsedMs = Date.now() - attempt.startedAt;
          activeSecret = '';
        }
        if (!attempt.requests.length) break;
      }
      job.state = 'complete';
    };
    run().catch(error => {job.state = 'failed';job.error = String(error.message).slice(0,160);});
    return {started: true, maxPaidRequests: 2, provider: baseProvider.name, model: options.node.data.model};
  };
})();
