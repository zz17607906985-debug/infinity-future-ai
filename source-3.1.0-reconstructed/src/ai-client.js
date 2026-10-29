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
    const detail = `${err?.code || ''} ${err?.message || ''} ${err?.name || ''}`;
    return Boolean(
      err?.isTimeout ||
      /network|fetch failed|failed to fetch|econnreset|econnrefused|etimedout|socket hang up|timeout|aborted|ENOTFOUND|EAI_AGAIN/i.test(detail)
    );
  }

  function requestRetryDelay(attempt) {
    return Math.min(800 * Math.pow(2, attempt), 4000);
  }

  function isRetrySafeRequest(options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    return ['GET', 'HEAD', 'OPTIONS'].includes(method) || options.retryUnsafe === true;
  }

  function responseRetryDelay(res, attempt) {
    const value = String(res?.headers?.get?.('retry-after') || '').trim();
    if (value) {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30000);
      const date = Date.parse(value);
      if (Number.isFinite(date)) return Math.min(Math.max(0, date - Date.now()), 30000);
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

  function transientApiErrorMessage(err, res) {
    const status = Number(res?.status || err?.status || 0);
    const msg = String(err?.message || err || '');
    if (status === 429 || /\b429\b|rate.?limit|too many requests|配额|限流/i.test(msg)) {
      return '接口请求过于频繁或额度受限（HTTP 429）。请稍后再试，或在设置中切换其他 API / 模型。';
    }
    if ([502, 503, 504].includes(status) || /\b502\b|\b503\b|\b504\b|bad gateway|service unavailable|gateway timeout/i.test(msg)) {
      return `中转站暂时不可用（HTTP ${status || '5xx'}）。已自动重试仍失败，请稍后重试，或在设置中切换其他 API / 模型。`;
    }
    if (err?.isTimeout || /timeout|超时|econnreset|socket hang up|network|fetch failed/i.test(msg)) {
      return '网络不稳定或请求超时，已自动重试仍失败。请检查网络，或在设置中切换其他 API / 模型。';
    }
    return '';
  }

  window.FutureAICanvasAIClient = {
    API_TIMEOUTS,
    requestTimeoutError,
    requestCanceledError,
    shouldRetryRequest,
    requestRetryDelay,
    isRetrySafeRequest,
    responseRetryDelay,
    transientApiErrorMessage,
    wait,
    fetchWithTimeout,
    fetchJsonWithRetry
  };
})();
