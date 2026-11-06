(() => {
  'use strict';

  const API_TIMEOUTS = {
    text: 90000,
    longText: 240000,
    image: 360000,
    video: 600000,
    audio: 240000,
    comfy: 600000,
    poll: 90000
  };

  function requestTimeoutError(timeoutMs) {
    const err = new Error(`请求超时：${Math.round(timeoutMs / 1000)} 秒内没有响应`);
    err.name = 'AbortError';
    err.isTimeout = true;
    return err;
  }

  function requestCanceledError() {
    const err = new Error('生成任务已取消');
    err.name = 'AbortError';
    err.isCanceled = true;
    return err;
  }

  function shouldRetryRequest(err, res) {
    if (res && [408, 429, 500, 502, 503, 504].includes(res.status)) return true;
    return Boolean(err?.isTimeout || /network|fetch|failed|timeout|aborted/i.test(err?.message || err?.name || ''));
  }

  function requestRetryDelay(attempt) {
    return Math.min(800 * (attempt + 1), 2400);
  }

  function isRetrySafeRequest(options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    return ['GET', 'HEAD', 'OPTIONS'].includes(method) || options.retryUnsafe === true;
  }

  function responseRetryDelay(res, attempt) {
    const value = String(res?.headers?.get?.('retry-after') || '').trim();
    if (value) {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 10000);
      const date = Date.parse(value);
      if (Number.isFinite(date)) return Math.min(Math.max(0, date - Date.now()), 10000);
    }
    return requestRetryDelay(attempt);
  }

  function wait(ms, signal) {
    if (signal?.aborted) return Promise.reject(requestCanceledError());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(done, ms);
      const onAbort = () => {
        clearTimeout(timer);
        signal?.removeEventListener?.('abort', onAbort);
        reject(requestCanceledError());
      };
      function done() {
        signal?.removeEventListener?.('abort', onAbort);
        resolve();
      }
      signal?.addEventListener?.('abort', onAbort, {once: true});
    });
  }

  async function fetchWithTimeout(url, options = {}) {
    const {timeoutMs = API_TIMEOUTS.text, signal: externalSignal, ...fetchOptions} = options;
    const controller = new AbortController();
    let externalAbort;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (externalSignal) {
      externalAbort = () => controller.abort();
      if (externalSignal.aborted) externalAbort();
      else externalSignal.addEventListener?.('abort', externalAbort, {once: true});
    }
    try {
      return await fetch(url, {...fetchOptions, signal: controller.signal});
    } catch (err) {
      if (err?.name === 'AbortError') {
        if (externalSignal?.aborted) throw requestCanceledError();
        throw requestTimeoutError(timeoutMs);
      }
      if (externalSignal?.aborted) throw requestCanceledError();
      throw err;
    } finally {
      clearTimeout(timer);
      if (externalSignal && externalAbort) externalSignal.removeEventListener?.('abort', externalAbort);
    }
  }

  async function fetchJsonWithRetry(url, options = {}) {
    const {retries = 1, retryUnsafe = false, ...requestOptions} = options;
    const retryAllowed = isRetrySafeRequest({...requestOptions, retryUnsafe});
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      let res = null;
      try {
        res = await fetchWithTimeout(url, requestOptions);
        if (!shouldRetryRequest(null, res) || !retryAllowed || attempt === retries) return res;
      } catch (err) {
        lastError = err;
        if (!shouldRetryRequest(err) || !retryAllowed || attempt === retries) throw err;
      }
      const delay = responseRetryDelay(res, attempt);
      try { await res?.body?.cancel?.(); } catch {}
      await wait(delay, requestOptions.signal);
    }
    throw lastError || new Error('请求失败');
  }

  window.FutureAICanvasAIClient = {
    API_TIMEOUTS,
    requestTimeoutError,
    requestCanceledError,
    shouldRetryRequest,
    requestRetryDelay,
    isRetrySafeRequest,
    responseRetryDelay,
    wait,
    fetchWithTimeout,
    fetchJsonWithRetry
  };
})();
